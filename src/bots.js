/**
 * bots.js — bot opponents with distinct, recognisable playing styles.
 *
 * Each profile is a handful of tendencies (how wide it opens, how often it
 * bluffs, how loosely it calls...). Decisions combine those tendencies with
 * hand strength:
 *   - preflop: hand percentile vs. per-position thresholds (the "reg" uses the
 *     same charts the coach teaches);
 *   - postflop: Monte Carlo equity (vs. estimated ranges for "smart" bots, vs.
 *     random hands for simpler ones) compared with pot odds.
 *
 * Difficulty ("skill") lowers the bots' random error rate, makes them read
 * ranges more often and, at higher levels, lets them exploit the player's
 * measured leaks (e.g. bluff more if you over-fold rivers).
 */
import { handClass, handPercentile, getChart, chartAction } from './ranges.js';
import { classifyPreflop, estimateRange } from './rangeModel.js';
import { analyzeHand, boardTexture } from './analysis.js';
import { simulateEquity, equityVsRandom } from './equity.js';

export const BOT_PROFILES = [
  {
    id: 'rock', name: 'Rocky', style: 'rock', styleName: 'Tight-passive', avatar: '🪨',
    blurb: 'Plays few hands and rarely bets without a strong one. When a rock raises, believe it.',
    open: { UTG: 0.07, HJ: 0.09, CO: 0.12, BTN: 0.16, SB: 0.1 },
    limp: 0.18, threeBet: 0.025, callOpen: 0.08, fourBet: 0.02, call3bet: 0.04,
    valueTh: 0.68, aggression: 0.3, bluff: 0.04, cbet: 0.4, callLoose: 0.85, sizing: 0.5, smart: 0.35,
  },
  {
    id: 'lag', name: 'Luna', style: 'lag', styleName: 'Loose-aggressive', avatar: '🦊',
    blurb: 'Opens wide, 3-bets light and fires multiple barrels. Call down a bit lighter and trap her.',
    open: { UTG: 0.18, HJ: 0.24, CO: 0.34, BTN: 0.5, SB: 0.42 },
    limp: 0, threeBet: 0.1, callOpen: 0.14, fourBet: 0.05, call3bet: 0.12,
    valueTh: 0.56, aggression: 0.75, bluff: 0.25, cbet: 0.78, callLoose: 1.05, sizing: 0.7, smart: 0.8,
  },
  {
    id: 'station', name: 'Cal', style: 'station', styleName: 'Calling station', avatar: '📞',
    blurb: 'Limps and calls with almost anything, rarely raises. Never bluff him — value-bet relentlessly.',
    open: { UTG: 0.05, HJ: 0.05, CO: 0.06, BTN: 0.08, SB: 0.06 },
    limp: 0.5, threeBet: 0.02, callOpen: 0.42, fourBet: 0.015, call3bet: 0.3,
    valueTh: 0.72, aggression: 0.15, bluff: 0.03, cbet: 0.3, callLoose: 1.7, sizing: 0.45, smart: 0.1,
  },
  {
    id: 'reg', name: 'Regina', style: 'reg', styleName: 'Solid regular', avatar: '🎯', charts: true,
    blurb: 'Balanced, chart-based player. Few obvious leaks — the toughest opponent at the table.',
    open: { UTG: 0.18, HJ: 0.23, CO: 0.33, BTN: 0.47, SB: 0.37 },
    limp: 0, threeBet: 0.06, callOpen: 0.1, fourBet: 0.03, call3bet: 0.08,
    valueTh: 0.6, aggression: 0.55, bluff: 0.13, cbet: 0.62, callLoose: 1.0, sizing: 0.66, smart: 1,
  },
  {
    id: 'maniac', name: 'Max', style: 'maniac', styleName: 'Maniac', avatar: '🔥',
    blurb: 'Raises and bets constantly with any two cards. Let him bluff into your good hands.',
    open: { UTG: 0.4, HJ: 0.45, CO: 0.55, BTN: 0.7, SB: 0.65 },
    limp: 0.1, threeBet: 0.22, callOpen: 0.3, fourBet: 0.12, call3bet: 0.25,
    valueTh: 0.45, aggression: 0.92, bluff: 0.45, cbet: 0.92, callLoose: 1.35, sizing: 1.0, smart: 0.2,
  },
];

export const profileById = (id) => BOT_PROFILES.find((p) => p.id === id);

/**
 * Exploit multipliers derived from the human's stats. Only used at higher
 * difficulty levels — this is how "bots get smarter as you improve".
 */
export function exploitsFor(heroStats, level) {
  const ex = { threeBetMult: 1, riverBluffMult: 1, bluffMult: 1, cbetMult: 1, valueThin: 0 };
  if (!heroStats || level < 3) return ex;
  const s = heroStats;
  if (s.foldTo3betOpp >= 8 && s.foldTo3bet / s.foldTo3betOpp > 0.6) ex.threeBetMult = 1.8;
  if (s.riverFacedOpp >= 8 && s.riverFold / s.riverFacedOpp > 0.55) ex.riverBluffMult = 2;
  if (s.hands >= 50 && s.vpip / s.hands > 0.35) { ex.bluffMult = 0.6; ex.valueThin = 0.06; }
  if (s.foldToCbetOpp >= 8 && s.foldToCbet / s.foldToCbetOpp > 0.6) ex.cbetMult = 1.4;
  return ex;
}

/**
 * Choose an action for a bot.
 * @param {object} game
 * @param {number} seat
 * @param {object} profile entry from BOT_PROFILES
 * @param {{level?:number, exploit?:object, rng?:function, opponentInfo?:function}} [ctx]
 * @returns {{type:string, amount?:number}}
 */
export function decideBot(game, seat, profile, ctx = {}) {
  const rng = ctx.rng ?? Math.random;
  const level = ctx.level ?? 1;
  const legal = game.legalActions(seat);
  const errorRate = [0.14, 0.08, 0.04, 0.015][Math.min(3, level - 1)] ?? 0.04;

  let d = game.street === 'preflop'
    ? preflopDecision(game, seat, profile, ctx, legal, rng)
    : postflopDecision(game, seat, profile, ctx, legal, rng, level);

  // Occasional random deviations make low levels beatable and less robotic
  // (less often preflop, where they would distort the bots' visible style).
  if (rng() < errorRate * (game.street === 'preflop' ? 0.5 : 1)) {
    const r = rng();
    if (legal.canCall && r < 0.6) d = { type: 'call' };
    else if (legal.canRaise && r < 0.75) d = { type: 'raise', amount: legal.minRaiseTo };
    else d = { type: legal.canCheck ? 'check' : 'fold' };
  }
  return sanitize(d, legal);
}

function sanitize(d, legal) {
  if ((d.type === 'raise' || d.type === 'bet') && !legal.canRaise) return { type: legal.canCall ? 'call' : 'check' };
  if (d.type === 'raise' || d.type === 'bet') {
    let amt = Math.round(d.amount ?? legal.minRaiseTo);
    amt = Math.max(legal.minRaiseTo, Math.min(legal.maxRaiseTo, amt));
    // Don't leave a silly sliver behind — shove instead.
    if (legal.maxRaiseTo - amt < (legal.maxRaiseTo - legal.committed) * 0.2) amt = legal.maxRaiseTo;
    return { type: legal.isBet ? 'bet' : 'raise', amount: amt };
  }
  if (d.type === 'call' && !legal.canCall) return { type: 'check' };
  if (d.type === 'fold' && legal.canCheck) return { type: 'check' };
  if (d.type === 'check' && !legal.canCheck) return { type: 'fold' };
  return d;
}

// ------------------------------------------------------------------ preflop

function preflopDecision(game, seat, profile, ctx, legal, rng) {
  const p = game.players[seat];
  const pos = game.positionOf(seat);
  const cls = handClass(p.holeCards[0], p.holeCards[1]);
  const pctl = handPercentile(cls);
  const info = classifyPreflop(game, seat);
  const ex = ctx.exploit ?? {};
  const villain = info.villainSeat !== null ? game.players[info.villainSeat] : null;
  const vsHuman = villain?.isHuman;
  const bb = game.bb;
  const fold = { type: legal.canCheck ? 'check' : 'fold' };
  const villainPos = villain ? game.positionOf(villain.seat) : null;
  const latePos = ['CO', 'BTN', 'SB'].includes(villainPos);
  const ip = ['BTN', 'CO'].includes(pos);

  switch (info.scenario) {
    case 'rfi': {
      const open = profile.charts ? chartAction(getChart('rfi', pos), cls) === 'raise' : pctl <= (profile.open[pos] ?? 0.1);
      if (open) {
        const size = profile.style === 'maniac' ? 3 + Math.floor(rng() * 2) : pos === 'SB' ? 3 : 2.5;
        return { type: 'raise', amount: size * bb };
      }
      if (pctl <= profile.limp && pos !== 'BB') return { type: 'call' };
      return fold;
    }
    case 'vsLimp':
    case 'bbVsLimp': {
      const isoTh = pos === 'BB' ? 0.1 + profile.aggression * 0.08 : (profile.open[pos] ?? 0.15) * 0.6;
      if (pctl <= isoTh) return { type: 'raise', amount: (4 + info.limpers) * bb };
      if (pos === 'BB' || pctl <= profile.limp + 0.05) return { type: legal.canCheck ? 'check' : 'call' };
      return fold;
    }
    case 'vsOpen': {
      const sizeBB = info.lastRaiseTo / bb;
      const tighten = sizeBB > 3.5 ? 0.6 : 1;
      if (profile.charts && !vsHuman) {
        const act = chartAction(getChart('vsOpen', pos, villainPos) ?? getChart('vsOpen', 'BTN', villainPos), cls);
        if (act === 'raise') return { type: 'raise', amount: info.lastRaiseTo * (ip ? 3 : 4) };
        if (act === 'call') return { type: 'call' };
        return fold;
      }
      const threeBet = profile.threeBet * (vsHuman ? ex.threeBetMult ?? 1 : 1) * (latePos ? 1.3 : 1);
      const callTh = threeBet + profile.callOpen * tighten * (pos === 'BB' ? 1.6 : 1) * (latePos ? 1.2 : 1);
      if (pctl <= threeBet) return { type: 'raise', amount: info.lastRaiseTo * (ip ? 3 : 4) };
      // Light 3-bet bluffs with suited hands for aggressive styles.
      if (cls.endsWith('s') && rng() < profile.bluff * 0.25) return { type: 'raise', amount: info.lastRaiseTo * (ip ? 3 : 4) };
      if (pctl <= callTh) return { type: 'call' };
      return fold;
    }
    case 'vs3bet': {
      if (profile.charts) {
        const act = chartAction(getChart('vs3bet', pos, villainPos), cls);
        if (act === 'raise') return { type: 'raise', amount: info.lastRaiseTo * 2.3 };
        return act === 'call' ? { type: 'call' } : fold;
      }
      if (pctl <= profile.fourBet) return { type: 'raise', amount: info.lastRaiseTo * 2.3 };
      if (pctl <= profile.call3bet) return { type: 'call' };
      return fold;
    }
    case 'vs3betCold':
      if (pctl <= profile.fourBet * 0.6) return { type: 'raise', amount: info.lastRaiseTo * 2.3 };
      if (pctl <= profile.call3bet * 0.4) return { type: 'call' };
      return fold;
    case 'vs4bet':
    default: {
      const jam = 0.02 + (profile.style === 'maniac' ? 0.05 : 0);
      if (pctl <= jam) return { type: 'raise', amount: legal.maxRaiseTo };
      if (pctl <= 0.035 + (profile.style === 'station' ? 0.04 : 0)) return { type: 'call' };
      return fold;
    }
  }
}

// ----------------------------------------------------------------- postflop

function postflopDecision(game, seat, profile, ctx, legal, rng, level) {
  const p = game.players[seat];
  const opps = game.players.filter((o) => o.seat !== seat && !o.folded);
  const numOpp = opps.length;
  const ex = ctx.exploit ?? {};
  const heroInHand = opps.some((o) => o.isHuman);
  const pot = game.pot;
  const toCall = legal.callAmount;
  const potOdds = toCall > 0 ? toCall / (pot + toCall) : 0;
  const a = analyzeHand(p.holeCards, game.board);
  const tex = boardTexture(game.board);
  const smartness = Math.min(1, profile.smart + 0.15 * (level - 1));

  let eq;
  if (rng() < smartness) {
    const dead = [...p.holeCards, ...game.board];
    const ranges = opps.map((o) => estimateRange(game, o.seat, dead, ctx.opponentInfo?.(o.seat) ?? {}));
    eq = simulateEquity(p.holeCards, game.board, ranges, { iterations: 300, rng }).equity;
  } else {
    eq = equityVsRandom(p.holeCards, game.board, numOpp, 300, rng);
    // Naive bots only partly respect bet sizing.
    if (toCall > 0) eq -= 0.15 * Math.min(1, toCall / Math.max(1, pot - toCall)) * (profile.style === 'station' ? 0.3 : 1);
  }

  const sizeBet = (frac) => {
    const jitter = 0.85 + rng() * 0.3;
    let amt = Math.round((pot * frac * jitter) / (game.bb / 10)) * (game.bb / 10);
    amt = Math.max(game.bb, amt);
    if (amt > p.stack * 0.75) amt = p.stack + p.committed;
    return amt;
  };
  const bluffMult = (heroInHand ? ex.bluffMult ?? 1 : 1) * (game.street === 'river' && heroInHand ? ex.riverBluffMult ?? 1 : 1);
  const valueTh = profile.valueTh - (heroInHand ? ex.valueThin ?? 0 : 0);

  if (toCall > 0) {
    const raiseTo = () => game.currentBet * (2.5 + rng() * 0.8) + (pot - game.currentBet) * 0.3;
    if (legal.canRaise && eq >= valueTh + 0.14 && rng() < profile.aggression + 0.2) return { type: 'raise', amount: raiseTo() };
    if (legal.canRaise && a.drawStrength >= 2 && game.street !== 'river' && rng() < profile.aggression * 0.35) return { type: 'raise', amount: raiseTo() };
    if (legal.canRaise && rng() < profile.bluff * 0.1 * bluffMult) return { type: 'raise', amount: raiseTo() };
    const implied = a.drawStrength >= 2 && game.street !== 'river' ? 0.06 : 0;
    if ((eq + implied) * profile.callLoose >= potOdds) return { type: 'call' };
    return { type: 'fold' };
  }

  // No bet to face.
  if (eq >= valueTh && rng() < 0.55 + profile.aggression * 0.45) {
    return { type: 'bet', amount: sizeBet(profile.sizing * (tex.wet >= 2 ? 1.1 : 0.9)) };
  }
  const isPfr = game.preflopAggressor === seat;
  if (game.street === 'flop' && isPfr && rng() < profile.cbet * (numOpp > 1 ? 0.45 : 1) * (tex.wet >= 2 ? 0.75 : 1.1)) {
    return { type: 'bet', amount: sizeBet(tex.wet >= 2 ? 0.66 : 0.33) };
  }
  if (a.drawStrength >= 2 && rng() < profile.aggression * 0.5) return { type: 'bet', amount: sizeBet(0.6) };
  if (rng() < profile.bluff * (numOpp > 1 ? 0.35 : 1) * bluffMult) return { type: 'bet', amount: sizeBet(profile.sizing) };
  return { type: 'check' };
}
