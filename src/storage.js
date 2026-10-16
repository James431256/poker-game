/**
 * storage.js — persistence of progress, stats and settings in localStorage.
 *
 * Everything lives under one versioned key. Reads/writes are wrapped in
 * try/catch so the app still works in private mode or when storage is full
 * (hand histories are trimmed first if a quota error occurs).
 */
import { emptyTotals } from './stats.js';

const KEY = 'pokerTrainer.v1';
const MAX_HISTORY = 150;

export function defaultState() {
  return {
    version: 1,
    settings: {
      coachVisible: true,
      speed: 'normal', // slow | normal | fast
      autoNext: false,
      showLessons: true,
      soundless: true,
    },
    level: 1,
    unlockedLevel: 1,
    hero: emptyTotals(),
    bots: {}, // botId -> totals observed while the player was at the table
    mistakeLog: [], // newest first
    histories: [], // newest first
    lessonsSeen: {}, // tag -> times shown
    trainer: { attempts: 0, correct: 0, byScenario: {}, bestStreak: 0 },
    drills: { attempts: 0, correct: 0, points: 0, bestStreak: 0 },
    quiz: { attempts: 0, correct: 0, bestStreak: 0 },
    session: { startedAt: Date.now() },
  };
}

function storage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Load saved state merged over defaults (so new fields get defaults). */
export function loadState() {
  const def = defaultState();
  const ls = storage();
  if (!ls) return def;
  try {
    const raw = ls.getItem(KEY);
    if (!raw) return def;
    const saved = JSON.parse(raw);
    return deepMerge(def, saved);
  } catch {
    return def;
  }
}

function deepMerge(base, over) {
  if (Array.isArray(base) || Array.isArray(over)) return over ?? base;
  if (typeof base !== 'object' || base === null) return over ?? base;
  const out = { ...base };
  for (const k of Object.keys(over ?? {})) {
    out[k] = k in base ? deepMerge(base[k], over[k]) : over[k];
  }
  return out;
}

/** Save state; trims hand histories if the browser storage quota is hit. */
export function saveState(state) {
  const ls = storage();
  if (!ls) return false;
  state.histories = state.histories.slice(0, MAX_HISTORY);
  state.mistakeLog = state.mistakeLog.slice(0, 300);
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      ls.setItem(KEY, JSON.stringify(state));
      return true;
    } catch {
      state.histories = state.histories.slice(0, Math.floor(state.histories.length / 2));
    }
  }
  return false;
}

export function resetState() {
  const ls = storage();
  try {
    ls?.removeItem(KEY);
  } catch {
    /* ignore */
  }
  return defaultState();
}
