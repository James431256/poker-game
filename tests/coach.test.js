import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCards, createRng } from '../src/deck.js';
import { simulateEquity, countOuts, ruleOf2and4 } from '../src/equity.js';
import { analyzeHand, TIER } from '../src/analysis.js';
import { rangeCombos, rangeSet } from '../src/ranges.js';
import { Game } from '../src/engine.js';
import { getAdvice } from '../src/coach.js';
import { analyzeHandFor } from '../src/stats.js';
import { Session } from '../src/session.js';
import { defaultState } from '../src/storage.js';

const P = parseCards;

test('Monte Carlo equity: AA vs KK is about 82%', () => {
  const r = simulateEquity(P('As Ah'), [], [{ combos: rangeCombos(rangeSet('KK'), P('As Ah')) }], { iterations: 20000, rng: createRng(1) });
  assert.ok(Math.abs(r.equity - 0.82) < 0.02, `got ${r.equity}`);
});

test('equity on the river is exact: nuts = 100%', () => {
  const r = simulateEquity(P('Ah Kh'), P('Qh Jh Th 2c 3d'), [null, null], { iterations: 500 });
  assert.equal(r.equity, 1);
});

test('outs: flush draw 9, open-ender 8, gutshot 4', () => {
  assert.equal(countOuts(P('Ah 5h'), P('Kh 7h 2c')).count, 9);
  assert.equal(countOuts(P('9s 8s'), P('7d 6c 2h')).count, 8);
  assert.equal(countOuts(P('Ad 5c'), P('Kc 7d 2s 3h')).count, 4);
  assert.equal(ruleOf2and4(9, 2), 0.35);
  assert.equal(ruleOf2and4(9, 1), 0.18);
});

test('hand analysis labels', () => {
  assert.equal(analyzeHand(P('Kd Jd'), P('Kc 7d 2s')).label, 'Top pair, good kicker');
  assert.equal(analyzeHand(P('7c 7h'), P('Kc 7d 2s')).tier, TIER.SET);
  assert.equal(analyzeHand(P('Qs Qd'), P('Jc 7d 2s')).label, 'Overpair');
  const fd = analyzeHand(P('Ah 5h'), P('Kh 7h 2c'));
  assert.ok(fd.flushDraw && fd.nutFlushDraw);
});

const names = ['You', 'A', 'B', 'C', 'D', 'E'];
const game = (seed) => new Game({ players: names.map((name, i) => ({ name, isHuman: i === 0 })), rng: createRng(seed) });

test('coach: premium hands open, trash folds (UTG)', () => {
  // Button is seat 0 for the first hand, so seat 3 is UTG.
  for (const [cards, expected] of [['As Ad', 'raise'], ['7c 2d', 'fold']]) {
    const g = game(3);
    g.startHand();
    g.players[3].holeCards = P(cards);
    const a = getAdvice(g, 3, { iterations: 200 });
    assert.equal(a.recommendation.type, expected, cards);
  }
});

test('coach: folds air to a pot-sized river bet, calls with the nuts', () => {
  const g = game(9);
  g.startHand();
  // Script: BTN (seat 0) opens, BB (seat 2) calls; check down to the river.
  while (g.street === 'preflop') {
    if (g.toAct === 0) g.act({ type: 'raise', amount: 250 });
    else if (g.toAct === 2) g.act({ type: 'call' });
    else g.act({ type: 'fold' });
  }
  while (g.street !== 'river') g.act({ type: 'check' });
  g.board = P('Kc 8d 4s 2h 9c');
  g.players[0].holeCards = P('6h 5h'); // missed draw, six-high
  g.players[2].holeCards = P('Ks Qs');
  g.act({ type: 'bet', amount: g.pot }); // BB bets pot
  const air = getAdvice(g, 0, { iterations: 1500 });
  assert.equal(air.recommendation.type, 'fold');
  g.players[0].holeCards = P('Ah Ad');
  g.board = P('Kc 8d 4s 2h 9c');
  // Pocket aces on this board beat a one-pair betting range most of the time.
  const strong = getAdvice(g, 0, { iterations: 1500 });
  assert.notEqual(strong.recommendation.type, 'fold');
});

test('stats extraction: open, face 3-bet, fold', () => {
  const g = game(4);
  g.startHand();
  // Seat 3 (UTG) is the hero-under-test here.
  g.act({ type: 'raise', amount: 250 }); // UTG opens
  g.act({ type: 'raise', amount: 800 }); // HJ 3-bets
  g.act({ type: 'fold' });
  g.act({ type: 'fold' });
  g.act({ type: 'fold' });
  g.act({ type: 'fold' });
  g.act({ type: 'fold' }); // UTG folds to the 3-bet
  const f = analyzeHandFor(g.history, 3);
  assert.ok(f.vpip && f.pfr && f.foldTo3betOpp && f.foldTo3bet);
  const h = analyzeHandFor(g.history, 4);
  assert.ok(h.threeBetOpp && h.threeBet && h.pfr);
});

test('session runs full hands headlessly, grades decisions and conserves chips', () => {
  const s = new Session(defaultState(), { rng: createRng(11), persist: false });
  for (let i = 0; i < 25; i++) {
    s.startHand();
    const before = s.game.players.reduce((t, p) => t + p.stack + p.total, 0);
    while (!s.game.handOver) {
      if (s.isHumanTurn) {
        const a = s.advice({ iterations: 200 });
        s.humanAct({ type: a.recommendation.type, amount: a.recommendation.amount ?? undefined });
      } else s.botAct();
    }
    const after = s.game.players.reduce((t, p) => t + p.stack, 0);
    assert.equal(after, before);
    const summary = s.finishHand();
    for (const g of summary.graded) assert.ok(['good', 'marginal', 'mistake'].includes(g.grade));
  }
  assert.equal(s.state.hero.hands, 25);
  assert.equal(s.state.histories.length, 25);
});
