/**
 * equity.js — Monte Carlo equity against weighted opponent ranges, plus outs
 * counting and the "rule of 2 and 4".
 */
import { makeDeck, createRng } from './deck.js';
import { evaluate } from './evaluator.js';
import { analyzeHand, TIER } from './analysis.js';

/**
 * A weighted range: concrete combos and (optional) relative weights.
 * @typedef {{combos: Array<[number, number]>, weights?: number[]}} WeightedRange
 */

/** Prepare a range for fast weighted sampling. */
function prepare(range) {
  if (!range) return null; // null = any two cards
  const { combos } = range;
  const weights = range.weights ?? combos.map(() => 1);
  const cum = new Float64Array(combos.length);
  let total = 0;
  for (let i = 0; i < combos.length; i++) {
    total += weights[i];
    cum[i] = total;
  }
  return total > 0 ? { combos, cum, total } : null;
}

function sampleIndex(p, rng) {
  const x = rng() * p.total;
  let lo = 0;
  let hi = p.cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (p.cum[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Estimate hero's equity (pot share) against one or more opponents.
 * @param {number[]} hero two hole cards
 * @param {number[]} board 0–5 board cards
 * @param {Array<WeightedRange|null>} opponents one entry per opponent (null = random hand)
 * @param {{iterations?:number, rng?:function}} [opts]
 * @returns {{equity:number, win:number, tie:number, iterations:number}}
 */
export function simulateEquity(hero, board, opponents, { iterations = 2000, rng = createRng() } = {}) {
  const prepared = opponents.map(prepare);
  const used = new Uint8Array(52);
  const deck = makeDeck();
  const needBoard = 5 - board.length;
  const fullBoard = new Array(5);
  const heroCards = new Array(7);
  const oppCards = new Array(7);
  const oppHole = prepared.map(() => [0, 0]);
  let share = 0;
  let wins = 0;
  let ties = 0;
  let done = 0;

  for (let it = 0; it < iterations; it++) {
    used.fill(0);
    for (const c of hero) used[c] = 1;
    for (const c of board) used[c] = 1;

    // Opponent hands: weighted sample, retrying when a card is already taken.
    for (let o = 0; o < prepared.length; o++) {
      const p = prepared[o];
      let placed = false;
      if (p) {
        for (let tries = 0; tries < 30 && !placed; tries++) {
          const [a, b] = p.combos[sampleIndex(p, rng)];
          if (!used[a] && !used[b]) {
            oppHole[o][0] = a; oppHole[o][1] = b; used[a] = 1; used[b] = 1; placed = true;
          }
        }
      }
      if (!placed) {
        // Random hand (either no range given or the range is fully blocked).
        const a = drawFree(deck, used, rng);
        used[a] = 1;
        const b = drawFree(deck, used, rng);
        used[b] = 1;
        oppHole[o][0] = a; oppHole[o][1] = b;
      }
    }

    for (let i = 0; i < board.length; i++) fullBoard[i] = board[i];
    for (let i = 0; i < needBoard; i++) {
      const c = drawFree(deck, used, rng);
      used[c] = 1;
      fullBoard[board.length + i] = c;
    }

    heroCards[0] = hero[0]; heroCards[1] = hero[1];
    for (let i = 0; i < 5; i++) { heroCards[i + 2] = fullBoard[i]; oppCards[i + 2] = fullBoard[i]; }
    const heroScore = evaluate(heroCards);
    let tiedWith = 0;
    let lost = false;
    for (let o = 0; o < oppHole.length; o++) {
      oppCards[0] = oppHole[o][0]; oppCards[1] = oppHole[o][1];
      const s = evaluate(oppCards);
      if (s > heroScore) { lost = true; break; }
      if (s === heroScore) tiedWith++;
    }
    done++;
    if (lost) continue;
    if (tiedWith === 0) { wins++; share += 1; } else { ties++; share += 1 / (tiedWith + 1); }
  }
  return {
    equity: done ? share / done : 0,
    win: done ? wins / done : 0,
    tie: done ? ties / done : 0,
    iterations: done,
  };
}

function drawFree(deck, used, rng) {
  for (;;) {
    const c = deck[Math.floor(rng() * 52)];
    if (!used[c]) return c;
  }
}

/** Equity vs N random hands — a quick strength proxy used by simpler bots. */
export const equityVsRandom = (hero, board, numOpp, iterations = 400, rng) =>
  simulateEquity(hero, board, Array(numOpp).fill(null), { iterations, rng }).equity;

/**
 * Count "outs": unseen cards that improve hero to a meaningfully stronger hand.
 * Strong outs make two pair or better (or a straight/flush); "pair outs" only
 * make top/middle pair from nothing, which is often not good enough, so they
 * are reported separately and discounted by half in the equity estimate.
 * Board-only improvements (e.g. the board pairing) never count.
 * @returns {{count:number, cards:number[], pairOuts:number, pairCards:number[], approxEquity:number}|null}
 */
export function countOuts(hero, board) {
  if (board.length < 3 || board.length > 4) return null;
  const now = analyzeHand(hero, board);
  const dead = new Set([...hero, ...board]);
  const cards = [];
  const pairCards = [];
  for (let c = 0; c < 52; c++) {
    if (dead.has(c)) continue;
    const next = analyzeHand(hero, [...board, c]);
    if (next.tier <= now.tier) continue;
    if (next.tier >= TIER.TWO_PAIR) cards.push(c);
    else if (now.tier === TIER.AIR && next.tier >= TIER.MIDDLE_PAIR) pairCards.push(c);
  }
  const effective = cards.length + pairCards.length / 2;
  return {
    count: cards.length,
    cards,
    pairOuts: pairCards.length,
    pairCards,
    approxEquity: ruleOf2and4(effective, board.length === 3 ? 2 : 1),
  };
}

/**
 * Rule of 2 and 4: with two cards to come equity ≈ outs × 4 (minus a little
 * above 8 outs), with one card ≈ outs × 2. Returns a fraction.
 */
export function ruleOf2and4(outs, cardsToCome) {
  const pct = cardsToCome === 2 ? outs * 4 - Math.max(0, outs - 8) : outs * 2;
  return Math.min(0.99, pct / 100);
}

/** Exact probability of hitting one of `outs` with `cardsToCome` cards from `unseen`. */
export function exactHitChance(outs, cardsToCome, unseen) {
  if (cardsToCome === 1) return outs / unseen;
  return 1 - ((unseen - outs) / unseen) * ((unseen - 1 - outs) / (unseen - 1));
}
