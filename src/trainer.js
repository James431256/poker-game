/**
 * trainer.js — preflop chart trainer question generator.
 *
 * Questions are biased toward hands near the edge of the correct range,
 * because those are the ones players actually get wrong.
 */
import { ALL_CLASSES, combosOf, getChart, chartAction, handPercentile, rangeSize } from './ranges.js';
import { createRng } from './deck.js';

const ORDER = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'];

export const TRAINER_SCENARIOS = {
  rfi: 'Open (raise first in)',
  vsOpen: 'Facing an open',
  vs3bet: 'Facing a 3-bet',
};

/**
 * @param {{scenario?:string, position?:string, rng?:function}} [opts]
 */
export function makePreflopQuestion({ scenario, position, rng = createRng() } = {}) {
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  if (!scenario || scenario === 'mixed') {
    const r = rng();
    scenario = r < 0.45 ? 'rfi' : r < 0.85 ? 'vsOpen' : 'vs3bet';
  }
  let heroPos;
  let villainPos = null;
  if (scenario === 'rfi') {
    const allowed = ['UTG', 'HJ', 'CO', 'BTN', 'SB'];
    heroPos = allowed.includes(position) ? position : pick(allowed);
  } else if (scenario === 'vsOpen') {
    const allowed = ['HJ', 'CO', 'BTN', 'SB', 'BB'];
    heroPos = allowed.includes(position) ? position : pick(allowed);
    villainPos = pick(ORDER.slice(0, ORDER.indexOf(heroPos)).filter((p) => p !== 'BB'));
  } else {
    const allowed = ['UTG', 'HJ', 'CO', 'BTN', 'SB'];
    heroPos = allowed.includes(position) ? position : pick(allowed);
    villainPos = pick(ORDER.slice(ORDER.indexOf(heroPos) + 1));
  }
  const chart = getChart(scenario, heroPos, villainPos);

  // Weighted sampling toward the range boundary.
  const playable = new Set([...chart.raise, ...chart.call]);
  let edge = 0;
  for (const c of playable) edge = Math.max(edge, handPercentile(c));
  const weights = ALL_CLASSES.map((c) => {
    const d = Math.abs(handPercentile(c) - edge);
    return 1 / (0.04 + d) + (playable.has(c) ? 2 : 0);
  });
  const total = weights.reduce((s, w) => s + w, 0);
  let x = rng() * total;
  let cls = ALL_CLASSES[0];
  for (let i = 0; i < ALL_CLASSES.length; i++) {
    x -= weights[i];
    if (x <= 0) { cls = ALL_CLASSES[i]; break; }
  }
  const combos = combosOf(cls);
  const cards = combos[Math.floor(rng() * combos.length)];

  const raiseLabel = scenario === 'rfi' ? 'Raise' : scenario === 'vsOpen' ? '3-Bet' : '4-Bet';
  const options = scenario === 'rfi' || chart.call.size === 0
    ? [{ key: 'fold', label: 'Fold' }, { key: 'raise', label: raiseLabel }]
    : [{ key: 'fold', label: 'Fold' }, { key: 'call', label: 'Call' }, { key: 'raise', label: raiseLabel }];

  let prompt;
  if (scenario === 'rfi') prompt = `Folded to you in the ${heroPos}. What do you do?`;
  else if (scenario === 'vsOpen') prompt = `${villainPos} opens to 2.5bb. You are in the ${heroPos}.`;
  else prompt = `You opened from the ${heroPos}; ${villainPos} 3-bets.`;

  return {
    scenario, heroPos, villainPos, cls, cards, chart, options, prompt,
    correct: chartAction(chart, cls),
    rangePct: rangeSize(playable),
  };
}

/** Explanation shown after answering. */
export function explainAnswer(q) {
  const verb = { raise: q.options.find((o) => o.key === 'raise').label.toLowerCase(), call: 'call', fold: 'fold' }[q.correct];
  const where = q.scenario === 'rfi' ? `opening from the ${q.heroPos}` : q.scenario === 'vsOpen' ? `in the ${q.heroPos} against a ${q.villainPos} open` : `after opening ${q.heroPos} and facing a ${q.villainPos} 3-bet`;
  const pctTxt = `${Math.round(q.rangePct * 100)}% of hands`;
  return `${q.cls}: ${verb} ${where}. This chart plays ${pctTxt}.`;
}
