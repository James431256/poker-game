/**
 * ui/playView.js — the main table: runs the hand loop (bots act with a short
 * delay, the human acts via the action bar), shows the live coach and the
 * post-hand grading summary, and pops lesson cards for repeated mistakes.
 */
import { $, esc, bbFmt, modal, toast, sleep, term } from './dom.js';
import { TableView } from './tableView.js';
import { coachHTML, summaryHTML } from './coachPanel.js';
import { profileById } from '../bots.js';
import { LESSONS } from '../lessons.js';
import { LEVELS } from '../progression.js';
import { GLOSSARY } from '../glossary.js';

const DELAYS = { slow: 1100, normal: 650, fast: 250 };

export class PlayView {
  constructor(root, app) {
    this.root = root;
    this.app = app;
    this.running = false;
    this.root.innerHTML = `
      <div class="toolbar">
        <label class="toggle"><input type="checkbox" id="opt-coach"> Coach <span class="kbd">H</span></label>
        <label class="toggle">Speed
          <select id="opt-speed"><option value="slow">Slow</option><option value="normal">Normal</option><option value="fast">Fast</option></select></label>
        <label class="toggle"><input type="checkbox" id="opt-auto"> Auto-deal</label>
        <label class="toggle"><input type="checkbox" id="opt-lessons"> Lesson cards</label>
        <span class="spacer"></span>
        <label class="toggle">Table <select id="opt-level"></select></label>
      </div>
      <div class="play-layout">
        <div>
          <div id="table-root"></div>
          <div class="action-bar" id="action-bar"></div>
        </div>
        <aside>
          <div class="panel coach" id="coach-panel"></div>
          <div class="panel" id="summary-panel" hidden></div>
          <div class="panel"><div class="panel-head"><h3>Hand log</h3><span class="muted small" id="hand-no"></span></div><div class="log" id="hand-log"></div></div>
        </aside>
      </div>`;
    this.table = new TableView($('#table-root', root));
    this.actionBar = $('#action-bar', root);
    this.coachEl = $('#coach-panel', root);
    this.summaryEl = $('#summary-panel', root);
    this.logEl = $('#hand-log', root);
    this.bindToolbar();
    this.bindKeys();
  }

  get session() { return this.app.session; }
  get settings() { return this.app.state.settings; }

  bindToolbar() {
    const s = this.settings;
    const coach = $('#opt-coach', this.root);
    const speed = $('#opt-speed', this.root);
    const auto = $('#opt-auto', this.root);
    const lessons = $('#opt-lessons', this.root);
    coach.checked = s.coachVisible;
    speed.value = s.speed;
    auto.checked = s.autoNext;
    lessons.checked = s.showLessons;
    coach.onchange = () => this.setCoach(coach.checked);
    speed.onchange = () => { s.speed = speed.value; this.app.save(); };
    auto.onchange = () => { s.autoNext = auto.checked; this.app.save(); };
    lessons.onchange = () => { s.showLessons = lessons.checked; this.app.save(); };
    this.renderLevelSelect();
    $('#opt-level', this.root).onchange = (e) => {
      this.session.setLevel(Number(e.target.value));
      this.app.refreshBadge();
      toast(`Now playing at <b>${esc(LEVELS[this.session.level - 1].name)}</b> — takes effect from the next hand.`);
    };
  }

  renderLevelSelect() {
    const sel = $('#opt-level', this.root);
    const st = this.app.state;
    sel.innerHTML = LEVELS.map((L) => `<option value="${L.level}" ${L.level > st.unlockedLevel ? 'disabled' : ''} ${L.level === st.level ? 'selected' : ''}>${L.level}. ${esc(L.name)}${L.level > st.unlockedLevel ? ' 🔒' : ''}</option>`).join('');
  }

  setCoach(on) {
    this.settings.coachVisible = on;
    $('#opt-coach', this.root).checked = on;
    this.app.save();
    this.renderCoach();
  }

  bindKeys() {
    document.addEventListener('keydown', (e) => {
      if (!this.root.classList.contains('active') || e.target.matches('input, select, textarea') || document.querySelector('.modal-backdrop')) return;
      const k = e.key.toLowerCase();
      if (k === 'h') this.setCoach(!this.settings.coachVisible);
      if (this.pendingAction) {
        if (k === 'f') this.actionBar.querySelector('[data-a="fold"]')?.click();
        if (k === 'c' || k === 'k') this.actionBar.querySelector('[data-a="call"],[data-a="check"]')?.click();
        if (k === 'r' || k === 'b') this.actionBar.querySelector('[data-a="raise"]')?.click();
      } else if ((k === ' ' || k === 'enter') && this.session.game.handOver && !this.running) {
        e.preventDefault();
        this.nextHand();
      }
    });
  }

  /** Called when the Play tab is shown. */
  activate() {
    if (!this.started) {
      this.started = true;
      this.nextHand();
    }
  }

  // ---------------------------------------------------------------- loop

  async nextHand() {
    if (this.running) return;
    this.running = true;
    clearTimeout(this.autoTimer);
    this.summaryEl.hidden = true;
    this.table.reset();
    this.session.startHand();
    $('#hand-no', this.root).textContent = `#${this.session.game.handNumber}`;
    const g = this.session.game;
    try {
      while (!g.handOver) {
        this.renderTable();
        if (this.session.isHumanTurn) {
          const action = await this.askHuman();
          this.session.humanAct(action);
        } else {
          this.renderWaiting();
          this.renderCoach();
          await sleep(DELAYS[this.settings.speed] ?? 650);
          this.session.botAct();
        }
      }
      // Reveal the run-out / showdown.
      this.renderTable();
      this.actionBar.innerHTML = '';
      const summary = this.session.finishHand();
      this.app.onHandFinished();
      this.showSummary(summary);
      await this.showLessons(summary.lessons);
      if (summary.unlockedNew) {
        const L = LEVELS[summary.unlockedNew - 1];
        toast(`🔓 Unlocked <b>${esc(L.name)}</b>! Switch tables from the toolbar.`, 5000);
        this.renderLevelSelect();
      }
    } finally {
      this.running = false;
    }
    if (this.settings.autoNext) this.autoTimer = setTimeout(() => this.nextHand(), 2600);
  }

  vm() {
    const g = this.session.game;
    const over = g.handOver;
    const res = g.result;
    return {
      bb: g.bb,
      button: g.button,
      board: g.board,
      pot: g.pot,
      street: g.street,
      players: g.players.map((p) => {
        const profile = p.botId ? profileById(p.botId) : null;
        let tendency = null;
        if (profile) {
          const l = this.session.botLabel(p.seat);
          tendency = l.style
            ? { text: `${l.style.label} · ${l.style.short}`, title: profile.blurb }
            : { text: `Reading… ${l.seen}/${l.needed}`, unknown: true, title: 'Tendencies appear after enough hands together.' };
        }
        const showCards = p.isHuman || (over && res?.shown?.[p.seat]) || (g.runout && !p.folded);
        return {
          name: p.name,
          avatar: profile?.avatar ?? '🙂',
          stack: p.stack,
          committed: over ? 0 : p.committed,
          folded: p.folded,
          allIn: p.allIn && !over,
          cards: p.holeCards,
          showCards: !!showCards,
          position: g.positionOf(p.seat),
          lastAction: over ? null : p.lastAction,
          active: !over && g.toAct === p.seat,
          winner: over && (res?.net?.[p.seat] ?? 0) > 0,
          handName: over && res?.handNames?.[p.seat] && res.shown[p.seat] ? res.handNames[p.seat] : null,
          tendency,
          isHero: p.isHuman,
        };
      }),
    };
  }

  renderTable() {
    this.table.render(this.vm());
    this.renderLog();
  }

  renderLog() {
    const lines = this.session.game.log.map((l) => (l.startsWith('***') ? `<div class="street">${esc(l.replace(/\*/g, '').trim())}</div>` : `<div>${esc(l)}</div>`));
    this.logEl.innerHTML = lines.join('');
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  renderWaiting() {
    const g = this.session.game;
    const p = g.players[g.toAct];
    this.actionBar.innerHTML = `<div class="waiting">${esc(p.name)} is thinking<span class="dots"></span></div>`;
  }

  renderCoach() {
    const s = this.session;
    if (!this.settings.coachVisible) {
      this.coachEl.innerHTML = `<div class="coach-off">Coach hidden — your decisions are still graded after each hand.<br><button class="btn small" style="margin-top:8px" data-coach-on>Show coach (H)</button></div>`;
      this.coachEl.querySelector('[data-coach-on]').onclick = () => this.setCoach(true);
      return;
    }
    if (!s.isHumanTurn) {
      this.coachEl.innerHTML = `<div class="panel-head"><h3>Coach</h3></div><p class="muted small">Advice appears when it's your turn. Hover underlined terms like ${term('equity')} or ${term('spr', 'SPR')} for definitions.</p>`;
      return;
    }
    const advice = s.advice();
    this.coachEl.innerHTML = `<div class="panel-head"><h3>Coach</h3><span class="chip">${esc(s.game.street)}</span></div>${coachHTML(advice)}`;
  }

  // ------------------------------------------------------------- human

  askHuman() {
    return new Promise((resolve) => {
      this.pendingAction = resolve;
      this.renderActionBar((action) => {
        this.pendingAction = null;
        resolve(action);
      });
      this.coachEl.innerHTML = '<div class="muted small">Coach is thinking…</div>';
      // Let the action bar paint before running the simulation.
      setTimeout(() => {
        this.renderCoach();
        this.highlightRecommended();
      }, 30);
    });
  }

  highlightRecommended() {
    if (!this.settings.coachVisible || !this.session.isHumanTurn) return;
    const rec = this.session.advice()?.recommendation;
    if (!rec) return;
    const map = { fold: 'fold', check: 'check', call: 'call', bet: 'raise', raise: 'raise' };
    this.actionBar.querySelector(`[data-a="${map[rec.type]}"]`)?.classList.add('recommended');
    // Pre-set the slider to the coach's size so following advice is one click.
    if (rec.amount && this.setSize) this.setSize(rec.amount);
  }

  renderActionBar(done) {
    const g = this.session.game;
    const legal = g.legalActions(0);
    const bb = g.bb;
    const btns = [];
    if (legal.canFold) btns.push(`<button class="btn act-fold" data-a="fold">Fold<span class="kbd">F</span></button>`);
    if (legal.canCheck) btns.push(`<button class="btn act-call" data-a="check">Check<span class="kbd">C</span></button>`);
    if (legal.canCall) btns.push(`<button class="btn act-call" data-a="call">Call ${bbFmt(legal.callAmount, bb)}<span class="kbd">C</span></button>`);
    if (legal.canRaise) btns.push(`<button class="btn act-raise" data-a="raise"><span data-raise-label></span><span class="kbd">R</span></button>`);

    let sizing = '';
    if (legal.canRaise) {
      const presets = this.presets(g, legal);
      sizing = `<div class="sizing">
        ${presets.map((p, i) => `<button class="btn small" data-preset="${i}">${esc(p.label)}</button>`).join('')}
        <input type="range" min="${legal.minRaiseTo}" max="${legal.maxRaiseTo}" step="${bb / 10}" value="${legal.minRaiseTo}" aria-label="Bet size">
        <input type="number" min="${legal.minRaiseTo / bb}" max="${legal.maxRaiseTo / bb}" step="0.1" value="${legal.minRaiseTo / bb}" aria-label="Bet size in big blinds"> bb
      </div>`;
      this.presetList = presets;
    }
    this.actionBar.innerHTML = `<div class="action-row">${btns.join('')}</div>${sizing}`;

    let size = legal.minRaiseTo;
    const label = this.actionBar.querySelector('[data-raise-label]');
    const range = this.actionBar.querySelector('input[type=range]');
    const num = this.actionBar.querySelector('input[type=number]');
    this.setSize = (v) => {
      size = Math.max(legal.minRaiseTo, Math.min(legal.maxRaiseTo, Math.round(v / (bb / 10)) * (bb / 10)));
      if (legal.maxRaiseTo - size < bb / 10) size = legal.maxRaiseTo;
      if (range) range.value = size;
      if (num) num.value = (size / bb).toFixed(1).replace(/\.0$/, '');
      if (label) label.textContent = `${size === legal.maxRaiseTo ? 'All-in' : legal.isBet ? 'Bet' : 'Raise to'} ${bbFmt(size, bb)}`;
    };
    if (legal.canRaise) {
      // Sensible default: the preflop open size / a 2/3-pot bet.
      const def = this.presetList.find((p) => p.default) ?? this.presetList[0];
      this.setSize(def ? def.to : legal.minRaiseTo);
      range.oninput = () => this.setSize(Number(range.value));
      num.onchange = () => this.setSize(Number(num.value) * bb);
      this.actionBar.querySelectorAll('[data-preset]').forEach((b) => {
        b.onclick = () => this.setSize(this.presetList[Number(b.dataset.preset)].to);
      });
    }
    this.actionBar.querySelectorAll('[data-a]').forEach((b) => {
      b.onclick = () => {
        const a = b.dataset.a;
        this.actionBar.innerHTML = '';
        if (a === 'raise') done({ type: legal.isBet ? 'bet' : 'raise', amount: size });
        else done({ type: a });
      };
    });
  }

  /** Bet-size preset buttons (raise-to amounts). */
  presets(g, legal) {
    const bb = g.bb;
    const clamp = (x) => Math.max(legal.minRaiseTo, Math.min(legal.maxRaiseTo, Math.round(x / (bb / 10)) * (bb / 10)));
    const out = [];
    if (g.street === 'preflop') {
      if (g.currentBet <= bb) {
        out.push({ label: '2.5bb', to: clamp(2.5 * bb), default: true });
        out.push({ label: '3bb', to: clamp(3 * bb) });
        const limpers = g.history.actions.filter((a) => a.street === 'preflop' && a.type === 'call').length;
        if (limpers) out.push({ label: `Iso ${4 + limpers}bb`, to: clamp((4 + limpers) * bb) });
      } else {
        out.push({ label: '3×', to: clamp(g.currentBet * 3), default: true });
        out.push({ label: '4×', to: clamp(g.currentBet * 4) });
        out.push({ label: '2.3× (4-bet)', to: clamp(g.currentBet * 2.3) });
      }
    } else {
      const toCall = legal.toCall;
      const base = g.pot + toCall; // pot after calling
      for (const [label, f] of [['⅓', 1 / 3], ['½', 0.5], ['⅔', 2 / 3], ['Pot', 1]]) {
        out.push({ label: `${label} pot`, to: clamp(g.currentBet + f * base), default: f === 2 / 3 });
      }
    }
    out.push({ label: 'All-in', to: legal.maxRaiseTo });
    // De-duplicate identical amounts.
    return out.filter((p, i) => out.findIndex((q) => q.to === p.to) === i);
  }

  // ------------------------------------------------------------ summary

  showSummary(summary) {
    const g = this.session.game;
    const h = g.history;
    this.summaryEl.hidden = false;
    this.summaryEl.innerHTML = summaryHTML(summary, g, h);
    this.summaryEl.querySelector('[data-act="next"]').onclick = () => this.nextHand();
    this.summaryEl.querySelector('[data-act="review"]').onclick = () => this.app.openReplay(h.id);
    this.coachEl.innerHTML = this.settings.coachVisible
      ? `<div class="panel-head"><h3>Coach</h3></div><p class="small muted">Hand over. Read the grades below, then deal the next hand.</p>`
      : this.coachEl.innerHTML;
    this.actionBar.innerHTML = `<div class="action-row"><button class="btn primary" data-next>Deal next hand <span class="kbd">Space</span></button></div>`;
    this.actionBar.querySelector('[data-next]').onclick = () => this.nextHand();
    // On narrow screens, bring the summary into view.
    if (window.innerWidth < 1080) this.summaryEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async showLessons(tags) {
    for (const tag of tags) {
      const L = LESSONS[tag];
      if (!L) continue;
      this.app.state.lessonsSeen[tag] = (this.app.state.lessonsSeen[tag] ?? 0) + 1;
      clearTimeout(this.autoTimer);
      await new Promise((resolve) => {
        modal(`
          <div class="eyebrow">Lesson · you've repeated this mistake</div>
          <h2>${esc(L.title)}</h2>
          <p>${esc(L.body)}</p>
          <div class="tip">💡 ${esc(L.tip)}</div>
          <div class="row small muted">Related: ${L.terms.map((t) => term(t, GLOSSARY[t]?.term)).join(', ')}</div>
          <div class="row" style="margin-top:14px"><span class="spacer"></span><button class="btn primary" data-close>Got it</button></div>`, { onClose: resolve });
      });
    }
    if (tags.length) this.app.save();
  }
}
