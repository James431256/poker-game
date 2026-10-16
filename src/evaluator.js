/**
 * evaluator.js — poker hand evaluator.
 *
 * evaluate(cards) takes 1–7 cards and returns an integer score for the best
 * five-card hand that can be made from them. Higher score = better hand, equal
 * scores = exact tie. Score layout (base 16 nibbles):
 *
 *   category << 20 | k1 << 16 | k2 << 12 | k3 << 8 | k4 << 4 | k5
 *
 * where category is one of CATEGORY.* and k1..k5 are tie-break ranks (0..12).
 * Fewer than five cards is allowed (used for "what does the board alone make")
 * and simply yields fewer kickers.
 */
import { cardRank, cardSuit, RANK_NAMES, RANK_PLURALS } from './deck.js';

export const CATEGORY = {
  HIGH_CARD: 0,
  PAIR: 1,
  TWO_PAIR: 2,
  TRIPS: 3,
  STRAIGHT: 4,
  FLUSH: 5,
  FULL_HOUSE: 6,
  QUADS: 7,
  STRAIGHT_FLUSH: 8,
};

export const CATEGORY_NAMES = [
  'High Card', 'Pair', 'Two Pair', 'Three of a Kind', 'Straight',
  'Flush', 'Full House', 'Four of a Kind', 'Straight Flush',
];

const WHEEL = 0b1000000001111; // A-2-3-4-5

/** Highest straight in a 13-bit rank mask, returned as the top rank, or -1. */
function straightHigh(mask) {
  for (let high = 12; high >= 4; high--) {
    const run = 0b11111 << (high - 4);
    if ((mask & run) === run) return high;
  }
  if ((mask & WHEEL) === WHEEL) return 3; // five-high
  return -1;
}

/** Up to n highest set ranks of a mask, descending. */
function topRanks(mask, n) {
  const out = [];
  for (let r = 12; r >= 0 && out.length < n; r--) if (mask & (1 << r)) out.push(r);
  return out;
}

function pack(category, kickers) {
  let score = category;
  for (let i = 0; i < 5; i++) score = (score << 4) | (kickers[i] ?? 0);
  return score;
}

export function evaluate(cards) {
  const counts = new Array(13).fill(0);
  const suitCounts = [0, 0, 0, 0];
  const suitMasks = [0, 0, 0, 0];
  let rankMask = 0;

  for (let i = 0; i < cards.length; i++) {
    const r = cardRank(cards[i]);
    const s = cardSuit(cards[i]);
    counts[r]++;
    suitCounts[s]++;
    suitMasks[s] |= 1 << r;
    rankMask |= 1 << r;
  }

  // Flushes and straight flushes. With ≤7 cards at most one suit can have 5+.
  let flushSuit = -1;
  for (let s = 0; s < 4; s++) if (suitCounts[s] >= 5) flushSuit = s;
  if (flushSuit >= 0) {
    const sf = straightHigh(suitMasks[flushSuit]);
    if (sf >= 0) return pack(CATEGORY.STRAIGHT_FLUSH, [sf]);
  }

  // Group ranks by multiplicity, highest rank first.
  let quad = -1;
  const trips = [];
  const pairs = [];
  for (let r = 12; r >= 0; r--) {
    if (counts[r] === 4) quad = r;
    else if (counts[r] === 3) trips.push(r);
    else if (counts[r] === 2) pairs.push(r);
  }

  if (quad >= 0) {
    const kick = topRanks(rankMask & ~(1 << quad), 1);
    return pack(CATEGORY.QUADS, [quad, ...kick]);
  }
  if (trips.length > 0 && trips.length + pairs.length >= 2) {
    // Second trips can serve as the pair of a full house.
    const pairRank = Math.max(trips[1] ?? -1, pairs[0] ?? -1);
    return pack(CATEGORY.FULL_HOUSE, [trips[0], pairRank]);
  }
  if (flushSuit >= 0) return pack(CATEGORY.FLUSH, topRanks(suitMasks[flushSuit], 5));

  const st = straightHigh(rankMask);
  if (st >= 0) return pack(CATEGORY.STRAIGHT, [st]);

  if (trips.length > 0) {
    const kick = topRanks(rankMask & ~(1 << trips[0]), 2);
    return pack(CATEGORY.TRIPS, [trips[0], ...kick]);
  }
  if (pairs.length >= 2) {
    const kick = topRanks(rankMask & ~(1 << pairs[0]) & ~(1 << pairs[1]), 1);
    return pack(CATEGORY.TWO_PAIR, [pairs[0], pairs[1], ...kick]);
  }
  if (pairs.length === 1) {
    const kick = topRanks(rankMask & ~(1 << pairs[0]), 3);
    return pack(CATEGORY.PAIR, [pairs[0], ...kick]);
  }
  return pack(CATEGORY.HIGH_CARD, topRanks(rankMask, 5));
}

export const scoreCategory = (score) => score >>> 20;
const kicker = (score, i) => (score >>> (16 - 4 * i)) & 15;

/** Human-readable description, e.g. "Full House, Kings full of Sevens". */
export function describeScore(score) {
  const cat = scoreCategory(score);
  const k = [0, 1, 2, 3, 4].map((i) => kicker(score, i));
  switch (cat) {
    case CATEGORY.STRAIGHT_FLUSH:
      return k[0] === 12 ? 'Royal Flush' : `Straight Flush, ${RANK_NAMES[k[0]]}-high`;
    case CATEGORY.QUADS: return `Four of a Kind, ${RANK_PLURALS[k[0]]}`;
    case CATEGORY.FULL_HOUSE: return `Full House, ${RANK_PLURALS[k[0]]} full of ${RANK_PLURALS[k[1]]}`;
    case CATEGORY.FLUSH: return `Flush, ${RANK_NAMES[k[0]]}-high`;
    case CATEGORY.STRAIGHT: return `Straight, ${RANK_NAMES[k[0]]}-high`;
    case CATEGORY.TRIPS: return `Three of a Kind, ${RANK_PLURALS[k[0]]}`;
    case CATEGORY.TWO_PAIR: return `Two Pair, ${RANK_PLURALS[k[0]]} and ${RANK_PLURALS[k[1]]}`;
    case CATEGORY.PAIR: return `Pair of ${RANK_PLURALS[k[0]]}`;
    default: return `${RANK_NAMES[k[0]]}-high`;
  }
}

/** Convenience: evaluate + describe. */
export const describeHand = (cards) => describeScore(evaluate(cards));

/** Compare two card sets: >0 if a wins, <0 if b wins, 0 for a tie. */
export const compareHands = (a, b) => evaluate(a) - evaluate(b);
