/**
 * drills.js — quick-fire postflop spot drills.
 *
 * Each drill builds a real hand in the engine: scripted preflop/postflop
 * actions, chosen hole cards and a chosen board. The coach then evaluates the
 * decision point exactly as it would at the table, so drill answers and live
 * coaching always agree.
 */
import { Game } from './engine.js';
import { createRng, deckWithout, shuffle, cardsPretty } from './deck.js';
import { rangeSet, RFI, VS_OPEN, rangeCombos } from './ranges.js';
import { analyzeHand, boardTexture, TIER } from './analysis.js';
import { getAdvice } from './coach.js';

const NAMES = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
// Seats when the button is seat 0: BTN 0, SB 1, BB 2, UTG 3, HJ 4, CO 5.
const SEAT = { BTN: 0, SB: 1, BB: 2, UTG: 3, HJ: 4, CO: 5 };

export const DRILL_TYPES = {
  cbet: 'C-bet or check (as preflop raiser)',
  facingCbet: 'Facing a flop c-bet',
  turnDraw: 'Drawing on the turn',
  riverCatch: 'River bluff-catcher',
};

function setup(rng, openerPos, callerPos, heroSeat, heroFilter, boardCards) {
  for (let attempt = 0; attempt < 400; attempt++) {
    const g = new Game({ players: NAMES.map((n, i) => ({ name: i === heroSeat ? 'You' : 'Villain', isHuman: i === heroSeat })), rng });
    g.startHand();
    const heroRange = heroSeat === SEAT[openerPos]
      ? rangeSet(RFI[openerPos])
      : rangeSet(VS_OPEN[callerPos]?.LP?.call || VS_OPEN.BB.LP.call);
    const villainSeat = heroSeat === SEAT[openerPos] ? SEAT[callerPos] : SEAT[openerPos];
    const villainRange = villainSeat === SEAT[openerPos] ? rangeSet(RFI[openerPos]) : rangeSet(VS_OPEN.BB.LP.call);

    const heroCombos = rangeCombos(heroRange);
    const hero = heroCombos[Math.floor(rng() * heroCombos.length)];
    const deck = shuffle(deckWithout(hero), rng);
    const board = deck.slice(0, boardCards);
    if (!heroFilter(hero, board)) continue;
    const villainCombos = rangeCombos(villainRange, [...hero, ...board]);
    if (!villainCombos.length) continue;
    const villain = villainCombos[Math.floor(rng() * villainCombos.length)];
    const used = new Set([...hero, ...board, ...villain]);
    const rest = deck.filter((c) => !used.has(c));

    // Assign hole cards; give the folded players any other cards.
    g.players.forEach((p, i) => {
      if (i === heroSeat) p.holeCards = [...hero];
      else if (i === villainSeat) p.holeCards = [...villain];
      else p.holeCards = [rest.pop(), rest.pop()];
    });
    g.history.players.forEach((hp, i) => { hp.holeCards = [...g.players[i].holeCards]; });
    // Deck order so the engine deals our chosen board (with burn cards).
    const b = [...board, ...rest.slice(0, 5 - board.length)];
    g.deck = [rest[10], b[0], b[1], b[2], rest[11], b[3], rest[12], b[4]];
    g.deckPos = 0;

    // Scripted preflop: opener raises 2.5bb, caller calls, everyone else folds.
    while (g.street === 'preflop' && !g.handOver) {
      const s = g.toAct;
      if (s === SEAT[openerPos]) g.act({ type: 'raise', amount: 250 });
      else if (s === SEAT[callerPos]) g.act({ type: 'call' });
      else g.act({ type: 'fold' });
    }
    return { g, heroSeat, villainSeat };
  }
  throw new Error('Could not build drill');
}

/** Script a street: list of [seat, action] in order. */
function play(g, script) {
  for (const [seat, action] of script) {
    if (g.toAct !== seat) throw new Error(`Drill script out of sync (${g.toAct} vs ${seat})`);
    g.act(action);
  }
}

const potFrac = (g, f) => Math.round((g.pot * f) / 10) * 10;

/**
 * Create a spot drill.
 * @param {{type?:string, rng?:function, iterations?:number}} [opts]
 */
export function makeDrill({ type, rng = createRng(), iterations = 2500 } = {}) {
  const types = Object.keys(DRILL_TYPES);
  if (!type || type === 'mixed') type = types[Math.floor(rng() * types.length)];
  const opener = rng() < 0.6 ? 'BTN' : 'CO';
  let g;
  let heroSeat;
  let villainSeat;
  let story;
  const betSize = [0.33, 0.5, 0.75][Math.floor(rng() * 3)];

  if (type === 'cbet') {
    ({ g, heroSeat, villainSeat } = setup(rng, opener, 'BB', SEAT[opener], () => true, 3));
    play(g, [[villainSeat, { type: 'check' }]]);
    story = `You opened ${opener}, BB called. BB checks to you.`;
  } else if (type === 'facingCbet') {
    ({ g, heroSeat, villainSeat } = setup(rng, opener, 'BB', SEAT.BB, () => true, 3));
    play(g, [[heroSeat, { type: 'check' }], [villainSeat, { type: 'bet', amount: potFrac(g, betSize) }]]);
    story = `${opener} opened, you called in the BB. You check, ${opener} c-bets ${Math.round(betSize * 100)}% pot.`;
  } else if (type === 'turnDraw') {
    const isDraw = (h, b) => {
      const a = analyzeHand(h, b.slice(0, 4));
      return a.drawStrength >= 2 && a.tier <= TIER.MIDDLE_PAIR;
    };
    ({ g, heroSeat, villainSeat } = setup(rng, opener, 'BB', SEAT.BB, isDraw, 4));
    play(g, [[heroSeat, { type: 'check' }], [villainSeat, { type: 'bet', amount: potFrac(g, 0.33) }], [heroSeat, { type: 'call' }]]);
    const turnBet = [0.5, 0.75, 1][Math.floor(rng() * 3)];
    play(g, [[heroSeat, { type: 'check' }], [villainSeat, { type: 'bet', amount: potFrac(g, turnBet) }]]);
    story = `${opener} opened, you called in the BB. Flop: check, ${opener} bets 1/3 pot, you call. Turn: you check, ${opener} bets ${Math.round(turnBet * 100)}% pot.`;
  } else {
    const medium = (h, b) => {
      const a = analyzeHand(h, b);
      return a.tier >= TIER.WEAK_PAIR && a.tier <= TIER.TOP_PAIR_GOOD;
    };
    ({ g, heroSeat, villainSeat } = setup(rng, opener, 'BB', SEAT[opener], medium, 5));
    const riverBet = [0.5, 0.75, 1.2][Math.floor(rng() * 3)];
    play(g, [
      [villainSeat, { type: 'check' }], [heroSeat, { type: 'bet', amount: potFrac(g, 0.33) }], [villainSeat, { type: 'call' }],
      [villainSeat, { type: 'check' }], [heroSeat, { type: 'check' }],
      [villainSeat, { type: 'bet', amount: potFrac(g, riverBet) }],
    ]);
    story = `You opened ${opener}, BB called. Flop: BB checks, you bet 1/3, BB calls. Turn: check, check. River: BB bets ${Math.round(riverBet * 100)}% pot.`;
  }

  const advice = getAdvice(g, heroSeat, { iterations });
  const tex = boardTexture(g.board);
  const pos = g.positionOf(heroSeat);
  const villainPos = g.positionOf(villainSeat);
  const tolerance = Math.max(0.04 * advice.pot, 0.25 * g.bb);
  const best = advice.options[0];
  const options = advice.options
    .map((o) => ({ ...o, correct: o === best, acceptable: best.ev - o.ev <= tolerance }))
    .sort((a, b) => rank(a) - rank(b));

  return {
    type,
    title: `${pos} vs ${villainPos} · ${g.street[0].toUpperCase() + g.street.slice(1)} ${cardsPretty(g.board)}${tex.label ? ` (${tex.label})` : ''}`,
    story,
    hero: g.players[heroSeat].holeCards,
    board: g.board,
    pot: g.pot,
    toCall: advice.callAmount,
    potFmt: g.fmt(g.pot),
    position: pos,
    villainPos,
    advice,
    options,
    fmt: (c) => g.fmt(c),
    villainCards: g.players[villainSeat].holeCards,
  };
}

const order = { fold: 0, check: 1, call: 2, bet: 3, raise: 4 };
const rank = (o) => order[o.type] * 1e6 + (o.amount ?? 0);
