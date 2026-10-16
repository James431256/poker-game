/**
 * analysis.js — classify a holding on a board in human terms ("top pair,
 * good kicker", "flush draw") and as a numeric tier. Used by the coach,
 * the opponent range model, bots, outs counting and drills.
 */
import { cardRank, cardSuit, RANK_NAMES, RANK_PLURALS } from './deck.js';
import { evaluate, scoreCategory, CATEGORY } from './evaluator.js';

/** Made-hand tiers, weakest to strongest. */
export const TIER = {
  AIR: 0, // nothing / board pair only
  WEAK_PAIR: 1, // bottom pair, underpair, playing the board
  MIDDLE_PAIR: 2,
  TOP_PAIR_WEAK: 3,
  TOP_PAIR_GOOD: 4, // top pair good kicker or overpair
  TWO_PAIR: 5,
  SET: 6, // sets and trips
  STRAIGHT_FLUSH_DRAWN: 7, // straights and flushes
  MONSTER: 8, // full house or better
};

const mask = (ranks) => ranks.reduce((m, r) => m | (1 << r), 0);

function makesStraight(m) {
  if ((m & 0b1000000001111) === 0b1000000001111) return true;
  for (let hi = 12; hi >= 4; hi--) {
    const run = 0b11111 << (hi - 4);
    if ((m & run) === run) return true;
  }
  return false;
}

/**
 * @param {number[]} hole two cards
 * @param {number[]} board 0–5 cards
 */
export function analyzeHand(hole, board) {
  const all = [...hole, ...board];
  const score = evaluate(all);
  const cat = scoreCategory(score);
  const h = hole.map(cardRank).sort((a, b) => b - a);
  const b = board.map(cardRank).sort((x, y) => y - x);
  const res = {
    score, category: cat, tier: TIER.AIR, label: '',
    flushDraw: false, nutFlushDraw: false, oesd: false, gutshot: false,
    backdoorFlush: false, overcards: false, drawStrength: 0, drawLabel: '',
  };

  if (board.length < 3) {
    res.label = h[0] === h[1] ? `Pocket ${RANK_PLURALS[h[0]]}` : `${RANK_NAMES[h[0]]}-${RANK_NAMES[h[1]]}`;
    return res;
  }

  const boardScore = evaluate(board);
  const boardCat = scoreCategory(boardScore);
  const top = b[0];
  const countOnBoard = (r) => b.filter((x) => x === r).length;
  const pocketPair = h[0] === h[1];

  // ---- made hand
  if (board.length === 5 && score === boardScore) {
    res.tier = TIER.WEAK_PAIR;
    res.label = 'Playing the board';
  } else if (cat >= CATEGORY.FULL_HOUSE) {
    res.tier = TIER.MONSTER;
    res.label = cat === CATEGORY.FULL_HOUSE ? 'Full house' : cat === CATEGORY.QUADS ? 'Quads' : 'Straight flush';
    if (boardCat >= CATEGORY.FULL_HOUSE && cat === boardCat) { res.tier = TIER.TWO_PAIR; res.label = 'Full house (mostly on board)'; }
  } else if (cat === CATEGORY.FLUSH || cat === CATEGORY.STRAIGHT) {
    res.tier = TIER.STRAIGHT_FLUSH_DRAWN;
    res.label = cat === CATEGORY.FLUSH ? 'Flush' : 'Straight';
  } else if (cat === CATEGORY.TRIPS) {
    if (pocketPair && countOnBoard(h[0]) === 1) { res.tier = TIER.SET; res.label = 'Set'; }
    else if (boardCat === CATEGORY.TRIPS) { res.tier = TIER.AIR; res.label = 'Trips on board'; }
    else { res.tier = TIER.SET; res.label = 'Trips'; }
  } else if (cat === CATEGORY.TWO_PAIR) {
    const hitsBoth = !pocketPair && countOnBoard(h[0]) >= 1 && countOnBoard(h[1]) >= 1;
    if (hitsBoth) { res.tier = TIER.TWO_PAIR; res.label = 'Two pair'; }
    else if (boardCat === CATEGORY.TWO_PAIR) { res.tier = TIER.AIR; res.label = 'Two pair on board'; }
    else classifyOnePair(res, h, b, top, countOnBoard, pocketPair, true);
  } else if (cat === CATEGORY.PAIR) {
    if (boardCat === CATEGORY.PAIR) { res.tier = TIER.AIR; res.label = `${RANK_NAMES[h[0]]}-high (paired board)`; }
    else classifyOnePair(res, h, b, top, countOnBoard, pocketPair, false);
  } else {
    res.label = `${RANK_NAMES[h[0]]}-high`;
  }

  // ---- draws (only meaningful before the river)
  if (board.length < 5 && cat < CATEGORY.STRAIGHT) {
    const suitCount = [0, 0, 0, 0];
    for (const c of all) suitCount[cardSuit(c)]++;
    for (let s = 0; s < 4; s++) {
      const heroHas = hole.filter((c) => cardSuit(c) === s);
      if (heroHas.length === 0) continue;
      if (suitCount[s] === 4) {
        res.flushDraw = true;
        if (heroHas.some((c) => cardRank(c) === 12)) res.nutFlushDraw = true;
      } else if (suitCount[s] === 3 && board.length === 3 && heroHas.length === 2) res.backdoorFlush = true;
    }
    const allMask = mask(all.map(cardRank));
    const boardMask = mask(b);
    let completing = 0;
    for (let r = 0; r < 13; r++) {
      if (allMask & (1 << r)) continue;
      if (makesStraight(allMask | (1 << r)) && !makesStraight(boardMask | (1 << r))) completing++;
    }
    if (completing >= 2) res.oesd = true;
    else if (completing === 1) res.gutshot = true;
  }
  if (cat === CATEGORY.HIGH_CARD || res.tier === TIER.AIR) res.overcards = h[1] > top;

  res.drawStrength =
    (res.flushDraw && (res.oesd || res.gutshot)) || (res.oesd && res.tier >= TIER.MIDDLE_PAIR) ? 3
      : res.flushDraw || res.oesd ? 2
        : res.gutshot || res.overcards || res.backdoorFlush ? 1 : 0;
  const draws = [];
  if (res.flushDraw) draws.push(res.nutFlushDraw ? 'nut flush draw' : 'flush draw');
  if (res.oesd) draws.push('open-ended straight draw');
  else if (res.gutshot) draws.push('gutshot');
  if (res.overcards && !res.flushDraw && !res.oesd) draws.push('two overcards');
  if (res.backdoorFlush && !res.flushDraw) draws.push('backdoor flush draw');
  res.drawLabel = draws.join(' + ');
  return res;
}

function classifyOnePair(res, h, b, top, countOnBoard, pocketPair, boardAlsoPaired) {
  const distinctBoard = [...new Set(b)];
  if (pocketPair) {
    const r = h[0];
    if (r > top) { res.tier = TIER.TOP_PAIR_GOOD; res.label = 'Overpair'; }
    else if (r > (distinctBoard[1] ?? -1)) { res.tier = TIER.MIDDLE_PAIR; res.label = 'Pocket pair below top card'; }
    else { res.tier = TIER.WEAK_PAIR; res.label = 'Underpair'; }
    return;
  }
  const paired = countOnBoard(h[0]) ? h[0] : h[1];
  const kicker = paired === h[0] ? h[1] : h[0];
  if (paired === top) {
    const good = kicker >= 9 || (kicker >= 8 && top === 12); // J+ kicker (T+ with an ace)
    res.tier = good ? TIER.TOP_PAIR_GOOD : TIER.TOP_PAIR_WEAK;
    res.label = `Top pair, ${good ? 'good' : 'weak'} kicker`;
  } else if (paired === distinctBoard[1]) {
    res.tier = TIER.MIDDLE_PAIR;
    res.label = 'Middle pair';
  } else {
    res.tier = TIER.WEAK_PAIR;
    res.label = paired === distinctBoard[distinctBoard.length - 1] ? 'Bottom pair' : 'Third pair';
  }
  if (boardAlsoPaired) res.label += ' (paired board)';
}

/** Board texture summary used in explanations and drills. */
export function boardTexture(board) {
  if (board.length < 3) return { label: '', wet: 0 };
  const suits = [0, 0, 0, 0];
  for (const c of board) suits[cardSuit(c)]++;
  const maxSuit = Math.max(...suits);
  const ranks = [...new Set(board.map(cardRank))].sort((a, b) => a - b);
  let connected = 0;
  for (let i = 1; i < ranks.length; i++) if (ranks[i] - ranks[i - 1] <= 2) connected++;
  const paired = ranks.length < board.length;
  const parts = [];
  if (board.length === 3) parts.push(maxSuit === 3 ? 'monotone' : maxSuit === 2 ? 'two-tone' : 'rainbow');
  else if (maxSuit >= 3) parts.push(`${maxSuit === 3 ? 'three' : 'four'}-flush`);
  if (paired) parts.push('paired');
  if (connected >= 2) parts.push('connected');
  const wet = (maxSuit >= 2 ? 1 : 0) + (maxSuit >= 3 ? 1 : 0) + connected;
  if (!paired && connected === 0 && maxSuit === 1) parts.push('dry');
  return { label: parts.join(', '), wet, monotone: maxSuit >= 3, paired };
}
