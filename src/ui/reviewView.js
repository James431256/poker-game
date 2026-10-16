/**
 * ui/reviewView.js — hand history browser, step-by-step replayer (with your
 * graded decisions shown at the moment you made them) and the mistake log.
 */
import { $, esc, cardsHTML, signed } from './dom.js';
import { TableView } from './tableView.js';
import { profileById } from '../bots.js';
import { parseCards } from '../deck.js';

export class ReviewView {
  constructor(root, app) {
    this.root = root;
    this.app = app;
    this.tab = 'hands';
    root.innerHTML = `
      <div class="row" style="margin-bottom:12px">
        <h2 style="margin:0">Review</h2>
        <div class="subtabs" style="margin:0 0 0 12px">
          <button class="btn small" data-sub="hands">Hand history</button>
          <button class="btn small" data-sub="mistakes">Mistake log</button>
        </div>
      </div>
      <div id="rv-body"></div>`;
    root.querySelectorAll('[data-sub]').forEach((b) => { b.onclick = () => { this.tab = b.dataset.sub; this.render(); }; });
    document.addEventListener('keydown', (e) => {
      if (!this.root.classList.contains('active') || !this.hand || e.target.matches('input, select')) return;
      if (e.key === 'ArrowRight') this.step(1);
      if (e.key === 'ArrowLeft') this.step(-1);
    });
  }

  activate() {
    this.render();
  }

  /** Open a specific hand (from the play view's "Replay hand" button). */
  open(handId) {
    this.tab = 'hands';
    this.selected = handId;
    this.render();
  }

  render() {
    this.root.querySelectorAll('[data-sub]').forEach((b) => b.classList.toggle('primary', b.dataset.sub === this.tab));
    if (this.tab === 'mistakes') return this.renderMistakes();
    const hands = this.app.state.histories;
    const body = $('#rv-body', this.root);
    if (!hands.length) {
      body.innerHTML = '<div class="panel muted">No hands yet — play a few at the table and they will show up here.</div>';
      return;
    }
    if (!this.selected || !hands.some((h) => h.id === this.selected)) this.selected = hands[0].id;
    body.innerHTML = `
      <div class="review-layout">
        <div class="panel"><div class="panel-head"><h3>Recent hands</h3><span class="muted small">${hands.length} saved</span></div><ul class="hand-list" id="rv-list"></ul></div>
        <div class="panel" id="rv-replay"></div>
      </div>`;
    $('#rv-list', this.root).innerHTML = hands.map((h) => {
      const hero = h.players.find((p) => p.isHuman);
      const net = (h.result?.net?.[hero.seat] ?? 0) / h.bigBlind;
      const bad = (h.decisions ?? []).filter((d) => d.grade === 'mistake').length;
      const marg = (h.decisions ?? []).filter((d) => d.grade === 'marginal').length;
      return `<li data-id="${esc(h.id)}" class="${h.id === this.selected ? 'sel' : ''}">
        <span class="muted small" style="width:38px">#${h.handNumber}</span>
        ${cardsHTML(hero.holeCards, { size: 'sm' })}
        <span class="chip">${esc(hero.position)}</span>
        <span class="spacer"></span>
        ${bad ? `<span class="grade mistake">${bad}</span>` : ''}${marg ? `<span class="grade marginal">${marg}</span>` : ''}
        <span class="net ${net > 0 ? 'pos' : net < 0 ? 'neg' : ''}" style="min-width:56px;text-align:right">${signed(net)}</span>
      </li>`;
    }).join('');
    this.root.querySelectorAll('#rv-list li').forEach((li) => {
      li.onclick = () => { this.selected = li.dataset.id; this.render(); };
    });
    this.loadHand(hands.find((h) => h.id === this.selected));
  }

  loadHand(h) {
    this.hand = h;
    this.frameIdx = 0;
    this.showAll = this.showAll ?? false;
    const el = $('#rv-replay', this.root);
    const decisions = (h.decisions ?? []).filter((d) => !d.trivial);
    const evLost = decisions.reduce((s, d) => s + d.evLoss, 0);
    el.innerHTML = `
      <div class="panel-head"><h3>Hand #${h.handNumber} · ${new Date(h.time).toLocaleString()}</h3>
        <label class="toggle"><input type="checkbox" id="rv-all" ${this.showAll ? 'checked' : ''}> Show all cards</label></div>
      <div id="rv-table"></div>
      <div class="replay-controls">
        <button class="btn small" data-step="-99" aria-label="First">⏮</button>
        <button class="btn small" data-step="-1" aria-label="Back">◀</button>
        <input type="range" min="0" max="${h.frames.length - 1}" value="0" id="rv-slider" aria-label="Replay position">
        <button class="btn small" data-step="1" aria-label="Forward">▶</button>
        <button class="btn small" data-step="99" aria-label="Last">⏭</button>
      </div>
      <div class="frame-text" id="rv-text"></div>
      <div id="rv-decision"></div>
      <h3 style="margin-top:14px">Your decisions ${evLost > 0.05 ? `<span class="muted small">· ≈${evLost.toFixed(1)}bb EV lost</span>` : ''}</h3>
      <ul class="summary-list">${decisions.length ? decisions.map((d) => `<li>
        <div class="row"><span class="grade ${d.grade}">${d.grade}</span><span class="chip">${esc(d.street)}</span>
        ${d.evLoss > 0.05 ? `<span class="muted small">−${d.evLoss.toFixed(1)}bb</span>` : ''}
        <span class="spacer"></span><button class="btn small" data-jump="${d.actionIndex}">Jump to</button></div>${esc(d.explanation)}</li>`).join('') : '<li class="muted">No graded decisions in this hand.</li>'}</ul>
      <details style="margin-top:10px"><summary class="muted small">Text log</summary><pre class="small" style="white-space:pre-wrap;color:var(--text-2)">${esc((h.log ?? []).join('\n'))}</pre></details>`;
    this.table = new TableView($('#rv-table', el));
    el.querySelectorAll('[data-step]').forEach((b) => { b.onclick = () => this.step(Number(b.dataset.step)); });
    $('#rv-slider', el).oninput = (e) => this.show(Number(e.target.value));
    $('#rv-all', el).onchange = (e) => { this.showAll = e.target.checked; this.show(this.frameIdx); };
    el.querySelectorAll('[data-jump]').forEach((b) => {
      b.onclick = () => {
        const i = h.frames.findIndex((f) => f.actionIndex === Number(b.dataset.jump));
        if (i >= 0) this.show(i);
      };
    });
    this.show(0);
  }

  step(d) {
    if (!this.hand) return;
    this.show(Math.max(0, Math.min(this.hand.frames.length - 1, this.frameIdx + d)));
  }

  show(i) {
    const h = this.hand;
    this.frameIdx = i;
    const f = h.frames[i];
    const last = i === h.frames.length - 1;
    if (i === 0) this.table.reset();
    this.table.render({
      bb: h.bigBlind,
      button: h.button,
      board: f.board,
      pot: f.pot,
      street: f.street,
      players: h.players.map((hp, s) => {
        const fp = f.players[s];
        const profile = hp.botId ? profileById(hp.botId) : null;
        const shownAtEnd = last && h.result?.shown?.[s];
        return {
          name: hp.name,
          avatar: profile?.avatar ?? '🙂',
          stack: fp.stack,
          committed: last ? 0 : fp.committed,
          folded: fp.folded,
          allIn: fp.allIn && !last,
          cards: hp.holeCards,
          showCards: hp.isHuman || this.showAll || !!shownAtEnd,
          position: hp.position,
          lastAction: last ? null : fp.lastAction,
          active: f.actor === s,
          winner: last && (h.result?.net?.[s] ?? 0) > 0,
          handName: shownAtEnd ? h.result.handNames?.[s] : null,
          isHero: hp.isHuman,
        };
      }),
    });
    $('#rv-slider', this.root).value = i;
    $('#rv-text', this.root).textContent = `${i + 1}/${h.frames.length} · ${f.text}`;
    const d = (h.decisions ?? []).find((x) => x.actionIndex === f.actionIndex && f.actor === h.players.find((p) => p.isHuman).seat);
    $('#rv-decision', this.root).innerHTML = d
      ? `<div class="feedback ${d.grade === 'good' ? 'right' : d.grade === 'marginal' ? 'ok' : 'wrong'}" style="margin-top:8px">
          <span class="grade ${d.grade}">${d.grade}</span> ${esc(d.explanation)}</div>`
      : '';
  }

  renderMistakes() {
    const log = this.app.state.mistakeLog;
    const body = $('#rv-body', this.root);
    if (!log.length) {
      body.innerHTML = '<div class="panel muted">No mistakes logged yet. Marginal and costly decisions from your hands will collect here.</div>';
      return;
    }
    const tags = {};
    for (const m of log) if (m.tag) tags[m.tag] = (tags[m.tag] ?? 0) + 1;
    const total = log.reduce((s, m) => s + (m.evLoss ?? 0), 0);
    body.innerHTML = `<div class="panel">
      <div class="panel-head"><h3>Mistake log</h3><span class="muted small">${log.length} entries · ≈${total.toFixed(1)}bb estimated EV lost</span></div>
      <div class="row" style="margin-bottom:8px">${Object.entries(tags).sort((a, b) => b[1] - a[1]).map(([t, n]) => `<span class="chip">${esc(t)} × ${n}</span>`).join('')}</div>
      ${log.slice(0, 120).map((m) => {
        const exists = this.app.state.histories.some((h) => h.id === m.handId);
        return `<div class="mistake-item">
          <div class="row"><span class="grade ${m.grade}">${m.grade}</span><span class="chip">${esc(m.position ?? '')} · ${esc(m.street)}</span>
          ${cardsHTML(parseCards(m.hole), { size: 'sm' })} ${m.board ? cardsHTML(parseCards(m.board), { size: 'sm' }) : ''}
          <span class="spacer"></span><span class="muted small">−${(m.evLoss ?? 0).toFixed(1)}bb · hand #${m.handNumber}</span>
          ${exists ? `<button class="btn small" data-open="${esc(m.handId)}">Replay</button>` : ''}</div>
          <div class="small" style="color:var(--text-2);margin-top:4px">${esc(m.explanation)}</div></div>`;
      }).join('')}</div>`;
    body.querySelectorAll('[data-open]').forEach((b) => { b.onclick = () => this.open(b.dataset.open); });
  }
}

