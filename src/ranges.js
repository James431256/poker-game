/**
 * ranges.js — starting-hand classes, range notation parsing, preflop
 * strength ordering and the 6-max 100bb preflop charts used by the coach,
 * the chart trainer and the bots.
 *
 * Charts are simplified "solid modern" ranges — not solver-exact, but close
 * enough that following them is a big step up for most players.
 */
import { RANKS, makeCard, cardRank, cardSuit } from './deck.js';

// Rank indices high→low for the 13x13 grid (A first).
const GRID_RANKS = [...RANKS].reverse(); // 'AKQJT98765432'

/** Hand class for two hole cards, e.g. "AKs", "T9o", "77". */
export function handClass(c1, c2) {
  let r1 = cardRank(c1);
  let r2 = cardRank(c2);
  if (r1 < r2) [r1, r2] = [r2, r1];
  if (r1 === r2) return RANKS[r1] + RANKS[r2];
  return RANKS[r1] + RANKS[r2] + (cardSuit(c1) === cardSuit(c2) ? 's' : 'o');
}

/** All 169 classes in grid order (row = first card, suited above diagonal). */
export const ALL_CLASSES = (() => {
  const out = [];
  for (let i = 0; i < 13; i++) {
    for (let j = 0; j < 13; j++) out.push(gridClass(i, j));
  }
  return out;
})();

/** Class at grid row i / column j (0 = Ace). */
export function gridClass(i, j) {
  const a = GRID_RANKS[i];
  const b = GRID_RANKS[j];
  if (i === j) return a + b;
  return i < j ? a + b + 's' : b + a + 'o';
}

export const comboCount = (cls) => (cls.length === 2 ? 6 : cls[2] === 's' ? 4 : 12);

/** Every specific two-card combo for a class, as [card, card] pairs. */
export function combosOf(cls) {
  const hi = RANKS.indexOf(cls[0]);
  const lo = RANKS.indexOf(cls[1]);
  const out = [];
  for (let s1 = 0; s1 < 4; s1++) {
    for (let s2 = 0; s2 < 4; s2++) {
      if (hi === lo) {
        if (s2 > s1) out.push([makeCard(hi, s1), makeCard(lo, s2)]);
      } else if (cls[2] === 's' ? s1 === s2 : s1 !== s2) {
        out.push([makeCard(hi, s1), makeCard(lo, s2)]);
      }
    }
  }
  return out;
}

/**
 * Parse range notation into a Set of hand classes. Supports:
 *   "QQ", "AKs", "AKo", "AK" (both), "77+", "A9s+", "KTo+",
 *   "22-66", "A2s-A5s", comma separated.
 */
export function parseRange(str) {
  const set = new Set();
  if (!str) return set;
  for (let tok of str.split(',')) {
    tok = tok.trim();
    if (!tok) continue;
    if (tok.includes('-')) {
      const [a, b] = tok.split('-').map((t) => t.trim());
      const suffix = a.slice(2);
      const hiA = RANKS.indexOf(a[0]);
      const loA = RANKS.indexOf(a[1]);
      const loB = RANKS.indexOf(b[1]);
      if (hiA === loA) {
        // pair range "22-66"
        const [x, y] = [hiA, RANKS.indexOf(b[0])].sort((m, n) => m - n);
        for (let r = x; r <= y; r++) set.add(RANKS[r] + RANKS[r]);
      } else {
        const [x, y] = [loA, loB].sort((m, n) => m - n);
        for (let r = x; r <= y; r++) addClass(set, a[0] + RANKS[r] + suffix);
      }
    } else if (tok.endsWith('+')) {
      const base = tok.slice(0, -1);
      const hi = RANKS.indexOf(base[0]);
      const lo = RANKS.indexOf(base[1]);
      const suffix = base.slice(2);
      if (hi === lo) for (let r = hi; r <= 12; r++) set.add(RANKS[r] + RANKS[r]);
      else for (let r = lo; r < hi; r++) addClass(set, base[0] + RANKS[r] + suffix);
    } else addClass(set, tok);
  }
  return set;
}

function addClass(set, cls) {
  if (cls.length === 2 && cls[0] !== cls[1]) {
    set.add(cls + 's');
    set.add(cls + 'o');
  } else set.add(cls);
}

// ------------------------------------------------------------ strength order

/**
 * Chen-formula score — a classic quick preflop strength heuristic. We use it
 * only to order hands (for bots' "top X%" decisions and drill sampling).
 */
export function chenScore(cls) {
  const hi = RANKS.indexOf(cls[0]);
  const lo = RANKS.indexOf(cls[1]);
  const pts = (r) => (r === 12 ? 10 : r === 11 ? 8 : r === 10 ? 7 : r === 9 ? 6 : (r + 2) / 2);
  let score = pts(hi);
  if (hi === lo) return Math.max(5, score * 2);
  if (cls[2] === 's') score += 2;
  const gap = hi - lo - 1;
  score -= [0, 1, 2, 4][gap] ?? 5;
  if (gap <= 1 && hi < 10) score += 1;
  return score;
}

/** Classes from strongest to weakest, with cumulative combo percentile. */
export const STRENGTH_ORDER = [...ALL_CLASSES].sort((a, b) => {
  const d = chenScore(b) - chenScore(a);
  if (d) return d;
  // tie-break: higher top card, then higher second card, suited first
  return RANKS.indexOf(b[0]) - RANKS.indexOf(a[0]) || RANKS.indexOf(b[1]) - RANKS.indexOf(a[1]) || (a[2] === 's' ? -1 : 1);
});

const PERCENTILE = (() => {
  const map = {};
  let cum = 0;
  for (const cls of STRENGTH_ORDER) {
    cum += comboCount(cls);
    map[cls] = cum / 1326; // fraction of all combos at least this strong
  }
  return map;
})();

/** 0..1 — what fraction of hands is at least as strong (lower = stronger). */
export const handPercentile = (cls) => PERCENTILE[cls];

/** Set of classes making up the top `fraction` of hands. */
export function topRange(fraction) {
  const set = new Set();
  for (const cls of STRENGTH_ORDER) if (PERCENTILE[cls] <= fraction + 1e-9) set.add(cls);
  return set;
}

/** Fraction of all 1326 combos covered by a set of classes. */
export const rangeSize = (set) => [...set].reduce((s, c) => s + comboCount(c), 0) / 1326;

// ------------------------------------------------------------------ charts

/** Raise-first-in (open) ranges by position. */
export const RFI = {
  UTG: '55+, A2s+, K9s+, Q9s+, J9s+, T9s, 98s, 87s, 76s, ATo+, KJo+, QJo',
  HJ: '44+, A2s+, K8s+, Q9s+, J9s+, T8s+, 98s, 87s, 76s, 65s, A9o+, KTo+, QTo+, JTo',
  CO: '22+, A2s+, K5s+, Q8s+, J8s+, T8s+, 97s+, 86s+, 75s+, 65s, 54s, A7o+, A5o, K9o+, Q9o+, J9o+, T9o',
  BTN: '22+, A2s+, K2s+, Q4s+, J6s+, T6s+, 96s+, 85s+, 74s+, 64s+, 53s+, 43s, A2o+, K8o+, Q9o+, J8o+, T8o+, 98o, 87o',
  SB: '22+, A2s+, K4s+, Q6s+, J7s+, T7s+, 97s+, 86s+, 75s+, 65s, 54s, A4o+, K9o+, Q9o+, J9o+, T9o',
};

/**
 * Facing a single open. Keyed by hero position, then by opener group:
 * EP = UTG/HJ open, LP = CO/BTN open, SB = small blind open.
 */
export const VS_OPEN = {
  HJ: { EP: { raise: 'QQ+, AKs, AKo, A5s, A4s', call: '88-JJ, AJs-AQs, KQs, QJs' } },
  CO: { EP: { raise: 'QQ+, AKs, AKo, AQs, A5s, A4s, KQs', call: '77-JJ, ATs-AJs, KJs, QJs, JTs, T9s, AQo' } },
  BTN: {
    EP: { raise: 'QQ+, AKs, AKo, A5s, A4s, KQs, 76s', call: '22-JJ, ATs-AQs, KTs-KJs, QTs+, JTs, T9s, 98s, 87s, AQo, AJo, KQo' },
    LP: { raise: 'TT+, AQs+, AKo, AQo, A5s-A3s, KJs+, 76s, 65s', call: '22-99, A9s-AJs, KTs, QTs+, J9s+, T9s, 98s, 87s, AJo, KQo' },
  },
  SB: {
    EP: { raise: 'TT+, AQs+, AKo, A5s, KQs', call: '' },
    LP: { raise: '88+, ATs+, A5s-A2s, KTs+, QTs+, JTs, T9s, AJo+, KQo', call: '' },
  },
  BB: {
    EP: { raise: 'QQ+, AKs, AKo, A5s', call: '22-JJ, A2s-AQs, K9s+, Q9s+, J9s+, T8s+, 97s+, 86s+, 76s, 65s, 54s, ATo+, KJo+, QJo' },
    LP: { raise: 'TT+, AJs+, A5s-A3s, KQs, AQo+, 65s', call: '22-99, A2s-ATs, K5s-KJs, Q7s+, J7s+, T7s+, 96s+, 85s+, 75s+, 64s+, 54s, A2o-AJo, K9o+, Q9o+, J9o+, T9o, 98o' },
    SB: { raise: '99+, ATs+, A5s-A2s, KJs+, AJo+, KQo', call: '22-88, A2s-A9s, K2s-KTs, Q5s+, J7s+, T7s+, 96s+, 85s+, 74s+, 64s+, 53s+, A2o-ATo, K7o-KJo, Q8o+, J8o+, T8o+, 98o, 87o' },
  },
};

/** Opener facing a 3-bet. EP = opened from UTG/HJ, LP = opened CO/BTN/SB. */
export const VS_3BET = {
  EP: { raise: 'QQ+, AKs, AKo, A5s', call: 'TT-JJ, AJs-AQs, KQs, KJs, QJs, JTs, AQo' },
  LP: { raise: 'QQ+, AKs, AKo, A5s, A4s', call: '77-JJ, ATs-AQs, KTs+, QTs+, JTs, T9s, 98s, AJo+, KQo' },
};

export const openerGroup = (pos) => (pos === 'UTG' || pos === 'HJ' ? 'EP' : pos === 'SB' ? 'SB' : 'LP');

// Parse once and cache.
const cache = new Map();
export function rangeSet(str) {
  if (!cache.has(str)) cache.set(str, parseRange(str));
  return cache.get(str);
}

/**
 * Look up the chart for a preflop situation.
 * @param {'rfi'|'vsOpen'|'vs3bet'} scenario
 * @param {string} heroPos
 * @param {string} [villainPos] opener (vsOpen) or 3-bettor (vs3bet)
 * @returns {{raise:Set<string>, call:Set<string>, label:string}|null}
 */
export function getChart(scenario, heroPos, villainPos) {
  if (scenario === 'rfi') {
    if (!RFI[heroPos]) return null;
    return { raise: rangeSet(RFI[heroPos]), call: new Set(), label: `${heroPos} open` };
  }
  if (scenario === 'vsOpen') {
    const byHero = VS_OPEN[heroPos];
    if (!byHero) return null;
    let group = openerGroup(villainPos);
    // Hero on BTN facing an EP/LP open etc.; fall back to the nearest chart.
    if (!byHero[group]) group = byHero.LP ? 'LP' : 'EP';
    const c = byHero[group];
    return { raise: rangeSet(c.raise), call: rangeSet(c.call), label: `${heroPos} vs ${villainPos} open` };
  }
  if (scenario === 'vs3bet') {
    const c = VS_3BET[openerGroup(heroPos) === 'EP' ? 'EP' : 'LP'];
    return { raise: rangeSet(c.raise), call: rangeSet(c.call), label: `${heroPos} open, facing ${villainPos ?? ''} 3-bet`.replace('  ', ' ') };
  }
  return null;
}

/** Chart action for a class: 'raise' | 'call' | 'fold'. */
export function chartAction(chart, cls) {
  if (chart.raise.has(cls)) return 'raise';
  if (chart.call.has(cls)) return 'call';
  return 'fold';
}

/**
 * How close a class is to the edge of a chart range — used to call some
 * deviations "marginal" instead of "mistake". Returns the distance in
 * percentile points between the class and the weakest hand of the range.
 */
export function distanceFromRange(set, cls) {
  if (set.size === 0) return 1;
  let weakest = 0;
  for (const c of set) weakest = Math.max(weakest, PERCENTILE[c]);
  return PERCENTILE[cls] - weakest; // negative = comfortably inside
}

/** Expand a set of classes into concrete combos not blocked by dead cards. */
export function rangeCombos(set, dead = []) {
  const deadSet = new Set(dead);
  const out = [];
  for (const cls of set) {
    for (const combo of combosOf(cls)) {
      if (!deadSet.has(combo[0]) && !deadSet.has(combo[1])) out.push(combo);
    }
  }
  return out;
}
