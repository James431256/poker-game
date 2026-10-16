/**
 * ui/statsView.js — stats dashboard: stat tiles with healthy ranges, a
 * cumulative winnings chart (single series, crosshair tooltip), positional
 * breakdown, leak detection, opponent notes, level progression and reset.
 */
import { $, esc, pct, term, signed, modal, toast } from './dom.js';
import { derive, detectLeaks, classifyStyle } from '../stats.js';
import { LEVELS, nextLevelProgress } from '../progression.js';
import { BOT_PROFILES } from '../bots.js';
import { resetState } from '../storage.js';
import { STYLE_REVEAL_HANDS } from '../session.js';

const EXPLOIT_TIPS = {
  rock: 'Steal their blinds; fold to their raises unless strong.',
  lag: 'Call down lighter, trap with strong hands, 4-bet value wider.',
  station: 'Value-bet thinly and big; almost never bluff.',
  reg: 'Play solid fundamentals; avoid marginal spots out of position.',
  maniac: 'Let them bluff: check-call strong hands, widen your calling ranges.',
};

// [label, key, glossary term, healthy low, high, min sample key]
const TILES = [
  ['VPIP', 'vpip', 'vpip', 0.2, 0.27, 'hands', 30],
  ['PFR', 'pfr', 'pfr', 0.16, 0.23, 'hands', 30],
  ['Aggression factor', 'af', 'af', 2, 4, 'post', 20],
  ['3-bet', 'threeBet', '3bet', 0.06, 0.11, 'threeBetOpp', 15],
  ['Fold to 3-bet', 'foldTo3bet', '3bet', 0.45, 0.62, 'foldTo3betOpp', 6],
  ['C-bet', 'cbet', 'cbet', 0.5, 0.75, 'cbetOpp', 8],
  ['Fold to c-bet', 'foldToCbet', 'cbet', 0.35, 0.55, 'foldToCbetOpp', 8],
  ['Fold to river bet', 'riverFold', 'pot-odds', 0.3, 0.55, 'riverFacedOpp', 8],
  ['WTSD', 'wtsd', 'wtsd', 0.24, 0.33, 'sawFlop', 20],
  ['W$SD', 'wsd', 'wtsd', 0.48, 0.6, 'wtsd', 12],
];

export class StatsView {
  constructor(root, app) {
    this.root = root;
    this.app = app;
  }

  activate() {
    this.render();
  }

  render() {
    const st = this.app.state;
    const t = st.hero;
    const d = derive(t);
    const leaks = detectLeaks(t);
    const fmtVal = (key, v) => (v === null || v === undefined ? '—' : key === 'af' ? (v === Infinity ? '∞' : v.toFixed(2)) : pct(v));

    const headline = `
      <div class="tile"><div class="k">Hands played</div><div class="v">${t.hands}</div><div class="hint">at the table</div></div>
      <div class="tile"><div class="k">Win rate (${term('bb-100', 'bb/100')})</div><div class="v">${d.bb100 === null ? '—' : signed(d.bb100)}</div><div class="hint">${t.hands < 500 ? 'high variance below ~500 hands' : '+5 is a strong win rate'}</div></div>
      <div class="tile"><div class="k">Net won</div><div class="v">${signed(t.netBB)}bb</div><div class="hint">all sessions</div></div>
      <div class="tile"><div class="k">Decision accuracy</div><div class="v">${pct(d.accuracy)}</div><div class="hint">${t.grades.good} good · ${t.grades.marginal} marginal · ${t.grades.mistake} mistakes</div></div>
      <div class="tile"><div class="k">EV lost to mistakes</div><div class="v">${t.evLossBB.toFixed(1)}bb</div><div class="hint">${t.hands ? `${((t.evLossBB / t.hands) * 100).toFixed(1)}bb/100 estimated` : '—'}</div></div>`;

    const tiles = TILES.map(([label, key, glos, lo, hi, sampleKey, min]) => {
      const sample = sampleKey === 'post' ? t.postBets + t.postCalls : t[sampleKey];
      const v = d[key];
      const enough = sample >= min && v !== null;
      const ok = enough && v >= lo && v <= hi;
      const range = key === 'af' ? `${lo}–${hi}` : `${Math.round(lo * 100)}–${Math.round(hi * 100)}%`;
      return `<div class="tile"><div class="k">${term(glos, label)}</div><div class="v">${fmtVal(key, v)}</div>
        <div class="hint">healthy ${range} · n=${sample}</div>
        ${enough ? `<div class="flag ${ok ? 'ok' : 'off'}">${ok ? '✓ in range' : v < lo ? '▼ low' : '▲ high'}</div>` : '<div class="flag muted">needs more hands</div>'}</div>`;
    }).join('');

    const positions = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'].map((p) => {
      const x = t.byPosition[p];
      if (!x) return `<tr><td>${p}</td><td class="num">0</td><td class="num">—</td><td class="num">—</td><td class="num">—</td><td class="num">—</td></tr>`;
      return `<tr><td>${p}</td><td class="num">${x.hands}</td><td class="num">${pct(x.vpip / x.hands)}</td><td class="num">${pct(x.pfr / x.hands)}</td>
        <td class="num">${signed(x.netBB)}</td><td class="num">${x.hands >= 20 ? signed((x.netBB / x.hands) * 100) : '—'}</td></tr>`;
    }).join('');

    const leakHTML = leaks.length
      ? leaks.map((l) => `<div class="leak sev${l.severity}"><div class="t">${esc(l.title)}</div><div class="small" style="color:var(--text-2)">${esc(l.advice)}</div></div>`).join('')
      : `<p class="muted small">${t.hands < 30 ? 'Play at least 30 hands for leak detection.' : 'No major leaks detected — keep it up!'}</p>`;

    const progress = nextLevelProgress(t, st.unlockedLevel);
    const levels = LEVELS.map((L) => {
      const locked = L.level > st.unlockedLevel;
      return `<li class="${locked ? 'lock' : ''}">
        <div style="flex:1"><b>${L.level}. ${esc(L.name)}</b> ${L.level === st.level ? '<span class="chip">current</span>' : ''}<div class="small muted">${esc(L.blurb)}</div>
        ${locked && progress && progress.next.level === L.level ? progress.items.map((it) => `<div class="small">${esc(it.label)}: ${it.fmt(it.have)} / ${it.fmt(it.need)} ${it.done ? '✓' : ''}
          <div class="progress"><div style="width:${Math.min(100, Math.max(0, (it.have / (it.need || 1)) * 100))}%"></div></div></div>`).join('') : ''}</div>
        ${locked ? '🔒' : L.level !== st.level ? `<button class="btn small" data-level="${L.level}">Play here</button>` : ''}</li>`;
    }).join('');

    const opponents = BOT_PROFILES.map((p) => {
      const o = st.bots[p.id];
      const style = classifyStyle(o, STYLE_REVEAL_HANDS);
      const od = o ? derive(o) : null;
      return `<tr><td>${p.avatar} ${esc(p.name)}</td><td class="num">${o?.hands ?? 0}</td>
        <td class="num">${od ? `${pct(od.vpip)}/${pct(od.pfr)}` : '—'}</td>
        <td>${style ? `<b>${esc(style.label)}</b><div class="small muted">${esc(EXPLOIT_TIPS[style.key])}</div>` : `<span class="muted small">reading… ${o?.hands ?? 0}/${STYLE_REVEAL_HANDS}</span>`}</td></tr>`;
    }).join('');

    const practice = `<p class="small muted">Preflop trainer: ${st.trainer.attempts} answered (${pct(st.trainer.attempts ? st.trainer.correct / st.trainer.attempts : null)}), best streak ${st.trainer.bestStreak}.
      Drills: ${st.drills.points} pts, best streak ${st.drills.bestStreak}. Quiz: ${pct(st.quiz.attempts ? st.quiz.correct / st.quiz.attempts : null)} over ${st.quiz.attempts}.</p>`;

    this.root.innerHTML = `
      <div class="row" style="margin-bottom:12px"><h2 style="margin:0">Your stats</h2><span class="spacer"></span>
        <button class="btn small danger" data-reset>Reset progress</button></div>
      <div class="tiles">${headline}</div>
      <div class="stats-grid">
        <div>
          <div class="panel"><div class="panel-head"><h3>Cumulative winnings (bb)</h3><span class="muted small">last ${t.recentNet.length} hands</span></div>
            <div class="chart" id="win-chart"></div>
            <details><summary class="muted small">Data table (last 20 hands)</summary>${this.recentTable(t.recentNet)}</details></div>
          <div class="panel"><h3>Leaks &amp; advice</h3>${leakHTML}</div>
          <div class="panel"><h3>Detailed stats</h3><div class="tiles">${tiles}</div></div>
        </div>
        <div>
          <div class="panel"><h3>Table levels</h3><ul class="level-list">${levels}</ul></div>
          <div class="panel"><h3>By position</h3><table class="data-table"><tr><th>Pos</th><th class="num">Hands</th><th class="num">VPIP</th><th class="num">PFR</th><th class="num">Net bb</th><th class="num">bb/100</th></tr>${positions}</table><p class="small muted">bb/100 shown after 20 hands in a position.</p></div>
          <div class="panel"><h3>Opponent notes</h3><table class="data-table"><tr><th>Player</th><th class="num">Hands</th><th class="num">VPIP/PFR</th><th>Read</th></tr>${opponents}</table></div>
          <div class="panel"><h3>Practice</h3>${practice}</div>
        </div>
      </div>`;

    this.drawChart($('#win-chart', this.root), t.recentNet);
    this.root.querySelectorAll('[data-level]').forEach((b) => {
      b.onclick = () => {
        this.app.session.setLevel(Number(b.dataset.level));
        this.app.refreshBadge();
        this.app.views.play.renderLevelSelect();
        toast('Table changed — takes effect from the next hand.');
        this.render();
      };
    });
    $('[data-reset]', this.root).onclick = () => {
      const m = modal(`<h2>Reset all progress?</h2><p>This deletes your stats, hand histories, mistake log and unlocked levels from this browser.</p>
        <div class="row"><span class="spacer"></span><button class="btn" data-close>Cancel</button><button class="btn danger" data-confirm>Reset</button></div>`);
      m.el.querySelector('[data-confirm]').onclick = () => {
        resetState();
        location.reload();
      };
    };
  }

  recentTable(series) {
    const last = series.slice(-20);
    const start = series.length - last.length;
    return `<table class="data-table"><tr><th>Hand</th><th class="num">Result (bb)</th></tr>${last.map((v, i) => `<tr><td>${start + i + 1}</td><td class="num">${signed(v)}</td></tr>`).join('')}</table>`;
  }

  /** Single-series line chart of cumulative bb with crosshair + tooltip. */
  drawChart(el, series) {
    if (series.length < 2) {
      el.innerHTML = '<p class="muted small">Play a few hands to see your graph.</p>';
      return;
    }
    const cum = [];
    let s = 0;
    for (const v of series) cum.push((s += v));
    const W = 640;
    const H = 220;
    const m = { l: 44, r: 12, t: 10, b: 24 };
    const min = Math.min(0, ...cum);
    const max = Math.max(0, ...cum);
    const step = niceStep((max - min) / 4 || 1);
    const lo = Math.floor(min / step) * step;
    const hi = Math.ceil(max / step) * step || step;
    const x = (i) => m.l + (i / (cum.length - 1)) * (W - m.l - m.r);
    const y = (v) => m.t + (1 - (v - lo) / (hi - lo)) * (H - m.t - m.b);
    let grid = '';
    for (let v = lo; v <= hi + 1e-9; v += step) {
      grid += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/><text x="${m.l - 6}" y="${y(v) + 4}" text-anchor="end" class="axis-label">${Math.round(v)}</text>`;
    }
    const path = cum.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Cumulative winnings over ${cum.length} hands, ending at ${cum[cum.length - 1].toFixed(1)} big blinds">
      <g class="grid axis">${grid}</g>
      <line class="zero" x1="${m.l}" x2="${W - m.r}" y1="${y(0)}" y2="${y(0)}"/>
      <g class="axis"><text x="${m.l}" y="${H - 6}">1</text><text x="${W - m.r}" y="${H - 6}" text-anchor="end">${cum.length}</text></g>
      <path class="series" d="${path}"/>
      <line class="cross" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" visibility="hidden"/>
      <circle class="dot" r="4" visibility="hidden"/>
      <rect x="${m.l}" y="0" width="${W - m.l - m.r}" height="${H}" fill="transparent" class="hit"/>
    </svg><div class="chart-tip" hidden></div>`;
    const svg = el.querySelector('svg');
    const cross = svg.querySelector('.cross');
    const dot = svg.querySelector('.dot');
    const tip = el.querySelector('.chart-tip');
    const move = (clientX) => {
      const r = svg.getBoundingClientRect();
      const px = ((clientX - r.left) / r.width) * W;
      const i = Math.max(0, Math.min(cum.length - 1, Math.round(((px - m.l) / (W - m.l - m.r)) * (cum.length - 1))));
      cross.setAttribute('x1', x(i));
      cross.setAttribute('x2', x(i));
      dot.setAttribute('cx', x(i));
      dot.setAttribute('cy', y(cum[i]));
      cross.setAttribute('visibility', 'visible');
      dot.setAttribute('visibility', 'visible');
      tip.hidden = false;
      tip.innerHTML = `Hand ${i + 1}: <b>${signed(cum[i])}bb</b> <span class="muted">(${signed(series[i])})</span>`;
      tip.style.left = `${(x(i) / W) * r.width}px`;
      tip.style.top = `${(y(cum[i]) / H) * r.height}px`;
    };
    const hide = () => { cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); tip.hidden = true; };
    svg.addEventListener('pointermove', (e) => move(e.clientX));
    svg.addEventListener('pointerleave', hide);
  }
}

function niceStep(raw) {
  const p = 10 ** Math.floor(Math.log10(raw));
  const n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}
