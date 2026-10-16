import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPots, awardPots } from '../src/pots.js';

const sum = (pots) => pots.reduce((s, p) => s + p.amount, 0);

test('single pot when everyone contributes equally', () => {
  const pots = buildPots([
    { id: 0, amount: 100, folded: false },
    { id: 1, amount: 100, folded: false },
    { id: 2, amount: 100, folded: false },
  ]);
  assert.deepEqual(pots, [{ amount: 300, eligible: [0, 1, 2] }]);
});

test('short all-in creates a main pot and a side pot', () => {
  const pots = buildPots([
    { id: 0, amount: 50, folded: false }, // all-in short
    { id: 1, amount: 200, folded: false },
    { id: 2, amount: 200, folded: false },
  ]);
  assert.deepEqual(pots, [
    { amount: 150, eligible: [0, 1, 2] },
    { amount: 300, eligible: [1, 2] },
  ]);
});

test('three different all-in amounts produce three pots', () => {
  const pots = buildPots([
    { id: 0, amount: 30, folded: false },
    { id: 1, amount: 70, folded: false },
    { id: 2, amount: 150, folded: false },
    { id: 3, amount: 150, folded: false },
  ]);
  assert.deepEqual(pots, [
    { amount: 120, eligible: [0, 1, 2, 3] },
    { amount: 120, eligible: [1, 2, 3] },
    { amount: 160, eligible: [2, 3] },
  ]);
  assert.equal(sum(pots), 400);
});

test('folded players contribute but are never eligible', () => {
  const pots = buildPots([
    { id: 0, amount: 20, folded: true },
    { id: 1, amount: 100, folded: false },
    { id: 2, amount: 100, folded: false },
  ]);
  assert.deepEqual(pots, [{ amount: 220, eligible: [1, 2] }]);
});

test('folded player who put in more than an all-in player feeds both pots', () => {
  const pots = buildPots([
    { id: 0, amount: 40, folded: false }, // all-in
    { id: 1, amount: 100, folded: true }, // bet then folded to a raise
    { id: 2, amount: 300, folded: false },
    { id: 3, amount: 300, folded: false },
  ]);
  assert.deepEqual(pots, [
    { amount: 160, eligible: [0, 2, 3] },
    { amount: 580, eligible: [2, 3] },
  ]);
});

test('uncalled excess forms a pot only the bettor can win (returned)', () => {
  const pots = buildPots([
    { id: 0, amount: 100, folded: false },
    { id: 1, amount: 500, folded: false },
  ]);
  assert.deepEqual(pots, [
    { amount: 200, eligible: [0, 1] },
    { amount: 400, eligible: [1] },
  ]);
  const { payouts } = awardPots(pots, { 0: 10, 1: 5 }, [0, 1]);
  assert.deepEqual(payouts, { 0: 200, 1: 400 });
});

test('short stack wins main pot, bigger stack wins side pot', () => {
  const pots = buildPots([
    { id: 0, amount: 50, folded: false },
    { id: 1, amount: 200, folded: false },
    { id: 2, amount: 200, folded: false },
  ]);
  const { payouts } = awardPots(pots, { 0: 900, 1: 500, 2: 100 }, [0, 1, 2]);
  assert.deepEqual(payouts, { 0: 150, 1: 300 });
});

test('split pot divides evenly and odd chip goes to first seat left of the button', () => {
  const pots = [{ amount: 301, eligible: [1, 3] }];
  // order starts left of button: seat 3 is earlier than seat 1 here
  const { payouts } = awardPots(pots, { 1: 7, 3: 7 }, [3, 4, 5, 0, 1, 2]);
  assert.deepEqual(payouts, { 3: 151, 1: 150 });
});

test('three-way split with a side pot', () => {
  const pots = buildPots([
    { id: 0, amount: 100, folded: false },
    { id: 1, amount: 300, folded: false },
    { id: 2, amount: 300, folded: false },
  ]);
  // Everyone ties: main pot splits three ways, side pot splits two ways.
  const { payouts } = awardPots(pots, { 0: 1, 1: 1, 2: 1 }, [0, 1, 2]);
  assert.deepEqual(payouts, { 0: 100, 1: 300, 2: 300 });
});

test('chips are conserved for random contributions', () => {
  for (let t = 0; t < 500; t++) {
    const n = 2 + Math.floor(Math.random() * 5);
    const contributions = Array.from({ length: n }, (_, id) => ({
      id, amount: Math.floor(Math.random() * 1000), folded: Math.random() < 0.3,
    }));
    if (contributions.every((c) => c.folded)) contributions[0].folded = false;
    const pots = buildPots(contributions);
    const total = contributions.reduce((s, c) => s + c.amount, 0);
    assert.equal(sum(pots), total);
    const scores = Object.fromEntries(contributions.map((c) => [c.id, Math.floor(Math.random() * 3)]));
    const { payouts } = awardPots(pots, scores, contributions.map((c) => c.id));
    const paid = Object.values(payouts).reduce((s, v) => s + v, 0);
    // Pots with nobody eligible can only arise when every live player put in 0.
    const unclaimable = pots.filter((p) => p.eligible.length === 0).reduce((s, p) => s + p.amount, 0);
    assert.equal(paid + unclaimable, total);
    for (const id of Object.keys(payouts)) {
      assert.ok(!contributions[id].folded, 'folded player was paid');
    }
  }
});
