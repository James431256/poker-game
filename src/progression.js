/**
 * progression.js — table levels and unlock rules.
 *
 * Bots get smarter at higher levels (fewer random errors, more range reading,
 * exploiting your measured leaks from level 3). Levels unlock as your volume
 * and decision accuracy improve.
 */
import { derive } from './stats.js';

export const LEVELS = [
  { level: 1, name: 'Beginner\'s Table', blurb: 'Bots make frequent mistakes. Learn the basics.', req: null },
  { level: 2, name: 'Local Casino', blurb: 'Fewer bot mistakes; the regulars read ranges more often.', req: { hands: 100, accuracy: 0.65 } },
  { level: 3, name: 'High Stakes Room', blurb: 'Bots start exploiting your leaks (e.g. bluffing if you over-fold).', req: { hands: 300, accuracy: 0.72 } },
  { level: 4, name: 'Pro Circuit', blurb: 'Near-error-free bots that read ranges and punish your tendencies.', req: { hands: 600, accuracy: 0.8, bb100: 0 } },
];

/** Check which levels the player has unlocked. Returns the highest unlocked level. */
export function computeUnlocked(heroTotals) {
  const d = derive(heroTotals);
  let unlocked = 1;
  for (const L of LEVELS) {
    if (!L.req) continue;
    const r = L.req;
    const ok = heroTotals.hands >= r.hands && (d.accuracy ?? 0) >= r.accuracy && (r.bb100 === undefined || (d.bb100 ?? -1) >= r.bb100);
    if (ok) unlocked = L.level;
    else break;
  }
  return unlocked;
}

/** Progress toward the next level, for the UI. */
export function nextLevelProgress(heroTotals, unlocked) {
  const next = LEVELS.find((L) => L.level === unlocked + 1);
  if (!next) return null;
  const d = derive(heroTotals);
  const r = next.req;
  const items = [
    { label: 'Hands played', have: heroTotals.hands, need: r.hands, done: heroTotals.hands >= r.hands, fmt: (x) => x },
    { label: 'Decision accuracy', have: d.accuracy ?? 0, need: r.accuracy, done: (d.accuracy ?? 0) >= r.accuracy, fmt: (x) => `${Math.round(x * 100)}%` },
  ];
  if (r.bb100 !== undefined) items.push({ label: 'Win rate (bb/100)', have: d.bb100 ?? 0, need: r.bb100, done: (d.bb100 ?? -1) >= r.bb100, fmt: (x) => x.toFixed(1) });
  return { next, items };
}
