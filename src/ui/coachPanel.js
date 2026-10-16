/**
 * ui/coachPanel.js — renders coach advice: recommendation, pot odds vs
 * equity, outs, hand strength, opponent ranges, EV of each option and (preflop)
 * the relevant chart with your hand highlighted.
 */
import { esc, pct, term, bbFmt, cardsHTML, rangeGridHTML } from './dom.js';

export function recText(advice) {
  const r = advice.recommendation;
  const bb = advice.bb;
  if (advice.preflop) {
    if (r.type === 'raise') {
      const verb = advice.legal.isBet ? 'Bet' : advice.preflop.scenario === 'rfi' ? 'Open' : advice.preflop.scenario === 'vsOpen' ? '3-bet' : advice.preflop.scenario.startsWith('vs3bet') ? '4-bet' : 'Raise';
      return `${verb} to ${bbFmt(r.amount, bb)}`;
    }
    if (r.type === 'call') return `Call ${bbFmt(advice.callAmount, bb)}`;
    return r.type[0].toUpperCase() + r.type.slice(1);
  }
  return r.label ?? r.type;
}

export function coachHTML(advice) {
  const a = advice;
  const bb = a.bb;
  const metrics = [];
  const showOdds = a.callAmount > 0 && !(a.preflop && ['rfi', 'vsLimp', 'bbVsLimp'].includes(a.preflop.scenario));
  if (showOdds) {
    metrics.push(`<div class="metric"><div class="k">${term('pot-odds', 'Pot odds')}</div><div class="v">${pct(a.potOdds)}</div><div class="sub">equity needed to call ${bbFmt(a.callAmount, bb)}</div></div>`);
  }
  const eqGood = showOdds && !a.preflop ? a.equity >= a.potOdds : null;
  metrics.push(`<div class="metric"><div class="k">${term('equity', 'Equity')} vs ${term('range', 'ranges')}</div>
    <div class="v">${pct(a.equity)}</div>
    <div class="eqbar"><div class="fill" style="width:${(a.equity * 100).toFixed(1)}%"></div>${showOdds ? `<div class="need" style="left:${(a.potOdds * 100).toFixed(1)}%" title="needed"></div>` : ''}</div>
    <div class="sub">${eqGood === null ? `${a.opponents.length} opponent${a.opponents.length > 1 ? 's' : ''}` : eqGood ? 'above the price ✓' : 'below the price ✗'}</div></div>`);
  if (a.outs) {
    const approx = pct(a.outs.approxEquity);
    metrics.push(`<div class="metric"><div class="k">${term('outs', 'Outs')}</div><div class="v">${a.outs.count}${a.outs.pairOuts ? `<span class="small muted"> +${a.outs.pairOuts}</span>` : ''}</div>
      <div class="sub">${term('rule-of-2-and-4', '≈' + approx)} to improve${a.outs.pairOuts ? `; +${a.outs.pairOuts} weaker pair outs` : ''}</div></div>`);
  }
  const handTxt = a.preflop ? `${a.handClass} · top ${pct(a.preflop.percentile)}` : [a.analysis.label, a.analysis.drawLabel].filter(Boolean).join(' + ');
  metrics.push(`<div class="metric"><div class="k">Your hand</div><div class="sub" style="font-size:14px;color:var(--text)">${esc(handTxt)}</div>
    <div class="sub">${esc(a.position)} · ${a.preflop ? '' : a.inPosition ? 'in position' : 'out of position'}${a.spr !== null && a.spr !== undefined ? ` · ${term('spr', 'SPR')} ${a.spr.toFixed(1)}` : ''}</div></div>`);

  let detail = '';
  if (a.preflop) {
    detail = `<h3>${esc(a.preflop.chartLabel)}</h3>${rangeGridHTML(a.preflop.chart, a.handClass, { mini: true })}`;
  } else if (a.options) {
    detail = `<h3>${term('ev', 'EV')} of each option</h3><table class="ev-table">${a.options.map((o, i) => `
      <tr class="${i === 0 ? 'best' : ''}"><td>${esc(o.label)}</td>
      <td class="num">${o.foldEquity !== undefined ? `<span class="muted small">${pct(o.foldEquity)} folds</span>` : ''}</td>
      <td class="num">${o.ev >= 0 ? '+' : ''}${(o.ev / bb).toFixed(2)}bb</td></tr>`).join('')}</table>
      <p class="small muted">EV relative to folding now; simplified one-street model.</p>`;
  }

  const opps = a.opponents.map((o) => `<li><b>${esc(o.name)}</b> (${esc(o.position)}): ${esc(o.label)} <span class="muted">· ~${pct(o.size)} preflop</span></li>`).join('');

  return `
    <div class="rec"><span class="muted small">Coach says</span><span class="what">${esc(recText(a))}</span></div>
    <p class="reason">${esc(a.reason)}</p>
    <div class="metrics">${metrics.join('')}</div>
    ${detail}
    <h3 style="margin-top:12px">Estimated ${term('range', 'ranges')}</h3>
    <ul class="opp-list">${opps}</ul>`;
}

/** Post-hand summary with graded decisions. */
export function summaryHTML(summary, game, history) {
  const net = summary.net;
  const shown = summary.graded.filter((g) => !g.trivial);
  const trivial = summary.graded.length - shown.length;
  const list = shown.map((g) => `<li>
      <div class="row"><span class="grade ${g.grade}">${g.grade}</span><span class="chip">${esc(g.street)}</span>
      ${g.evLoss > 0.05 ? `<span class="muted small">−${g.evLoss.toFixed(1)}bb EV</span>` : ''}</div>
      ${esc(g.explanation)}</li>`).join('');
  const board = history.board.length ? cardsHTML(history.board, { size: 'sm' }) : '';
  return `
    <div class="panel-head"><h3>Hand #${history.handNumber}</h3><span class="net ${net > 0 ? 'pos' : net < 0 ? 'neg' : ''}">${net > 0 ? '+' : ''}${net.toFixed(1)}bb</span></div>
    <div class="row" style="margin-bottom:6px">${cardsHTML(game.players[0].holeCards, { size: 'sm' })} ${board}</div>
    ${shown.length ? `<ul class="summary-list">${list}</ul>` : '<p class="muted small">No real decisions this hand.</p>'}
    ${trivial ? `<p class="muted small">+ ${trivial} routine fold${trivial > 1 ? 's' : ''} (not graded).</p>` : ''}
    <div class="row" style="margin-top:10px">
      <button class="btn primary" data-act="next">Next hand <span class="kbd">Space</span></button>
      <button class="btn" data-act="review">Replay hand</button>
    </div>`;
}
