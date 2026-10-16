/**
 * ui/practiceViews.js — the three practice modes:
 *   - TrainerView: preflop chart trainer (open / vs open / vs 3-bet)
 *   - DrillsView:  postflop spot drills with EV feedback, points and streaks
 *   - QuizView:    pot odds, outs and hand-ranking quiz
 */
import { $, esc, cardsHTML, rangeGridHTML, pct, term } from './dom.js';
import { makePreflopQuestion, explainAnswer, TRAINER_SCENARIOS } from '../trainer.js';
import { makeDrill, DRILL_TYPES } from '../drills.js';
import { makeQuiz, QUIZ_TYPES } from '../quiz.js';

function scoreTiles(items) {
  return `<div class="scorebar">${items.map(([k, v, cls]) => `<div class="score"><div class="v ${cls ?? ''}">${v}</div><div class="k">${k}</div></div>`).join('')}</div>`;
}

/** Wire number keys 1–4 to answer buttons when a view is active. */
function bindAnswerKeys(view) {
  document.addEventListener('keydown', (e) => {
    if (!view.root.classList.contains('active') || e.target.matches('input, select')) return;
    const n = Number(e.key);
    if (n >= 1 && n <= 5) view.root.querySelectorAll('.answers .btn')[n - 1]?.click();
    if ((e.key === 'Enter' || e.key === ' ') && view.answered) {
      e.preventDefault();
      view.next();
    }
  });
}

// ---------------------------------------------------------------- trainer

export class TrainerView {
  constructor(root, app) {
    this.root = root;
    this.app = app;
    this.streak = 0;
    root.innerHTML = `
      <div class="row" style="margin-bottom:12px">
        <h2 style="margin:0">Preflop chart trainer</h2><span class="spacer"></span>
        <label class="toggle">Scenario <select id="tr-scenario"><option value="mixed">Mixed</option>${Object.entries(TRAINER_SCENARIOS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
        <label class="toggle">Position <select id="tr-pos"><option value="">Any</option>${['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'].map((p) => `<option>${p}</option>`).join('')}</select></label>
      </div>
      <div class="trainer-layout">
        <div>
          <div class="panel question" id="tr-q"></div>
          <div class="panel" id="tr-score"></div>
        </div>
        <div class="panel" id="tr-chart"><p class="muted">Answer to see the full chart for this spot.</p>
          <p class="small muted">6-max, 100bb, opens to 2.5bb. These are simplified modern ranges — learn them as a baseline, then adjust to opponents.</p></div>
      </div>`;
    $('#tr-scenario', root).onchange = () => this.next();
    $('#tr-pos', root).onchange = () => this.next();
    bindAnswerKeys(this);
  }

  activate() {
    if (!this.q) this.next();
    this.renderScore();
  }

  next() {
    this.answered = false;
    this.q = makePreflopQuestion({ scenario: $('#tr-scenario', this.root).value, position: $('#tr-pos', this.root).value || undefined });
    const q = this.q;
    $('#tr-q', this.root).innerHTML = `
      <div class="chip">${esc(TRAINER_SCENARIOS[q.scenario])} · ${esc(q.heroPos)}</div>
      <div class="prompt">${esc(q.prompt)}</div>
      <div class="mini-felt">${cardsHTML(q.cards, { size: 'lg', anim: 'deal' })}<div class="small">${esc(q.cls)}</div></div>
      <div class="answers">${q.options.map((o, i) => `<button class="btn" data-k="${o.key}">${esc(o.label)} <span class="kbd">${i + 1}</span></button>`).join('')}</div>
      <div id="tr-fb"></div>`;
    this.root.querySelectorAll('#tr-q [data-k]').forEach((b) => { b.onclick = () => this.answer(b.dataset.k); });
  }

  answer(key) {
    if (this.answered) return;
    this.answered = true;
    const q = this.q;
    const ok = key === q.correct;
    const t = this.app.state.trainer;
    t.attempts++;
    const sc = (t.byScenario[`${q.scenario}:${q.heroPos}`] ??= { attempts: 0, correct: 0 });
    sc.attempts++;
    if (ok) { t.correct++; sc.correct++; this.streak++; t.bestStreak = Math.max(t.bestStreak, this.streak); } else this.streak = 0;
    this.app.save();
    this.root.querySelectorAll('#tr-q [data-k]').forEach((b) => {
      if (b.dataset.k === q.correct) b.classList.add('right');
      else if (b.dataset.k === key) b.classList.add('wrong');
    });
    $('#tr-fb', this.root).innerHTML = `<div class="feedback ${ok ? 'right' : 'wrong'}">
      <b>${ok ? '✓ Correct' : '✗ Not quite'}</b> — ${esc(explainAnswer(q))}
      <div class="row" style="margin-top:10px"><button class="btn primary" data-next>Next <span class="kbd">Enter</span></button></div></div>`;
    $('#tr-fb [data-next]', this.root).onclick = () => this.next();
    $('#tr-chart', this.root).innerHTML = `<h3>${esc(q.chart.label)}</h3>${rangeGridHTML(q.chart, q.cls)}
      <p class="small muted">Your hand is outlined. ${term('rfi', 'RFI')} = raise first in. Hover terms for definitions.</p>`;
    this.renderScore();
  }

  renderScore() {
    const t = this.app.state.trainer;
    const weakest = Object.entries(t.byScenario)
      .filter(([, v]) => v.attempts >= 5)
      .map(([k, v]) => [k, v.correct / v.attempts])
      .sort((a, b) => a[1] - b[1])
      .slice(0, 3);
    $('#tr-score', this.root).innerHTML = `${scoreTiles([
      ['Streak', `${this.streak}${this.streak >= 5 ? ' 🔥' : ''}`, 'streak-fire'],
      ['Best', t.bestStreak],
      ['Accuracy', t.attempts ? pct(t.correct / t.attempts) : '—'],
      ['Answered', t.attempts],
    ])}
    ${weakest.length ? `<h3 style="margin-top:12px">Weakest spots</h3><ul class="opp-list">${weakest.map(([k, v]) => {
      const [sc, pos] = k.split(':');
      return `<li>${esc(TRAINER_SCENARIOS[sc])} from ${esc(pos)} — ${pct(v)}</li>`;
    }).join('')}</ul>` : ''}`;
  }
}

// ----------------------------------------------------------------- drills

export class DrillsView {
  constructor(root, app) {
    this.root = root;
    this.app = app;
    this.streak = 0;
    root.innerHTML = `
      <div class="row" style="margin-bottom:12px">
        <h2 style="margin:0">Spot drills</h2><span class="spacer"></span>
        <label class="toggle">Type <select id="dr-type"><option value="mixed">Mixed</option>${Object.entries(DRILL_TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
      </div>
      <div class="trainer-layout">
        <div class="panel question" id="dr-q"></div>
        <div>
          <div class="panel" id="dr-score"></div>
          <div class="panel" id="dr-detail"><p class="muted small">Pick the highest-EV play. "Acceptable" answers are within a small EV margin of the best and keep your streak alive (fewer points).</p></div>
        </div>
      </div>`;
    $('#dr-type', root).onchange = () => this.next();
    bindAnswerKeys(this);
  }

  activate() {
    if (!this.d) this.next();
    this.renderScore();
  }

  next() {
    this.answered = false;
    $('#dr-q', this.root).innerHTML = '<p class="muted">Dealing…</p>';
    setTimeout(() => {
      this.d = makeDrill({ type: $('#dr-type', this.root).value });
      const d = this.d;
      $('#dr-q', this.root).innerHTML = `
        <div class="chip">${esc(DRILL_TYPES[d.type])}</div>
        <div class="prompt">${esc(d.title)}</div>
        <p class="small" style="color:var(--text-2)">${esc(d.story)}</p>
        <div class="mini-felt">
          <div class="cards">${cardsHTML(d.board, { size: 'md', anim: 'deal' })}</div>
          <div class="pot">Pot ${esc(d.potFmt)}${d.toCall ? ` · to call ${esc(d.fmt(d.toCall))}` : ''}</div>
          <div class="small">You (${esc(d.position)})</div>
          ${cardsHTML(d.hero, { size: 'lg' })}
        </div>
        <div class="prompt" style="font-size:16px">What do you do?</div>
        <div class="answers">${d.options.map((o, i) => `<button class="btn" data-i="${i}">${esc(o.label)} <span class="kbd">${i + 1}</span></button>`).join('')}</div>
        <div id="dr-fb"></div>`;
      this.root.querySelectorAll('#dr-q [data-i]').forEach((b) => { b.onclick = () => this.answer(Number(b.dataset.i)); });
    }, 20);
  }

  answer(i) {
    if (this.answered) return;
    this.answered = true;
    const d = this.d;
    const o = d.options[i];
    const st = this.app.state.drills;
    st.attempts++;
    let cls;
    let head;
    if (o.correct) {
      this.streak++;
      st.correct++;
      st.points += 10 + Math.min(10, this.streak);
      cls = 'right';
      head = `✓ Best play (+${10 + Math.min(10, this.streak)} pts)`;
    } else if (o.acceptable) {
      this.streak++;
      st.correct++;
      st.points += 5;
      cls = 'ok';
      head = '≈ Acceptable — close to the best EV (+5 pts)';
    } else {
      this.streak = 0;
      cls = 'wrong';
      head = '✗ Costly choice';
    }
    st.bestStreak = Math.max(st.bestStreak, this.streak);
    this.app.save();
    const best = d.options.find((x) => x.correct);
    this.root.querySelectorAll('#dr-q [data-i]').forEach((b) => {
      const x = d.options[Number(b.dataset.i)];
      if (x.correct) b.classList.add('right');
      else if (x.acceptable) b.classList.add('ok');
      else if (x === o) b.classList.add('wrong');
    });
    const a = d.advice;
    const loss = (best.ev - o.ev) / 100;
    $('#dr-fb', this.root).innerHTML = `<div class="feedback ${cls}">
      <b>${head}</b>${!o.correct ? ` Best: <b>${esc(best.label)}</b>${loss > 0.05 ? ` (your choice costs ≈${loss.toFixed(1)}bb)` : ''}.` : ''}
      <p style="margin:8px 0 0">${esc(a.reason)}</p>
      <p class="small muted" style="margin:6px 0 0">Villain actually held ${cardsHTML(d.villainCards, { size: 'sm' })} — one hand from their range; judge the decision, not the result.</p>
      <div class="row" style="margin-top:10px"><button class="btn primary" data-next>Next spot <span class="kbd">Enter</span></button></div></div>`;
    $('#dr-fb [data-next]', this.root).onclick = () => this.next();
    $('#dr-detail', this.root).innerHTML = `
      <h3>The numbers</h3>
      <div class="metrics">
        <div class="metric"><div class="k">${term('equity', 'Equity')}</div><div class="v">${pct(a.equity)}</div><div class="sub">vs villain's estimated range</div></div>
        ${a.callAmount ? `<div class="metric"><div class="k">${term('pot-odds', 'Pot odds')}</div><div class="v">${pct(a.potOdds)}</div><div class="sub">needed to call</div></div>` : ''}
        ${a.outs ? `<div class="metric"><div class="k">${term('outs', 'Outs')}</div><div class="v">${a.outs.count}</div><div class="sub">${esc(a.analysis.drawLabel || a.analysis.label)}</div></div>` : `<div class="metric"><div class="k">Hand</div><div class="sub" style="color:var(--text)">${esc(a.analysis.label)}</div></div>`}
      </div>
      <table class="ev-table">${d.options.map((x) => `<tr class="${x.correct ? 'best' : ''}"><td>${esc(x.label)}</td><td class="num">${x.foldEquity !== undefined ? `<span class="muted small">${pct(x.foldEquity)} folds</span>` : ''}</td><td class="num">${x.ev >= 0 ? '+' : ''}${(x.ev / 100).toFixed(2)}bb</td></tr>`).join('')}</table>
      <p class="small muted">Villain range: ${esc(a.opponents[0]?.label ?? '')}. ${term('ev', 'EV')} relative to folding.</p>`;
    this.renderScore();
  }

  renderScore() {
    const st = this.app.state.drills;
    $('#dr-score', this.root).innerHTML = scoreTiles([
      ['Streak', `${this.streak}${this.streak >= 5 ? ' 🔥' : ''}`, 'streak-fire'],
      ['Best', st.bestStreak],
      ['Points', st.points],
      ['Accuracy', st.attempts ? pct(st.correct / st.attempts) : '—'],
    ]);
  }
}

// ------------------------------------------------------------------- quiz

export class QuizView {
  constructor(root, app) {
    this.root = root;
    this.app = app;
    this.streak = 0;
    root.innerHTML = `
      <div class="row" style="margin-bottom:12px">
        <h2 style="margin:0">Quiz me</h2><span class="spacer"></span>
        <label class="toggle">Topic <select id="qz-type"><option value="mixed">Mixed</option>${Object.entries(QUIZ_TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
      </div>
      <div class="trainer-layout">
        <div class="panel question" id="qz-q"></div>
        <div>
          <div class="panel" id="qz-score"></div>
          <div class="panel"><h3>Cheat sheet</h3>
            <table class="data-table"><tr><th>Bet size</th><th class="num">Equity needed</th></tr>
            ${[['¼ pot', 1 / 6], ['⅓ pot', 0.2], ['½ pot', 0.25], ['⅔ pot', 0.286], ['¾ pot', 0.3], ['Pot', 1 / 3], ['2× pot', 0.4]].map(([k, v]) => `<tr><td>${k}</td><td class="num">${pct(v)}</td></tr>`).join('')}</table>
            <p class="small muted">${term('rule-of-2-and-4')}: outs × 4 on the flop, × 2 on the turn.</p></div>
        </div>
      </div>`;
    $('#qz-type', root).onchange = () => this.next();
    bindAnswerKeys(this);
  }

  activate() {
    if (!this.q) this.next();
    this.renderScore();
  }

  next() {
    this.answered = false;
    this.q = makeQuiz({ type: $('#qz-type', this.root).value });
    const q = this.q;
    let visual = '';
    if (q.handA) {
      visual = `<div class="mini-felt"><div>${cardsHTML(q.board, { size: 'md' })}</div>
        <div class="vs"><div><span class="small">Player A</span>${cardsHTML(q.handA, { size: 'md' })}</div><div><span class="small">Player B</span>${cardsHTML(q.handB, { size: 'md' })}</div></div></div>`;
    } else if (q.hole) {
      visual = `<div class="mini-felt"><div>${cardsHTML(q.board, { size: 'md' })}</div><div class="small">Your hand</div>${cardsHTML(q.hole, { size: 'lg' })}</div>`;
    }
    $('#qz-q', this.root).innerHTML = `
      <div class="chip">${esc(QUIZ_TYPES[q.type])}</div>
      <div class="prompt">${esc(q.prompt)}</div>
      ${visual}
      <div class="answers">${q.options.map((o, i) => `<button class="btn" data-i="${i}">${esc(o.label)} <span class="kbd">${i + 1}</span></button>`).join('')}</div>
      <div id="qz-fb"></div>`;
    this.root.querySelectorAll('#qz-q [data-i]').forEach((b) => { b.onclick = () => this.answer(Number(b.dataset.i)); });
  }

  answer(i) {
    if (this.answered) return;
    this.answered = true;
    const q = this.q;
    const ok = q.options[i].correct;
    const st = this.app.state.quiz;
    st.attempts++;
    if (ok) { st.correct++; this.streak++; st.bestStreak = Math.max(st.bestStreak, this.streak); } else this.streak = 0;
    this.app.save();
    this.root.querySelectorAll('#qz-q [data-i]').forEach((b) => {
      const o = q.options[Number(b.dataset.i)];
      if (o.correct) b.classList.add('right');
      else if (Number(b.dataset.i) === i) b.classList.add('wrong');
    });
    $('#qz-fb', this.root).innerHTML = `<div class="feedback ${ok ? 'right' : 'wrong'}"><b>${ok ? '✓ Correct' : '✗ Not quite'}</b> — ${esc(q.explanation)}
      ${q.outCards ? `<div class="row" style="margin-top:6px"><span class="small muted">Outs:</span> ${cardsHTML(q.outCards, { size: 'sm' })}</div>` : ''}
      <div class="row" style="margin-top:10px"><button class="btn primary" data-next>Next <span class="kbd">Enter</span></button></div></div>`;
    $('#qz-fb [data-next]', this.root).onclick = () => this.next();
    this.renderScore();
  }

  renderScore() {
    const st = this.app.state.quiz;
    $('#qz-score', this.root).innerHTML = scoreTiles([
      ['Streak', `${this.streak}${this.streak >= 5 ? ' 🔥' : ''}`, 'streak-fire'],
      ['Best', st.bestStreak],
      ['Accuracy', st.attempts ? pct(st.correct / st.attempts) : '—'],
      ['Answered', st.attempts],
    ]);
  }
}

