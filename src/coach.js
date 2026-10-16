/**
 * coach.js — live decision advice and post-hand decision grading.
 *
 * Preflop advice comes from the 6-max charts in ranges.js. Postflop advice
 * uses Monte Carlo equity against each opponent's estimated range and a
 * deliberately simple, explainable EV model:
 *
 *   EV(fold)  = 0
 *   EV(call)  = eq·R·(pot + call) − call
 *   EV(check) = eq·R·pot
 *   EV(bet b) = FE·pot + (1 − FE)·(eqC·R·(pot + 2b) − b)
 *
 * R  = equity realisation (1 on the river, lower out of position),
 * FE = chance everyone folds — from each opponent's range: air folds, weak
 *      pairs fold to big bets, strong hands and draws continue;
 * eqC = equity against only the continuing part of their ranges.
 *
 * It ignores future streets, so it is an approximation — but it captures the
 * key ideas (pot odds, fold equity, value vs. bluff) and is consistent, which
 * is what matters for spotting leaks.
 */
import { handClass, handPercentile, getChart, chartAction, rangeSet, RFI, topRange, rangeSize, distanceFromRange } from './ranges.js';
import { analyzeHand, boardTexture, TIER } from './analysis.js';
import { simulateEquity, countOuts } from './equity.js';
import { classifyPreflop, estimateRange } from './rangeModel.js';
import { cardsPretty } from './deck.js';

const pct = (x) => `${Math.round(x * 100)}%`;

/**
 * How likely a holding continues (calls or raises) versus a bet of `frac` ×
 * pot. Strong hands and good draws continue, weak pairs only vs small bets,
 * air folds (except for loose styles that float).
 */
export function continueWeight(a, frac, street, style, facingRaise) {
  const river = street === 'river';
  const loose = style === 'station' ? 0.3 : style === 'maniac' ? 0.25 : 0;
  if (facingRaise) {
    if (a.tier >= TIER.TOP_PAIR_GOOD) return 1;
    if (a.drawStrength >= 2 && !river) return 0.8;
    if (a.tier >= TIER.MIDDLE_PAIR) return 0.3 + loose;
    return 0.05 + loose / 2;
  }
  if (a.tier >= TIER.TOP_PAIR_WEAK) return 1;
  if (a.tier === TIER.MIDDLE_PAIR) return frac <= 0.75 ? 1 : 0.55 + loose;
  if (a.drawStrength >= 2 && !river) return frac <= 1 ? 1 : 0.6;
  if (a.tier === TIER.WEAK_PAIR) return Math.min(1, (frac <= 0.4 ? 0.8 : river ? 0.25 : 0.4) + loose * 2);
  if (a.drawStrength === 1 && !river) return Math.min(1, (frac <= 0.5 ? 0.5 : 0.2) + loose);
  return loose + (style === 'rock' ? 0 : 0.03);
}

/**
 * Fold equity and equity-when-called for a bet/raise of a given size,
 * computed from the opponents' weighted ranges. Cached per size bucket.
 */
export function betOutcome(model, frac, facingRaise) {
  const key = `${facingRaise ? 'r' : 'b'}${Math.round(frac * 20)}`;
  model.cache ??= {};
  if (model.cache[key]) return model.cache[key];
  model.analyses ??= model.ranges.map((r) => r.combos.map((c) => analyzeHand(c, model.board)));
  let allFold = 1;
  const continuing = model.ranges.map((r, i) => {
    let total = 0;
    let cont = 0;
    const weights = r.weights.map((w, j) => {
      const cw = w * continueWeight(model.analyses[i][j], frac, model.street, model.styles[i], facingRaise);
      total += w;
      cont += cw;
      return cw;
    });
    allFold *= total > 0 ? 1 - cont / total : 1;
    return { combos: r.combos, weights };
  });
  const anyCont = continuing.some((r) => r.weights.some((w) => w > 0));
  const eqC = anyCont
    ? simulateEquity(model.hero, model.board, continuing, { iterations: 600 }).equity
    : model.eq;
  return (model.cache[key] = { fe: allFold, eqC });
}

/** EV (chips, relative to folding now) of an action under the advice model. */
export function evOf(model, action) {
  const { eq, R, pot, callAmount, currentBet, committed } = model;
  switch (action.type) {
    case 'fold':
      return 0;
    case 'check':
      return eq * R * pot;
    case 'call':
      return eq * R * (pot + callAmount) - callAmount;
    case 'bet':
    case 'raise': {
      const to = action.amount;
      const invest = to - committed;
      const extra = Math.max(0, to - currentBet); // what a caller must add
      const frac = extra / Math.max(1, pot + (currentBet - committed));
      const { fe, eqC } = betOutcome(model, frac, currentBet > 0);
      return fe * pot + (1 - fe) * (eqC * R * (pot + invest + extra) - invest);
    }
    default:
      return 0;
  }
}

function isInPosition(game, seat) {
  // Postflop order starts left of the button; IP = last live, non-all-in player.
  const order = game.orderFrom(game.seatAfter(game.button)).filter((s) => {
    const p = game.players[s];
    return !p.folded && !p.allIn;
  });
  return order[order.length - 1] === seat;
}

const roundChips = (x, bb) => Math.max(bb, Math.round(x / (bb / 10)) * (bb / 10));

// ------------------------------------------------------------------ preflop

const COLD_4BET = { raise: rangeSet('QQ+, AKs, AKo'), call: rangeSet('TT-JJ, AQs') };
const VS_4BET = { raise: rangeSet('KK+, AKs'), call: rangeSet('QQ, AKo') };

/**
 * Widen continuing ranges against opponents known to raise too often.
 * Adds the next-best hands (by strength order) to the call range.
 */
function widenVsAggro(chart, style) {
  const factor = style === 'maniac' ? 2 : style === 'lag' ? 1.4 : 1;
  if (factor === 1) return null;
  const playable = new Set([...chart.raise, ...chart.call]);
  const extra = [...topRange(Math.min(0.6, rangeSize(playable) * factor))].filter((c) => !playable.has(c));
  return { ...chart, call: new Set([...chart.call, ...extra]) };
}

/** Preflop recommendation from charts. Returns null if not applicable. */
export function preflopAdvice(game, seat, opponentInfo = () => ({})) {
  const p = game.players[seat];
  const pos = game.positionOf(seat);
  const cls = handClass(p.holeCards[0], p.holeCards[1]);
  const info = classifyPreflop(game, seat);
  const villainPos = info.villainSeat !== null ? game.positionOf(info.villainSeat) : null;
  const legal = game.legalActions(seat);
  const ip = ['BTN', 'CO'].includes(pos) || (pos === 'HJ' && villainPos === 'UTG');
  let chart;
  let label;
  let sizeTo = null;
  let why;

  switch (info.scenario) {
    case 'rfi':
      chart = getChart('rfi', pos);
      label = chart?.label ?? 'Open';
      sizeTo = pos === 'SB' ? 3 * game.bb : 2.5 * game.bb;
      why = { raise: `${cls} is in the ${pos} opening range (${pct(rangeSize(chart.raise))} of hands). Raise first in.`, fold: `${cls} is outside the ${pos} opening range (${pct(rangeSize(chart.raise))} of hands). ${pos === 'UTG' || pos === 'HJ' ? 'Early position needs a tight range because more players act after you.' : 'Fold and wait for a better spot.'}` };
      break;
    case 'vsLimp':
    case 'bbVsLimp': {
      const base = RFI[pos] ? rangeSet(RFI[pos]) : topRange(0.3);
      const iso = topRange(info.scenario === 'bbVsLimp' ? 0.12 : rangeSize(base) * 0.55);
      const over = new Set([...base].filter((c) => !iso.has(c) && (c.length === 2 || c.endsWith('s'))));
      chart = { raise: iso, call: info.scenario === 'bbVsLimp' ? topRange(1) : ['CO', 'BTN', 'SB'].includes(pos) ? over : new Set(), label: `${pos} vs ${info.limpers} limper${info.limpers > 1 ? 's' : ''}` };
      label = chart.label;
      sizeTo = (4 + info.limpers) * game.bb + (info.scenario === 'bbVsLimp' ? game.bb : 0);
      why = {
        raise: `${cls} is strong enough to raise ("isolate") the limper — limpers usually hold weak hands and you want to play them heads-up with the initiative.`,
        call: info.scenario === 'bbVsLimp' ? `Check your option — ${cls} isn't strong enough to raise, and seeing a free flop costs nothing.` : `${cls} plays well multiway; over-limping in position is fine.`,
        fold: `${cls} is too weak to play here, even against limpers.`,
      };
      break;
    }
    case 'vsOpen': {
      // No chart exists e.g. when hero limped and then faces a raise.
      chart = getChart('vsOpen', pos, villainPos) ?? { raise: rangeSet('QQ+, AKs, AKo'), call: rangeSet('22-JJ, AJs-AQs, KQs, QJs, JTs, T9s'), label: `${pos} vs ${villainPos} raise` };
      label = chart.label;
      const mult = ip ? 3 : 4;
      sizeTo = info.lastRaiseTo * mult + info.callersAfterOpen * info.lastRaiseTo;
      why = {
        raise: `${cls} is in the ${pos} 3-bet range vs a ${villainPos} open — 3-bet for value${['A5s', 'A4s', 'A3s', '76s', '65s'].includes(cls) ? ' / as a well-blocked bluff' : ''}.`,
        call: `${cls} is in the ${pos} calling range vs a ${villainPos} open${pos === 'BB' ? ' — you already have 1bb invested, so you get a good price' : ''}.`,
        fold: `${cls} is too weak to continue vs a ${villainPos} open from the ${pos}. ${['UTG', 'HJ'].includes(villainPos) ? 'Early-position opens are strong.' : ''}`,
      };
      break;
    }
    case 'vs3bet':
      chart = getChart('vs3bet', pos, villainPos);
      label = chart.label;
      sizeTo = info.lastRaiseTo * (ip ? 2.2 : 2.5);
      why = {
        raise: `${cls} is strong enough to 4-bet against a 3-bet.`,
        call: `${cls} is good enough to call the 3-bet but not to 4-bet.`,
        fold: `${cls} does not do well against a 3-betting range — fold and move on.`,
      };
      break;
    case 'vs3betCold':
      chart = { ...COLD_4BET, label: 'Facing open + 3-bet' };
      label = chart.label;
      sizeTo = info.lastRaiseTo * 2.3;
      why = { raise: `${cls} is a cold 4-bet for value.`, call: `${cls} can cold-call a 3-bet.`, fold: `Facing an open and a 3-bet, only premium hands continue — fold ${cls}.` };
      break;
    case 'vs4bet':
    default:
      chart = { ...VS_4BET, label: 'Facing a 4-bet+' };
      label = chart.label;
      sizeTo = p.stack + p.committed; // jam
      why = { raise: `${cls} is a premium hand — shove.`, call: `${cls} is strong enough to call the 4-bet.`, fold: `Against a 4-bet, ${cls} is behind most of the range — fold.` };
  }

  // Exploit: defend wider against revealed maniacs / LAGs.
  let exploitNote = '';
  if (info.villainSeat !== null && ['vsOpen', 'vs3bet'].includes(info.scenario)) {
    const style = opponentInfo(info.villainSeat)?.style;
    const wider = widenVsAggro(chart, style);
    if (wider) {
      const name = game.players[info.villainSeat].name;
      if (!chart.raise.has(cls) && !chart.call.has(cls) && wider.call.has(cls)) {
        exploitNote = ` Exploit: ${name} plays like a ${style === 'maniac' ? 'maniac' : 'loose-aggressive player'} and raises far too often, so ${cls} is a profitable call here even though the standard chart folds it.`;
      }
      chart = wider;
    }
  }

  let action = chartAction(chart, cls);
  // In the BB facing limps, "call" means check.
  if (info.scenario === 'bbVsLimp' && action === 'call') action = 'check';
  if (action === 'fold' && legal.canCheck) action = 'check';
  // Big 4-bets: just shove.
  if (sizeTo && legal.maxRaiseTo && sizeTo > legal.maxRaiseTo * 0.4 && info.scenario !== 'rfi') sizeTo = legal.maxRaiseTo;
  if (legal.maxRaiseTo) sizeTo = Math.min(legal.maxRaiseTo, Math.max(legal.minRaiseTo, roundChips(sizeTo, game.bb)));
  const reason = (exploitNote ? '' : why[action === 'check' ? (info.scenario === 'bbVsLimp' ? 'call' : 'fold') : action] ?? '') + exploitNote;
  return {
    scenario: info.scenario, cls, pos, villainPos, chart, chartLabel: label,
    action, sizeTo: action === 'raise' ? sizeTo : null, reason,
    percentile: handPercentile(cls),
  };
}

// ----------------------------------------------------------------- advice

/**
 * Full advice for the seat to act.
 * @param {object} game
 * @param {number} seat
 * @param {{opponentInfo?:(seat:number)=>object, iterations?:number}} [opts]
 */
export function getAdvice(game, seat, { opponentInfo = () => ({}), iterations = 1500 } = {}) {
  const p = game.players[seat];
  const legal = game.legalActions(seat);
  const pot = game.pot;
  const callAmount = legal.callAmount;
  const potOdds = callAmount > 0 ? callAmount / (pot + callAmount) : 0;
  const opponents = game.players.filter((o) => o.seat !== seat && !o.folded);
  const dead = [...p.holeCards, ...game.board];
  const infos = opponents.map((o) => opponentInfo(o.seat) ?? {});
  const ranges = opponents.map((o, i) => estimateRange(game, o.seat, dead, infos[i]));
  const sim = simulateEquity(p.holeCards, game.board, ranges, { iterations });
  const analysis = analyzeHand(p.holeCards, game.board);
  const outs = countOuts(p.holeCards, game.board);
  const inPosition = isInPosition(game, seat);
  const effStack = Math.min(p.stack, Math.max(0, ...opponents.map((o) => o.stack + o.committed - p.committed)));
  const spr = game.street === 'preflop' ? null : effStack / Math.max(1, pot);

  const advice = {
    street: game.street,
    bb: game.bb,
    pot,
    callAmount,
    potOdds,
    requiredEquity: potOdds,
    equity: sim.equity,
    win: sim.win,
    tie: sim.tie,
    outs,
    analysis,
    texture: boardTexture(game.board),
    handClass: handClass(p.holeCards[0], p.holeCards[1]),
    holeCards: [...p.holeCards],
    board: [...game.board],
    position: game.positionOf(seat),
    inPosition,
    spr,
    opponents: opponents.map((o, i) => ({
      seat: o.seat, name: o.name, position: game.positionOf(o.seat),
      label: ranges[i].label, size: ranges[i].size,
    })),
    legal,
  };

  if (game.street === 'preflop') {
    const pf = preflopAdvice(game, seat, opponentInfo);
    advice.preflop = pf;
    advice.recommendation = { type: pf.action, amount: pf.sizeTo };
    advice.reason = pf.reason;
    return advice;
  }

  // ---- postflop EV comparison
  const R = game.street === 'river' ? 1 : inPosition ? 1 : 0.88;
  const styles = infos.map((i) => i.style ?? 'reg');
  const model = {
    eq: sim.equity, R, pot, callAmount, currentBet: game.currentBet,
    committed: p.committed, styles, bb: game.bb, street: game.street,
    hero: [...p.holeCards], board: [...game.board], ranges,
  };
  advice.model = model;

  const options = [];
  if (legal.canCheck) options.push({ type: 'check', label: 'Check' });
  else {
    options.push({ type: 'fold', label: 'Fold' });
    options.push({ type: 'call', label: `Call ${game.fmt(callAmount)}` });
  }
  if (legal.canRaise) {
    const potAfterCall = pot + callAmount;
    const sizes = legal.isBet ? [0.33, 0.66, 1] : [null];
    for (const frac of sizes) {
      let to;
      if (frac === null) to = game.currentBet + Math.round(potAfterCall * 1.0); // pot-sized-ish raise
      else to = roundChips(pot * frac, game.bb);
      to = Math.min(legal.maxRaiseTo, Math.max(legal.minRaiseTo, to));
      if (options.some((o) => o.amount === to)) continue;
      const allIn = to === legal.maxRaiseTo;
      const label = legal.isBet
        ? `Bet ${game.fmt(to)}${allIn ? ' (all-in)' : ` (${Math.round(frac * 100)}% pot)`}`
        : `Raise to ${game.fmt(to)}${allIn ? ' (all-in)' : ''}`;
      options.push({ type: legal.isBet ? 'bet' : 'raise', amount: to, label });
    }
  }
  for (const o of options) {
    o.ev = evOf(model, o);
    if (o.type === 'bet' || o.type === 'raise') {
      const extra = o.amount - game.currentBet;
      o.foldEquity = betOutcome(model, extra / Math.max(1, pot + game.currentBet - p.committed), game.currentBet > 0).fe;
    }
  }
  options.sort((a, b) => b.ev - a.ev);
  // Prefer the simpler passive option when EVs are basically tied.
  let best = options[0];
  const passive = options.find((o) => o.type === 'check' || o.type === 'call');
  if (passive && best !== passive && best.ev - passive.ev < 0.02 * pot) best = passive;
  advice.options = options;
  advice.recommendation = { type: best.type, amount: best.amount ?? null, label: best.label };
  advice.reason = explainPostflop(advice, best, game);
  return advice;
}

function explainPostflop(a, best, game) {
  const eq = pct(a.equity);
  const vs = a.opponents.length === 1 ? `${a.opponents[0].name}'s range` : `${a.opponents.length} opponents' ranges`;
  const hand = [a.analysis.label, a.analysis.drawLabel].filter(Boolean).join(', ').toLowerCase();
  const parts = [];
  if (a.callAmount > 0) {
    parts.push(`You need ${pct(a.potOdds)} equity to call ${game.fmt(a.callAmount)} into ${game.fmt(a.pot)}. With ${hand} you have about ${eq} vs ${vs}.`);
    if (best.type === 'fold') {
      parts.push(`That's not enough — fold.`);
      if (a.outs && a.outs.count >= 8 && a.street !== 'river') parts.push(`(With ${a.outs.count} outs, a call only works if you can win a lot more when you hit — implied odds.)`);
    } else if (best.type === 'call') parts.push(a.equity >= a.potOdds ? `That's enough to call.` : `Close — calling is about break-even with position and future streets.`);
    else parts.push(a.equity > 0.6 ? `You're well ahead — raise for value.` : `Raising adds fold equity (≈${pct(best.foldEquity ?? 0)} folds) to your ${a.analysis.drawStrength >= 2 ? 'draw' : 'hand'}.`);
  } else if (best.type === 'check') {
    parts.push(`About ${eq} equity vs ${vs}. ${a.equity > 0.55 ? 'Checking can keep weaker hands in (pot control / trapping).' : 'Betting would mostly get called by better hands and fold out worse — check.'}`);
  } else {
    const valueish = a.equity > 0.55;
    const fe = best.foldEquity !== undefined ? ` Expect about ${pct(best.foldEquity)} folds to this size.` : '';
    parts.push(`About ${eq} equity vs ${vs}. ${valueish ? 'Bet for value — worse hands can call.' : a.analysis.drawStrength >= 2 ? 'Semi-bluff: you can win now with fold equity or improve later.' : 'A bluff here wins the pot often enough to be profitable.'}${fe}`);
    if (a.texture.label) parts.push(`Board is ${a.texture.label}.`);
  }
  return parts.join(' ');
}

// ---------------------------------------------------------------- grading

const actionLabel = (game, action, legal) => {
  switch (action.type) {
    case 'fold': return 'fold';
    case 'check': return 'check';
    case 'call': return `call ${game.fmt(legal.callAmount)}`;
    case 'bet': return `bet ${game.fmt(action.to)}`;
    case 'raise': return `raise to ${game.fmt(action.to)}`;
    default: return action.type;
  }
};

/**
 * Grade a decision the player made, using the advice snapshot taken before it.
 * @param {object} advice from getAdvice
 * @param {{type:string, to:number}} action the recorded action (engine record)
 * @param {object} game for formatting
 * @returns {{grade:'good'|'marginal'|'mistake', evLoss:number, tag:string|null, explanation:string}}
 */
export function gradeDecision(advice, action, game) {
  const bb = advice.bb;
  const taken = actionLabel(game, action, advice.legal);
  if (advice.street === 'preflop') return gradePreflop(advice, action, taken, bb);

  const chosenEv = evOf(advice.model, { type: action.type, amount: action.to });
  const best = advice.options[0];
  const loss = Math.max(0, best.ev - chosenEv);
  const pot = advice.pot;
  let grade = 'good';
  if (loss > Math.max(0.15 * pot, bb)) grade = 'mistake';
  else if (loss > Math.max(0.05 * pot, 0.3 * bb)) grade = 'marginal';

  let tag = null;
  if (grade !== 'good') tag = postflopTag(advice, action, best);
  const evStr = (x) => `${x >= 0 ? '+' : ''}${(x / bb).toFixed(1)}bb`;
  let explanation;
  if (grade === 'good') {
    explanation = `You chose to ${taken} — ${best.type === action.type ? 'the best option' : 'within a hair of the best option'} (${pct(advice.equity)} equity${advice.callAmount ? `, needed ${pct(advice.potOdds)}` : ''}).`;
  } else {
    explanation = `You chose to ${taken} (EV ${evStr(chosenEv)}). Best was ${best.label.toLowerCase()} (EV ${evStr(best.ev)}), losing ≈${(loss / bb).toFixed(1)}bb. ${advice.reason}`;
  }
  return { grade, evLoss: loss / bb, tag, explanation, street: advice.street };
}

function postflopTag(advice, action, best) {
  const t = action.type;
  const bt = best.type;
  if (t === 'fold') return advice.street === 'river' ? 'river-overfold' : 'overfold';
  if (t === 'call' && bt === 'fold') return 'loose-call';
  if ((t === 'call' || t === 'check') && (bt === 'raise' || bt === 'bet')) return advice.equity >= 0.55 ? 'missed-value' : 'missed-bluff';
  if ((t === 'bet' || t === 'raise') && (bt === 'bet' || bt === 'raise')) return 'sizing';
  if (t === 'bet' || t === 'raise') return advice.equity < 0.4 ? 'bad-bluff' : 'overaggressive';
  return 'other';
}

function gradePreflop(advice, action, taken, bb) {
  const pf = advice.preflop;
  const rec = pf.action; // raise | call | check | fold
  const norm = (t) => (t === 'bet' ? 'raise' : t);
  const did = norm(action.type);
  const chartRange = new Set([...pf.chart.raise, ...pf.chart.call]);
  const recLabel = rec === 'raise' ? (pf.scenario === 'rfi' ? 'open-raise' : pf.scenario === 'vsOpen' ? '3-bet' : 'raise') : rec;
  const base = `${pf.cls}, ${pf.chartLabel}: chart says ${recLabel}.`;

  if (did === rec || (rec === 'check' && did === 'check')) {
    return { grade: 'good', evLoss: 0, tag: null, explanation: `You chose to ${taken}. ${base}`, street: 'preflop' };
  }
  // Check vs fold when checking is free is not a real difference.
  if ((rec === 'fold' && did === 'check') || (rec === 'check' && did === 'fold')) {
    return { grade: 'good', evLoss: 0, tag: null, explanation: `You chose to ${taken}. ${base}`, street: 'preflop' };
  }

  let grade;
  let tag;
  let loss;
  const dist = distanceFromRange(chartRange, pf.cls);
  if (rec === 'check' && did === 'raise') {
    tag = 'preflop-overaggressive';
    grade = 'marginal';
    loss = 0.3;
  } else if (rec === 'fold' || rec === 'check') {
    // Played a hand the chart folds.
    tag = 'preflop-loose';
    grade = dist < 0.05 ? 'marginal' : 'mistake';
    loss = Math.min(3, 0.2 + dist * 6);
    if (did === 'raise' && dist < 0.08 && pf.scenario === 'rfi' && ['BTN', 'CO', 'SB'].includes(pf.pos)) grade = 'marginal';
  } else if (did === 'fold' || did === 'check') {
    tag = 'preflop-tight';
    grade = dist > -0.06 ? 'marginal' : 'mistake';
    loss = Math.min(4, 0.2 + Math.abs(dist) * 5);
    if (pf.percentile < 0.03) loss = Math.max(loss, 3); // folding premiums is costly
  } else if (rec === 'raise' && did === 'call') {
    tag = 'preflop-passive';
    grade = pf.percentile < 0.04 ? 'mistake' : 'marginal';
    loss = pf.percentile < 0.04 ? 1.5 : 0.3;
  } else {
    tag = 'preflop-overaggressive';
    grade = 'marginal';
    loss = 0.4;
  }
  // A loose limp/open can't cost much more than the chips put in.
  if (did !== 'fold' && did !== 'check') loss = Math.min(loss, 0.3 + (action.amount / bb) * 0.8);
  return {
    grade,
    evLoss: loss,
    tag,
    explanation: `You chose to ${taken}. ${base} ${pf.reason} (≈${loss.toFixed(1)}bb estimated cost)`,
    street: 'preflop',
  };
}

/** Short summary line of a hand's board for logs. */
export const boardString = (board) => (board.length ? cardsPretty(board) : '—');
