import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/engine.js';
import { createRng } from '../src/deck.js';

const names = ['Hero', 'A', 'B', 'C', 'D', 'E'];
const newGame = (seed = 1, opts = {}) =>
  new Game({ players: names.map((name, i) => ({ name, isHuman: i === 0 })), rng: createRng(seed), ...opts });

test('blinds, button and first actor are correct', () => {
  const g = newGame();
  g.startHand();
  assert.equal(g.button, 0);
  assert.equal(g.players[1].committed, 50);
  assert.equal(g.players[2].committed, 100);
  assert.equal(g.toAct, 3); // UTG
  assert.equal(g.positionOf(3), 'UTG');
  assert.equal(g.positionOf(5), 'CO');
  for (const p of g.players) assert.equal(p.holeCards.length, 2);
});

test('everyone folds to the big blind, who wins the blinds', () => {
  const g = newGame();
  g.startHand();
  for (let i = 0; i < 5; i++) g.act({ type: 'fold' });
  assert.ok(g.handOver);
  assert.equal(g.result.net[2], 50);
  assert.equal(g.result.net[1], -50);
  assert.equal(g.result.showdown, false);
});

test('big blind gets an option when limped to', () => {
  const g = newGame();
  g.startHand();
  g.act({ type: 'call' }); // UTG limp
  g.act({ type: 'fold' });
  g.act({ type: 'fold' });
  g.act({ type: 'fold' }); // BTN
  g.act({ type: 'call' }); // SB completes
  assert.equal(g.toAct, 2);
  const legal = g.legalActions();
  assert.ok(legal.canCheck);
  assert.ok(legal.canRaise);
  g.act({ type: 'check' });
  assert.equal(g.street, 'flop');
  assert.equal(g.board.length, 3);
  assert.equal(g.toAct, 1); // SB first postflop
});

test('min-raise rules: raise must be at least the previous raise size', () => {
  const g = newGame();
  g.startHand();
  g.act({ type: 'raise', amount: 300 }); // UTG raises to 3bb (raise size 2bb)
  const legal = g.legalActions();
  assert.equal(legal.minRaiseTo, 500);
  g.act({ type: 'raise', amount: 200 }); // too small -> clamped to min
  assert.equal(g.players[4].committed, 500);
  assert.equal(g.legalActions().minRaiseTo, 700);
});

test('an incomplete all-in raise does not re-open betting for players who already acted', () => {
  const g = newGame(1, { autoTopUp: false });
  g.players[4].stack = 450; // HJ short: 4.5bb behind
  g.startHand();
  g.act({ type: 'raise', amount: 300 }); // UTG to 3bb
  g.act({ type: 'allin' }); // HJ all-in for 4.5bb: increment 1.5bb < 2bb
  assert.equal(g.players[4].allIn, true);
  g.act({ type: 'fold' }); // CO
  g.act({ type: 'fold' }); // BTN
  g.act({ type: 'fold' }); // SB
  g.act({ type: 'call' }); // BB has not acted since last full raise → may call or raise
  assert.equal(g.toAct, 3); // back to UTG
  const legal = g.legalActions();
  assert.equal(legal.canRaise, false, 'UTG may only call or fold');
  assert.ok(legal.canCall);
});

test('all-in preflop runs out the board and resolves a side pot', () => {
  const g = newGame(7, { autoTopUp: false });
  g.players[3].stack = 1000; // UTG short (10bb)
  g.startHand();
  g.act({ type: 'allin' }); // UTG all-in 10bb
  g.act({ type: 'fold' });
  g.act({ type: 'fold' });
  g.act({ type: 'allin' }); // BTN all-in 100bb
  g.act({ type: 'fold' }); // SB
  g.act({ type: 'call' }); // BB calls all-in
  assert.ok(g.handOver);
  assert.equal(g.board.length, 5);
  assert.equal(g.result.showdown, true);
  assert.ok(g.result.runout);
  assert.equal(g.result.pots.length, 2);
  const net = Object.values(g.result.net).reduce((a, b) => a + b, 0);
  assert.equal(net, 0, 'chips conserved');
});

test('auto top-up keeps everyone at 100bb at the start of a hand', () => {
  const g = newGame(3);
  g.startHand();
  g.act({ type: 'allin' });
  while (!g.handOver) g.act({ type: g.legalActions().canCall ? 'call' : 'check' });
  g.startHand();
  for (const p of g.players) assert.ok(p.stack + p.total >= 10000);
});

test('random play never creates or destroys chips', () => {
  const rng = createRng(42);
  const g = newGame(99, { autoTopUp: false });
  for (let h = 0; h < 400; h++) {
    // Rebuy busted players manually so the table keeps going.
    for (const p of g.players) if (p.stack === 0) p.stack = 10000;
    const before = g.players.reduce((s, p) => s + p.stack, 0);
    g.startHand();
    let guard = 0;
    while (!g.handOver) {
      assert.ok(guard++ < 200, 'betting round terminated');
      const l = g.legalActions();
      const r = rng();
      let action;
      if (l.canRaise && r < 0.2) {
        const to = l.minRaiseTo + Math.floor(rng() * (l.maxRaiseTo - l.minRaiseTo + 1));
        action = { type: 'raise', amount: to };
      } else if (r < 0.3) action = { type: 'allin' };
      else if (r < 0.45) action = { type: 'fold' };
      else action = { type: l.canCall ? 'call' : 'check' };
      g.act(action);
    }
    const after = g.players.reduce((s, p) => s + p.stack, 0);
    assert.equal(after, before, `hand ${h} conserved chips`);
    for (const p of g.players) assert.ok(p.stack >= 0);
  }
});
