/**
 * quiz.js — "quiz me" question generators for pot odds, outs and hand rankings.
 */
import { createRng, shuffle, makeDeck } from './deck.js';
import { evaluate, describeScore, scoreCategory, CATEGORY_NAMES } from './evaluator.js';
import { analyzeHand } from './analysis.js';
import { countOuts, ruleOf2and4 } from './equity.js';

export const QUIZ_TYPES = {
  potOdds: 'Pot odds',
  drawOdds: 'Outs → equity',
  outs: 'Counting outs',
  showdown: 'Who wins?',
  bestHand: 'Name the hand',
};

const pctLabel = (x) => `${Math.round(x * 100)}%`;

function shuffled(arr, rng) {
  return shuffle([...arr], rng);
}

/** Build distinct numeric options around the correct value. */
function numericOptions(correct, distractors, fmt, rng, minGap = 0.04) {
  const values = [correct];
  const opts = [{ label: fmt(correct), correct: true }];
  for (const d of distractors) {
    if (d > 0 && values.every((v) => Math.abs(v - d) >= minGap)) {
      values.push(d);
      opts.push({ label: fmt(d), correct: false });
    }
    if (opts.length === 4) break;
  }
  return shuffled(opts, rng);
}

export function makeQuiz({ type, rng = createRng() } = {}) {
  const types = Object.keys(QUIZ_TYPES);
  if (!type || type === 'mixed') type = types[Math.floor(rng() * types.length)];
  return GENERATORS[type](rng);
}

const GENERATORS = {
  potOdds(rng) {
    const pot = [4, 6, 8, 10, 12, 15, 20, 24, 30, 40][Math.floor(rng() * 10)];
    const frac = [0.25, 0.33, 0.5, 0.66, 0.75, 1, 1.5][Math.floor(rng() * 7)];
    const bet = Math.round(pot * frac * 2) / 2;
    const need = bet / (pot + 2 * bet);
    return {
      type: 'potOdds',
      prompt: `The pot is ${pot}bb. Your opponent bets ${bet}bb. What equity do you need to call?`,
      options: numericOptions(need, [bet / (pot + bet), bet / pot, need + 0.1, need - 0.08, need * 1.5], pctLabel, rng),
      explanation: `Needed equity = call ÷ (pot after your call) = ${bet} ÷ (${pot} + ${bet} + ${bet}) = ${pctLabel(need)}. Shortcut: a ${Math.round(frac * 100)}%-pot bet needs ${pctLabel(need)}.`,
    };
  },

  drawOdds(rng) {
    const draws = [
      [9, 'a flush draw'], [8, 'an open-ended straight draw'], [4, 'a gutshot'],
      [15, 'a flush draw + open-ender'], [12, 'a flush draw + gutshot'], [6, 'two overcards'],
    ];
    const [outs, name] = draws[Math.floor(rng() * draws.length)];
    const flop = rng() < 0.5;
    const ans = ruleOf2and4(outs, flop ? 2 : 1);
    return {
      type: 'drawOdds',
      prompt: `You have ${name} (${outs} outs) on the ${flop ? 'flop' : 'turn'}. Roughly how often will you hit by the river?`,
      options: numericOptions(ans, [ans * 0.5, ans * 1.6, ans + 0.12, ans - 0.1, ans + 0.2], pctLabel, rng),
      explanation: flop
        ? `Rule of 4 on the flop: ${outs} × 4 ${outs > 8 ? `− ${outs - 8} (correction above 8 outs) ` : ''}≈ ${pctLabel(ans)}. (Exact: ${pctLabel(1 - ((47 - outs) / 47) * ((46 - outs) / 46))}.)`
        : `Rule of 2 on the turn: ${outs} × 2 ≈ ${pctLabel(ans)}. (Exact: ${pctLabel(outs / 46)}.)`,
    };
  },

  outs(rng) {
    for (let attempt = 0; attempt < 500; attempt++) {
      const deck = shuffle(makeDeck(), rng);
      const hole = deck.slice(0, 2);
      const board = deck.slice(2, 5);
      const a = analyzeHand(hole, board);
      if (a.tier > 0 || a.drawStrength < 2 || a.overcards) continue;
      const o = countOuts(hole, board);
      if (!o || o.count < 4 || o.pairOuts > 0) continue;
      return {
        type: 'outs',
        prompt: `How many outs do you have to a straight or flush?`,
        hole,
        board,
        options: numericOptions(o.count, [o.count - 1, o.count + 1, o.count + 3, o.count - 4, o.count + 6], String, rng, 1),
        explanation: `You have ${a.drawLabel}: ${o.count} outs. Flush draw = 9 outs, open-ender = 8, gutshot = 4; combined draws don't double-count cards that complete both.`,
        outCards: o.cards,
      };
    }
    return GENERATORS.potOdds(rng);
  },

  showdown(rng) {
    for (let attempt = 0; attempt < 200; attempt++) {
      const deck = shuffle(makeDeck(), rng);
      const board = deck.slice(0, 5);
      const a = deck.slice(5, 7);
      const b = deck.slice(7, 9);
      const sa = evaluate([...a, ...board]);
      const sb = evaluate([...b, ...board]);
      // Prefer interesting spots: same category (kicker battles) or close categories.
      const close = Math.abs(scoreCategory(sa) - scoreCategory(sb)) <= 1;
      if (!close && rng() < 0.7) continue;
      const winner = sa > sb ? 0 : sb > sa ? 1 : 2;
      const opts = ['Player A', 'Player B', 'Split pot'].map((label, i) => ({ label, correct: i === winner }));
      return {
        type: 'showdown',
        prompt: 'Which hand wins at showdown?',
        board,
        handA: a,
        handB: b,
        options: opts,
        explanation: `Player A: ${describeScore(sa)}. Player B: ${describeScore(sb)}. ${winner === 2 ? 'Same best five cards — split pot.' : `Player ${winner === 0 ? 'A' : 'B'} wins.`}`,
      };
    }
    return GENERATORS.potOdds(rng);
  },

  bestHand(rng) {
    // Bias toward stronger categories so all hand types appear.
    let best = null;
    for (let i = 0; i < 6; i++) {
      const deck = shuffle(makeDeck(), rng);
      const hole = deck.slice(0, 2);
      const board = deck.slice(2, 7);
      const s = evaluate([...hole, ...board]);
      if (!best || (scoreCategory(s) > scoreCategory(best.s) && rng() < 0.8)) best = { hole, board, s };
    }
    const cat = scoreCategory(best.s);
    const names = CATEGORY_NAMES.map((n, i) => ({ n, i }));
    const others = shuffled(names.filter((x) => x.i !== cat && Math.abs(x.i - cat) <= 3), rng).slice(0, 3);
    const options = shuffled([{ label: CATEGORY_NAMES[cat], correct: true }, ...others.map((o) => ({ label: o.n, correct: false }))], rng);
    return {
      type: 'bestHand',
      prompt: 'What is your best five-card hand?',
      hole: best.hole,
      board: best.board,
      options,
      explanation: `${describeScore(best.s)}. Hand ranking (high → low): Straight Flush, Four of a Kind, Full House, Flush, Straight, Three of a Kind, Two Pair, Pair, High Card.`,
    };
  },
};

