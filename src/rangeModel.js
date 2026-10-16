/**
 * rangeModel.js — estimate what an opponent can hold from their actions.
 *
 * Preflop: map the player's last preflop action (open, 3-bet, call...) to a
 * chart range for their position. Postflop: re-weight every combo by how
 * plausible each bet / call / check was with that holding on that board.
 * Optionally widened or tightened by the player's observed VPIP and style.
 */
import {
  RFI, VS_OPEN, VS_3BET, openerGroup, rangeSet, topRange, rangeSize, rangeCombos,
} from './ranges.js';
import { analyzeHand, TIER } from './analysis.js';

/**
 * Describe the preflop situation a seat is facing right now.
 * @returns {{scenario:string, villainSeat:number|null, limpers:number, raises:number, lastRaiseTo:number}}
 *  scenario ∈ rfi | vsLimp | bbVsLimp | vsOpen | vs3bet | vs3betCold | vs4bet
 */
export function classifyPreflop(game, seat) {
  const acts = game.history.actions.filter((a) => a.street === 'preflop' && a.type !== 'post');
  let raises = 0;
  let opener = null;
  let threeBettor = null;
  let lastRaiser = null;
  let limpers = 0;
  let lastRaiseTo = game.bb;
  let callersAfterOpen = 0;
  for (const a of acts) {
    if (a.type === 'raise' || a.type === 'bet') {
      raises++;
      if (raises === 1) opener = a.seat;
      if (raises === 2) threeBettor = a.seat;
      lastRaiser = a.seat;
      lastRaiseTo = a.to;
    } else if (a.type === 'call') {
      if (raises === 0) limpers++;
      else if (raises === 1) callersAfterOpen++;
    }
  }
  const pos = game.positionOf(seat);
  const base = { limpers, raises, lastRaiseTo, callersAfterOpen };
  if (raises === 0) {
    if (limpers === 0) return { ...base, scenario: 'rfi', villainSeat: null };
    return { ...base, scenario: pos === 'BB' ? 'bbVsLimp' : 'vsLimp', villainSeat: null };
  }
  if (raises === 1) return { ...base, scenario: 'vsOpen', villainSeat: opener };
  if (raises === 2) {
    return { ...base, scenario: opener === seat ? 'vs3bet' : 'vs3betCold', villainSeat: threeBettor };
  }
  return { ...base, scenario: 'vs4bet', villainSeat: lastRaiser };
}

/** Classify each preflop action of a seat by its context. */
function preflopRole(game, seat) {
  const acts = game.history.actions.filter((a) => a.street === 'preflop' && a.type !== 'post');
  let raises = 0;
  let opener = null;
  let role = 'none';
  let vs = null;
  for (const a of acts) {
    if (a.seat === seat) {
      if (a.type === 'raise' || a.type === 'bet') {
        role = raises === 0 ? 'open' : raises === 1 ? '3bet' : raises === 2 ? '4bet' : '5bet';
        vs = opener;
      } else if (a.type === 'call') {
        if (raises === 0) role = game.positionOf(seat) === 'SB' ? 'complete' : 'limp';
        else if (raises === 1) { role = 'callOpen'; vs = opener; }
        else role = opener === seat ? 'call3bet' : 'coldCall3bet';
      } else if (a.type === 'check') role = 'bbCheck';
    }
    if (a.type === 'raise' || a.type === 'bet') {
      raises++;
      if (raises === 1) opener = a.seat;
    }
  }
  return { role, vs };
}

const minus = (a, b) => new Set([...a].filter((c) => !b.has(c)));

/**
 * Scale a range by an observed looseness factor (1 = as charted).
 * Wider players get extra hands from the strength ordering.
 */
function scaleRange(set, factor, { excludeTop = 0 } = {}) {
  if (Math.abs(factor - 1) < 0.08) return set;
  const target = Math.min(1, rangeSize(set) * factor + excludeTop);
  let scaled = topRange(target);
  if (excludeTop) scaled = minus(scaled, topRange(excludeTop));
  return factor > 1 ? new Set([...set, ...scaled]) : scaled;
}

/** Preflop range (set of classes) for a seat based on what they did. */
export function preflopRange(game, seat, observed) {
  const pos = game.positionOf(seat);
  const { role, vs } = preflopRole(game, seat);
  const vsPos = vs !== null ? game.positionOf(vs) : null;
  const factor = observed && observed.hands >= 30 ? Math.min(2.5, Math.max(0.6, observed.vpip / 24)) : 1;
  let set;
  let label;
  switch (role) {
    case 'open':
      set = scaleRange(RFI[pos] ? rangeSet(RFI[pos]) : topRange(0.15), factor);
      label = `${pos} open`;
      break;
    case '3bet': {
      const c = VS_OPEN[pos]?.[openerGroup(vsPos)] ?? VS_OPEN[pos]?.LP ?? VS_OPEN[pos]?.EP;
      set = scaleRange(c ? rangeSet(c.raise) : topRange(0.05), factor);
      label = `${pos} 3-bet`;
      break;
    }
    case '4bet':
      set = scaleRange(rangeSet('QQ+, AKs, AKo, A5s'), factor);
      label = '4-bet';
      break;
    case '5bet':
      set = rangeSet('KK+, AKs');
      label = '5-bet';
      break;
    case 'limp':
      set = scaleRange(minus(topRange(0.45), topRange(0.04)), factor, { excludeTop: 0.04 });
      label = `${pos} limp`;
      break;
    case 'complete':
      set = minus(topRange(0.7), topRange(0.08));
      label = 'SB complete';
      break;
    case 'callOpen': {
      const c = VS_OPEN[pos]?.[openerGroup(vsPos)] ?? VS_OPEN[pos]?.LP ?? VS_OPEN[pos]?.EP;
      const base = c && c.call ? rangeSet(c.call) : minus(topRange(0.2), topRange(0.03));
      set = scaleRange(base, factor, { excludeTop: 0.03 });
      label = `${pos} call vs ${vsPos} open`;
      break;
    }
    case 'call3bet':
      set = rangeSet(VS_3BET[openerGroup(pos) === 'EP' ? 'EP' : 'LP'].call);
      label = 'called a 3-bet';
      break;
    case 'coldCall3bet':
      set = rangeSet('TT-QQ, AQs, AKs, AKo');
      label = 'cold-called a 3-bet';
      break;
    case 'bbCheck':
      set = minus(topRange(1), topRange(0.08));
      label = 'BB checked option';
      break;
    default:
      set = topRange(1);
      label = game.street === 'preflop' ? 'yet to act (any hand)' : 'any two cards';
  }
  return { set, label, size: rangeSize(set) };
}

/**
 * Postflop plausibility weight of an action given a holding's analysis.
 * Style tweaks: stations call wider, maniacs bluff more, rocks bluff less.
 */
function actionWeight(type, a, style, betFrac) {
  const strong = a.tier >= TIER.TOP_PAIR_GOOD;
  const medium = a.tier >= TIER.MIDDLE_PAIR;
  const draw = a.drawStrength >= 2;
  const bluffy = style === 'maniac' ? 0.55 : style === 'lag' ? 0.35 : style === 'rock' ? 0.08 : style === 'station' ? 0.1 : 0.22;
  const callAir = style === 'station' ? 0.45 : style === 'maniac' ? 0.3 : 0.12;
  switch (type) {
    case 'bet':
      if (strong) return 1;
      if (draw) return 0.8;
      if (medium) return betFrac > 0.8 ? 0.25 : 0.55;
      return bluffy * (a.drawStrength === 1 ? 1.4 : 1);
    case 'raise':
      if (a.tier >= TIER.TWO_PAIR) return 1;
      if (strong) return 0.45;
      if (draw) return 0.55;
      return bluffy * 0.4;
    case 'call':
      if (medium || draw) return 1;
      if (a.tier === TIER.WEAK_PAIR || a.drawStrength === 1) return style === 'rock' ? 0.35 : 0.65;
      return callAir;
    case 'check':
      if (a.tier >= TIER.SET) return style === 'maniac' || style === 'lag' ? 0.2 : 0.45;
      if (strong) return 0.7;
      return 1;
    default:
      return 1;
  }
}

/**
 * Full weighted range estimate for a seat at the current point of the hand.
 * @param {object} game Game instance (live)
 * @param {number} seat opponent seat
 * @param {number[]} dead cards known to the observer (their hole cards + board)
 * @param {{observed?:object, style?:string}} [info]
 * @returns {{combos:Array, weights:number[], label:string, size:number}}
 */
export function estimateRange(game, seat, dead, info = {}) {
  const pre = preflopRange(game, seat, info.observed);
  const combos = rangeCombos(pre.set, dead);
  const weights = combos.map(() => 1);
  const notes = [pre.label];

  const post = game.history.actions.filter((a) => a.seat === seat && a.street !== 'preflop');
  for (const act of post) {
    const board = game.board.slice(0, act.boardLen);
    const betFrac = act.amount / Math.max(1, act.potBefore);
    for (let i = 0; i < combos.length; i++) {
      if (weights[i] < 0.002) continue;
      weights[i] *= actionWeight(act.type, analyzeHand(combos[i], board), info.style, betFrac);
    }
    if (act.type !== 'check') notes.push(`${act.street} ${act.type}`);
  }
  return { combos, weights, label: notes.join(' → '), size: pre.size };
}

/** Rough summary of how the weighted range is distributed by made-hand tier. */
export function rangeBreakdown(range, board) {
  const buckets = { strong: 0, medium: 0, draws: 0, air: 0 };
  let total = 0;
  range.combos.forEach((c, i) => {
    const w = range.weights[i];
    if (w <= 0) return;
    total += w;
    const a = analyzeHand(c, board);
    if (a.tier >= TIER.TOP_PAIR_GOOD) buckets.strong += w;
    else if (a.tier >= TIER.WEAK_PAIR) buckets.medium += w;
    else if (a.drawStrength >= 2) buckets.draws += w;
    else buckets.air += w;
  });
  if (!total) return buckets;
  for (const k of Object.keys(buckets)) buckets[k] /= total;
  return buckets;
}
