/**
 * pots.js — main pot / side pot construction and awarding.
 *
 * Kept free of game-engine state so it can be unit tested in isolation.
 */

/**
 * Build pots from each player's total contribution to the hand.
 *
 * @param {Array<{id:number, amount:number, folded:boolean}>} contributions
 * @returns {Array<{amount:number, eligible:number[]}>} main pot first, then side pots.
 *
 * Algorithm: repeatedly peel off a layer equal to the smallest remaining
 * contribution among live (non-folded) players. Everyone — folded or not —
 * pays into that layer up to the layer size, but only live players with chips
 * in that layer are eligible to win it. Chips a folded player put in above the
 * last live layer go into the last pot. A layer with a single eligible player
 * is an uncalled bet and is simply returned to them when awarded.
 */
export function buildPots(contributions) {
  const remaining = contributions.map((c) => ({ ...c }));
  const pots = [];

  while (true) {
    const live = remaining.filter((c) => !c.folded && c.amount > 0);
    if (live.length === 0) break;
    const layer = Math.min(...live.map((c) => c.amount));
    let amount = 0;
    for (const c of remaining) {
      const take = Math.min(c.amount, layer);
      c.amount -= take;
      amount += take;
    }
    const eligible = live.map((c) => c.id).sort((a, b) => a - b);
    const prev = pots[pots.length - 1];
    // Merge layers with identical eligibility (e.g. folded players' odd amounts).
    if (prev && sameSet(prev.eligible, eligible)) prev.amount += amount;
    else pots.push({ amount, eligible });
  }

  // Dead money from folded players above every live layer.
  const leftover = remaining.reduce((s, c) => s + c.amount, 0);
  if (leftover > 0) {
    if (pots.length) pots[pots.length - 1].amount += leftover;
    else pots.push({ amount: leftover, eligible: [] });
  }
  return pots;
}

function sameSet(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * Award each pot to the best eligible hand(s).
 *
 * @param {Array<{amount:number, eligible:number[]}>} pots
 * @param {Map<number, number>|Object} scores  player id -> hand score (higher wins)
 * @param {number[]} oddChipOrder player ids in order starting left of the button;
 *        when a pot does not split evenly, the odd chips go to the winners
 *        earliest in this order (standard house rule).
 * @returns {{payouts: Object<number, number>, results: Array<{amount:number, winners:number[], eligible:number[]}>}}
 */
export function awardPots(pots, scores, oddChipOrder) {
  const get = (id) => (scores instanceof Map ? scores.get(id) : scores[id]);
  const payouts = {};
  const results = [];
  for (const pot of pots) {
    if (pot.eligible.length === 0 || pot.amount === 0) continue;
    let best = -Infinity;
    let winners = [];
    for (const id of pot.eligible) {
      const s = get(id) ?? -Infinity;
      if (s > best) { best = s; winners = [id]; }
      else if (s === best) winners.push(id);
    }
    winners.sort((a, b) => oddChipOrder.indexOf(a) - oddChipOrder.indexOf(b));
    const share = Math.floor(pot.amount / winners.length);
    let odd = pot.amount - share * winners.length;
    for (const id of winners) {
      const extra = odd > 0 ? 1 : 0;
      odd -= extra;
      payouts[id] = (payouts[id] ?? 0) + share + extra;
    }
    results.push({ amount: pot.amount, winners, eligible: pot.eligible });
  }
  return { payouts, results };
}
