/**
 * session.js — glue between the engine, bots, coach, grading, stats,
 * lessons, progression and storage. Contains no DOM code so the UI layer
 * stays thin (and the whole loop can be exercised headlessly).
 */
import { Game } from './engine.js';
import { BOT_PROFILES, profileById, decideBot, exploitsFor } from './bots.js';
import { getAdvice, gradeDecision } from './coach.js';
import { analyzeHandFor, accumulate, emptyTotals, classifyStyle } from './stats.js';
import { computeUnlocked } from './progression.js';
import { shouldShowLesson } from './lessons.js';
import { saveState } from './storage.js';
import { cardsToString, createRng } from './deck.js';
import { distanceFromRange } from './ranges.js';

export const HERO_SEAT = 0;
export const STYLE_REVEAL_HANDS = 30;

export class Session {
  constructor(state, { rng = createRng(), persist = true } = {}) {
    this.state = state;
    this.rng = rng;
    this.persist = persist;
    this.game = new Game({
      players: [
        { name: 'You', isHuman: true },
        ...BOT_PROFILES.map((p) => ({ name: p.name, botId: p.id })),
      ],
      rng,
    });
    this.decisions = [];
    this.currentAdvice = null;
  }

  get level() {
    return this.state.level;
  }

  setLevel(level) {
    if (level >= 1 && level <= this.state.unlockedLevel) {
      this.state.level = level;
      this.save();
    }
  }

  save() {
    if (this.persist) saveState(this.state);
  }

  startHand() {
    this.decisions = [];
    this.currentAdvice = null;
    this.game.startHand();
  }

  get isHumanTurn() {
    const g = this.game;
    return !g.handOver && g.toAct === HERO_SEAT;
  }

  /** Observed stats + revealed style for a seat (what a player could know). */
  opponentInfo(seat) {
    const p = this.game.players[seat];
    if (p.isHuman) {
      const style = classifyStyle(this.state.hero, STYLE_REVEAL_HANDS);
      return { observed: this.state.hero, style: style?.key };
    }
    const observed = this.state.bots[p.botId];
    const style = classifyStyle(observed, STYLE_REVEAL_HANDS);
    return { observed, style: style?.key };
  }

  /** Tendency label for the table UI once enough hands have been seen. */
  botLabel(seat) {
    const p = this.game.players[seat];
    const observed = this.state.bots[p.botId];
    const seen = observed?.hands ?? 0;
    const style = classifyStyle(observed, STYLE_REVEAL_HANDS);
    return { seen, needed: STYLE_REVEAL_HANDS, style };
  }

  /** Coach advice for the human's current decision (cached per decision). */
  advice({ iterations = 1500 } = {}) {
    if (!this.isHumanTurn) return null;
    const key = this.game.history.actions.length;
    if (this.currentAdvice?.key === key) return this.currentAdvice.advice;
    const advice = getAdvice(this.game, HERO_SEAT, {
      iterations,
      opponentInfo: (s) => this.opponentInfo(s),
    });
    this.currentAdvice = { key, advice };
    return advice;
  }

  /** Apply the human's action; the advice snapshot is kept for grading. */
  humanAct(action) {
    const advice = this.advice({ iterations: 900 });
    const record = this.game.act(action);
    this.decisions.push({ advice, record, actionIndex: this.game.history.actions.length - 1 });
    this.currentAdvice = null;
    return record;
  }

  /** Let the bot to act decide and act. */
  botAct() {
    const g = this.game;
    const p = g.players[g.toAct];
    const profile = profileById(p.botId);
    const decision = decideBot(g, p.seat, profile, {
      level: this.state.level,
      exploit: exploitsFor(this.state.hero, this.state.level),
      rng: this.rng,
      opponentInfo: (s) => this.opponentInfo(s),
    });
    return g.act(decision);
  }

  /**
   * Grade the hand, update stats, mistake log, lessons and progression, and
   * persist. Call once when game.handOver becomes true.
   */
  finishHand() {
    const g = this.game;
    const h = g.history;
    const s = this.state;
    const graded = [];
    const lessons = [];

    for (const d of this.decisions) {
      const res = gradeDecision(d.advice, d.record, g);
      // Folding junk preflop is "correct" but trivial; don't let it inflate accuracy.
      const pf = d.advice.preflop;
      res.trivial = !!pf && res.grade === 'good' && (d.record.type === 'fold' || d.record.type === 'check')
        && (pf.action === 'fold' || pf.action === 'check')
        && distanceFromRange(new Set([...pf.chart.raise, ...pf.chart.call]), pf.cls) > 0.12;
      res.actionIndex = d.actionIndex;
      res.equity = d.advice.equity;
      res.potOdds = d.advice.potOdds;
      res.recommendation = d.advice.recommendation;
      graded.push(res);

      if (!res.trivial) s.hero.grades[res.grade]++;
      s.hero.evLossBB += res.evLoss;
      if (res.grade === 'mistake' || (res.grade === 'marginal' && res.evLoss >= 0.5)) {
        if (res.tag) {
          s.hero.mistakeTags[res.tag] = (s.hero.mistakeTags[res.tag] ?? 0) + 1;
          if (s.settings.showLessons && shouldShowLesson(s.hero.mistakeTags[res.tag])) lessons.push(res.tag);
        }
        s.mistakeLog.unshift({
          time: Date.now(),
          handId: h.id,
          handNumber: h.handNumber,
          street: res.street,
          hole: cardsToString(g.players[HERO_SEAT].holeCards),
          board: cardsToString(d.advice.board),
          position: d.advice.position,
          grade: res.grade,
          evLoss: Math.round(res.evLoss * 10) / 10,
          tag: res.tag,
          explanation: res.explanation,
        });
      }
    }
    h.decisions = graded;

    // Stats for the hero and for every bot (observed tendencies).
    for (const p of g.players) {
      const flags = analyzeHandFor(h, p.seat);
      const pos = g.positionOf(p.seat);
      if (p.isHuman) accumulate(s.hero, flags, pos);
      else accumulate((s.bots[p.botId] ??= emptyTotals()), flags, pos);
    }
    s.bots = Object.fromEntries(Object.entries(s.bots).map(([k, v]) => [k, { ...v, recentNet: [] }]));

    // Compact history (frames are kept for replay).
    s.histories.unshift(h);

    const before = s.unlockedLevel;
    s.unlockedLevel = Math.max(s.unlockedLevel, computeUnlocked(s.hero));
    const unlockedNew = s.unlockedLevel > before ? s.unlockedLevel : null;

    this.save();
    return {
      graded,
      net: g.result.net[HERO_SEAT] / g.bb,
      lessons: [...new Set(lessons)],
      unlockedNew,
    };
  }
}
