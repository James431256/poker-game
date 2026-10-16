import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCards } from '../src/deck.js';
import { evaluate, scoreCategory, CATEGORY, describeHand } from '../src/evaluator.js';

const ev = (s) => evaluate(parseCards(s));
const cat = (s) => scoreCategory(ev(s));

test('detects every hand category from 7 cards', () => {
  assert.equal(cat('As Ks Qs Js Ts 2c 3d'), CATEGORY.STRAIGHT_FLUSH);
  assert.equal(cat('9h 9d 9s 9c Kd 2c 3d'), CATEGORY.QUADS);
  assert.equal(cat('9h 9d 9s Kc Kd 2c 3d'), CATEGORY.FULL_HOUSE);
  assert.equal(cat('2h 7h 9h Jh Kh 2c 3d'), CATEGORY.FLUSH);
  assert.equal(cat('5c 6d 7h 8s 9c Kd 2h'), CATEGORY.STRAIGHT);
  assert.equal(cat('7c 7d 7h As 9c Kd 2h'), CATEGORY.TRIPS);
  assert.equal(cat('7c 7d 9h 9s Ac Kd 2h'), CATEGORY.TWO_PAIR);
  assert.equal(cat('7c 7d 9h Js Ac Kd 2h'), CATEGORY.PAIR);
  assert.equal(cat('7c 3d 9h Js Ac Kd 2h'), CATEGORY.HIGH_CARD);
});

test('wheel is a five-high straight and loses to a six-high straight', () => {
  assert.equal(cat('Ac 2d 3h 4s 5c Kd 9h'), CATEGORY.STRAIGHT);
  assert.ok(ev('2d 3h 4s 5c 6c Kd 9h') > ev('Ac 2d 3h 4s 5c Kd 9h'));
  assert.equal(describeHand(parseCards('Ac 2d 3h 4s 5c Kd 9h')), 'Straight, Five-high');
});

test('steel wheel is a straight flush, not just a flush', () => {
  assert.equal(cat('Ah 2h 3h 4h 5h Kh 9c'), CATEGORY.STRAIGHT_FLUSH);
});

test('royal flush description', () => {
  assert.equal(describeHand(parseCards('As Ks Qs Js Ts')), 'Royal Flush');
});

test('kickers break ties correctly', () => {
  // Same pair of aces, king kicker beats queen kicker.
  assert.ok(ev('Ac Ad Kh 7s 4c 3d 2h') > ev('Ac Ad Qh 7s 4c 3d 2h'));
  // Two pair: higher top pair wins; then second pair; then kicker.
  assert.ok(ev('Kc Kd 2h 2s Ac') > ev('Qc Qd Jh Js Ac'));
  assert.ok(ev('Kc Kd 3h 3s 4c') > ev('Kc Kd 2h 2s Ac'));
  assert.ok(ev('Kc Kd 3h 3s Ac') > ev('Kc Kd 3h 3s Qc'));
  // Only the best five cards count: sixth/seventh cards don't play.
  assert.equal(ev('Ac Kd Qh Js 9c 3d 2h'), ev('Ac Kd Qh Js 9c 4d 3h'));
});

test('three pairs: best two pairs plus best kicker', () => {
  // Board pair of 4s doesn't play; the 5 is not the kicker, the higher of 4/5... K plays.
  assert.equal(ev('Ac Ad Kh Ks 4c 4d 2h'), ev('Ac Ad Kh Ks 4c 3d 2h'));
  // Third pair can be the kicker when it beats the remaining single card.
  assert.ok(ev('Ac Ad Kh Ks Qc Qd 2h') > ev('Ac Ad Kh Ks Jc Jd 2h'));
});

test('two sets make a full house using the higher set as trips', () => {
  const a = ev('9h 9d 9s 5c 5d 5h 2c');
  assert.equal(scoreCategory(a), CATEGORY.FULL_HOUSE);
  assert.equal(describeHand(parseCards('9h 9d 9s 5c 5d 5h 2c')), 'Full House, Nines full of Fives');
});

test('flush beats straight; full house beats flush', () => {
  assert.ok(ev('2h 7h 9h Jh Kh') > ev('9c Td Jh Qs Kc'));
  assert.ok(ev('2h 2d 2s 3c 3h') > ev('2h 7h 9h Jh Kh'));
});

test('flush compares all five cards', () => {
  assert.ok(ev('Ah Kh 9h 7h 3h') > ev('Ah Kh 9h 7h 2h'));
  // A 6th flush card should not lower or raise the best 5.
  assert.equal(ev('Ah Kh 9h 7h 3h 2h 2c'), ev('Ah Kh 9h 7h 3h'));
});

test('quads kicker uses the best remaining card even if paired', () => {
  assert.equal(ev('9h 9d 9s 9c Kd Kc 2d'), ev('9h 9d 9s 9c Kd 3c 2d'));
});

test('identical hands with different suits tie', () => {
  assert.equal(ev('Ac Kd Qh Js 9c'), ev('Ad Kh Qs Jc 9d'));
});

test('works on partial hands (fewer than 5 cards)', () => {
  assert.equal(cat('Ah Ad'), CATEGORY.PAIR);
  assert.equal(cat('Ah Ad As 2c'), CATEGORY.TRIPS);
});
