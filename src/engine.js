/**
 * engine.js — no-limit hold'em cash game engine for a 6-max table.
 *
 * The engine is synchronous and UI-agnostic: callers start a hand, ask who
 * is to act, query legal actions and submit actions. It advances streets,
 * handles all-in run-outs, side pots and showdowns by itself, and records a
 * complete hand history (with replay frames) as it goes.
 *
 * Chips are integers: by default 1 big blind = 100 chips, so 0.5bb small
 * blinds and odd bet sizes never cause floating-point drift.
 */
import { makeDeck, shuffle, createRng, cardsToString } from './deck.js';
import { evaluate, describeScore } from './evaluator.js';
import { buildPots, awardPots } from './pots.js';

export const POSITIONS = ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'];
export const STREETS = ['preflop', 'flop', 'turn', 'river'];

export class Game {
  /**
   * @param {object} opts
   * @param {Array<{name:string,isHuman?:boolean,botId?:string}>} opts.players seat order
   * @param {number} [opts.bigBlind=100]
   * @param {number} [opts.startStackBB=100]
   * @param {boolean} [opts.autoTopUp=true] top stacks back up to the starting stack each hand
   * @param {function} [opts.rng]
   */
  constructor({ players, bigBlind = 100, startStackBB = 100, autoTopUp = true, rng = createRng() }) {
    this.bb = bigBlind;
    this.sb = bigBlind / 2;
    this.startStack = startStackBB * bigBlind;
    this.autoTopUp = autoTopUp;
    this.rng = rng;
    this.players = players.map((p, seat) => ({
      seat,
      name: p.name,
      isHuman: !!p.isHuman,
      botId: p.botId ?? null,
      stack: this.startStack,
      holeCards: [],
      folded: true,
      allIn: false,
      committed: 0, // chips put in on the current street
      total: 0, // chips put in this hand
      hasActed: false,
      lastActedRaiseId: -1,
      lastAction: null,
    }));
    this.n = this.players.length;
    this.button = this.n - 1; // first hand moves it to seat 0
    this.handNumber = 0;
    this.handOver = true;
  }

  // ---------------------------------------------------------------- helpers

  /** Position name of a seat relative to the button (6-max naming). */
  positionOf(seat) {
    const offset = (seat - this.button + this.n) % this.n;
    if (this.n === 6) return POSITIONS[offset];
    if (offset === 0) return 'BTN';
    if (offset === 1) return 'SB';
    if (offset === 2) return 'BB';
    return offset === this.n - 1 ? 'CO' : `MP${offset - 2}`;
  }

  seatAfter(seat, k = 1) {
    return (seat + k) % this.n;
  }

  /** Seats in clockwise order starting from `start` (inclusive). */
  orderFrom(start) {
    return Array.from({ length: this.n }, (_, i) => (start + i) % this.n);
  }

  get pot() {
    return this.players.reduce((s, p) => s + p.total, 0);
  }

  /** Pot not counting chips committed on the current street. */
  get potBeforeStreet() {
    return this.players.reduce((s, p) => s + p.total - p.committed, 0);
  }

  get livePlayers() {
    return this.players.filter((p) => !p.folded);
  }

  needsToAct(p) {
    return !p.folded && !p.allIn && (!p.hasActed || p.committed < this.currentBet);
  }

  // ------------------------------------------------------------- hand setup

  startHand() {
    this.handNumber++;
    this.button = this.seatAfter(this.button);
    this.street = 'preflop';
    this.board = [];
    this.deck = shuffle(makeDeck(), this.rng);
    this.deckPos = 0;
    this.currentBet = 0;
    this.lastRaiseSize = this.bb;
    this.raiseId = 0;
    this.lastAggressor = null;
    this.preflopAggressor = null;
    this.handOver = false;
    this.result = null;
    this.runout = false;
    this.log = [];

    for (const p of this.players) {
      if (this.autoTopUp && p.stack < this.startStack) {
        p.rebuy = this.startStack - p.stack;
        p.stack = this.startStack;
      } else p.rebuy = 0;
      Object.assign(p, {
        holeCards: [], folded: false, allIn: false, committed: 0, total: 0,
        hasActed: false, lastActedRaiseId: -1, lastAction: null,
      });
      p.startStack = p.stack;
    }

    // Deal two cards each, starting left of the button.
    for (let r = 0; r < 2; r++) {
      for (const seat of this.orderFrom(this.seatAfter(this.button))) {
        this.players[seat].holeCards.push(this.draw());
      }
    }

    this.history = {
      id: Date.now() + '-' + this.handNumber,
      handNumber: this.handNumber,
      time: Date.now(),
      bigBlind: this.bb,
      button: this.button,
      players: this.players.map((p) => ({
        seat: p.seat, name: p.name, isHuman: p.isHuman, botId: p.botId,
        position: this.positionOf(p.seat), startStack: p.startStack,
        holeCards: [...p.holeCards],
      })),
      actions: [],
      frames: [],
      board: [],
      result: null,
    };

    const sbSeat = this.seatAfter(this.button, 1);
    const bbSeat = this.seatAfter(this.button, 2);
    this.postBlind(sbSeat, this.sb, 'SB');
    this.postBlind(bbSeat, this.bb, 'BB');
    this.currentBet = this.bb;
    this.lastRaiseSize = this.bb;
    this.pushFrame(null, 'Blinds posted');

    this.toAct = this.findNextToAct(bbSeat);
    if (this.toAct === null) this.endBettingRound();
  }

  draw() {
    return this.deck[this.deckPos++];
  }

  postBlind(seat, amount, label) {
    const p = this.players[seat];
    const amt = Math.min(amount, p.stack);
    this.putChips(p, amt);
    p.lastAction = { type: 'post', amount: amt, label };
    this.history.actions.push({
      street: 'preflop', seat, type: 'post', amount: amt, to: p.committed,
      potBefore: this.pot - amt, label,
    });
    this.log.push(`${p.name} ${p.name === 'You' ? 'post' : 'posts'} ${label} ${this.fmt(amt)}`);
  }

  putChips(p, amt) {
    p.stack -= amt;
    p.committed += amt;
    p.total += amt;
    if (p.stack === 0) p.allIn = true;
  }

  /** Next seat after `from` that still needs to act this round, or null. */
  findNextToAct(from) {
    for (let i = 1; i <= this.n; i++) {
      const seat = (from + i) % this.n;
      if (this.needsToAct(this.players[seat])) return seat;
    }
    return null;
  }

  // ---------------------------------------------------------------- actions

  /**
   * Legal options for a seat. Raise amounts are "raise-to" totals for the
   * street (what the player's committed amount becomes).
   */
  legalActions(seat = this.toAct) {
    const p = this.players[seat];
    const toCall = Math.max(0, this.currentBet - p.committed);
    const callAmount = Math.min(toCall, p.stack);
    const maxTo = p.committed + p.stack;
    const othersCanAct = this.players.some((o) => o.seat !== seat && !o.folded && !o.allIn);
    const reopened = !p.hasActed || p.lastActedRaiseId !== this.raiseId;
    const canRaise = p.stack > toCall && othersCanAct && reopened;
    const minTo = Math.min(this.currentBet + this.lastRaiseSize, maxTo);
    return {
      toCall,
      callAmount,
      canFold: toCall > 0,
      canCheck: toCall === 0,
      canCall: toCall > 0,
      canRaise,
      isBet: this.currentBet === 0,
      minRaiseTo: canRaise ? minTo : null,
      maxRaiseTo: canRaise ? maxTo : null,
      pot: this.pot,
      stack: p.stack,
      committed: p.committed,
    };
  }

  /**
   * Apply an action for the seat to act.
   * @param {{type:'fold'|'check'|'call'|'bet'|'raise'|'allin', amount?:number}} action
   *        amount = raise-to total for bet/raise.
   */
  act(action) {
    if (this.handOver) throw new Error('Hand is over');
    const seat = this.toAct;
    const p = this.players[seat];
    const legal = this.legalActions(seat);
    const potBefore = this.pot;
    const toCallBefore = legal.toCall;
    let { type } = action;
    let added = 0;

    if (type === 'allin') {
      if (legal.canRaise) {
        type = 'raise';
        action = { ...action, amount: legal.maxRaiseTo };
      } else type = legal.canCall ? 'call' : 'check';
    }
    // Normalise illegal requests to the closest legal action.
    if ((type === 'bet' || type === 'raise') && !legal.canRaise) type = legal.canCall ? 'call' : 'check';
    if (type === 'check' && !legal.canCheck) type = 'fold';
    if (type === 'call' && !legal.canCall) type = 'check';
    if (type === 'fold' && legal.canCheck) type = 'check';

    switch (type) {
      case 'fold':
        p.folded = true;
        break;
      case 'check':
        break;
      case 'call':
        added = legal.callAmount;
        this.putChips(p, added);
        break;
      case 'bet':
      case 'raise': {
        const to = Math.max(legal.minRaiseTo, Math.min(legal.maxRaiseTo, Math.round(action.amount ?? legal.minRaiseTo)));
        added = to - p.committed;
        const increment = to - this.currentBet;
        this.putChips(p, added);
        if (increment >= this.lastRaiseSize) {
          // Full raise: re-opens the action for everyone.
          this.lastRaiseSize = increment;
          this.raiseId++;
        }
        this.currentBet = Math.max(this.currentBet, to);
        this.lastAggressor = seat;
        if (this.street === 'preflop') this.preflopAggressor = seat;
        type = legal.isBet ? 'bet' : 'raise';
        break;
      }
      default:
        throw new Error(`Unknown action ${type}`);
    }

    p.hasActed = true;
    p.lastActedRaiseId = this.raiseId;
    p.lastAction = { type, amount: added, to: p.committed, allIn: p.allIn };
    const record = {
      street: this.street, seat, type, amount: added, to: p.committed,
      potBefore, toCall: toCallBefore, stackBefore: p.stack + added,
      allIn: p.allIn, boardLen: this.board.length,
    };
    this.history.actions.push(record);
    this.log.push(this.describeAction(record));
    this.pushFrame(seat, this.describeAction(record));
    this.advance(seat);
    return record;
  }

  describeAction(a) {
    const p = this.players[a.seat];
    const name = p.name;
    // "You raise" for the human (named "You"), "Max raises" for everyone else.
    const v = (verb) => (name === 'You' ? verb : `${verb}s`);
    const allIn = a.allIn ? ' (all-in)' : '';
    switch (a.type) {
      case 'fold': return `${name} ${v('fold')}`;
      case 'check': return `${name} ${v('check')}`;
      case 'call': return `${name} ${v('call')} ${this.fmt(a.amount)}${allIn}`;
      case 'bet': return `${name} ${v('bet')} ${this.fmt(a.to)}${allIn}`;
      case 'raise': return `${name} ${name === 'You' ? 'raise' : 'raises'} to ${this.fmt(a.to)}${allIn}`;
      default: return `${name} ${a.type}`;
    }
  }

  fmt(chips) {
    const bb = chips / this.bb;
    return `${Number.isInteger(bb) ? bb : bb.toFixed(1)}bb`;
  }

  advance(lastSeat) {
    if (this.livePlayers.length === 1) return this.finishUncontested();
    const next = this.findNextToAct(lastSeat);
    if (next !== null) {
      this.toAct = next;
      return;
    }
    this.endBettingRound();
  }

  endBettingRound() {
    for (const p of this.players) {
      p.committed = 0;
      p.hasActed = false;
    }
    if (this.street === 'river') return this.showdown();

    const canAct = this.livePlayers.filter((p) => !p.allIn);
    if (canAct.length <= 1) {
      // Everyone (or all but one) is all-in: run out the board.
      this.runout = true;
      while (this.street !== 'river') this.dealNextStreet();
      return this.showdown();
    }

    this.dealNextStreet();
    this.toAct = this.findNextToAct(this.button);
    if (this.toAct === null) this.endBettingRound();
  }

  dealNextStreet() {
    const idx = STREETS.indexOf(this.street);
    this.street = STREETS[idx + 1];
    this.deckPos++; // burn
    const count = this.street === 'flop' ? 3 : 1;
    for (let i = 0; i < count; i++) this.board.push(this.draw());
    this.currentBet = 0;
    this.lastRaiseSize = this.bb;
    this.raiseId++;
    this.lastAggressor = null;
    for (const p of this.players) p.lastAction = null;
    const label = this.street[0].toUpperCase() + this.street.slice(1);
    this.log.push(`*** ${label}: ${cardsToString(this.board)} ***`);
    this.pushFrame(null, `${label}: ${cardsToString(this.board)}`);
  }

  finishUncontested() {
    const winner = this.livePlayers[0];
    const amount = this.pot;
    winner.stack += amount;
    this.log.push(`${winner.name} ${winner.name === 'You' ? 'win' : 'wins'} ${this.fmt(amount)} (uncontested)`);
    this.finish({
      showdown: false,
      winners: [{ seat: winner.seat, amount, hand: null }],
      shown: {},
    });
  }

  showdown() {
    this.street = 'showdown';
    const live = this.livePlayers;
    const scores = {};
    const shown = {};
    for (const p of live) {
      scores[p.seat] = evaluate([...p.holeCards, ...this.board]);
      shown[p.seat] = [...p.holeCards];
    }
    const pots = buildPots(this.players.map((p) => ({ id: p.seat, amount: p.total, folded: p.folded })));
    const order = this.orderFrom(this.seatAfter(this.button));
    const { payouts, results } = awardPots(pots, scores, order);
    const winners = [];
    for (const [seat, amount] of Object.entries(payouts)) {
      const s = Number(seat);
      this.players[s].stack += amount;
      // A pot with a single eligible player is just an uncalled bet coming back.
      winners.push({ seat: s, amount, hand: scores[s] !== undefined ? describeScore(scores[s]) : null });
    }
    for (const r of results) {
      const names = r.winners.map((s) => this.players[s].name).join(' & ');
      const desc = r.eligible.length > 1 ? ` with ${describeScore(scores[r.winners[0]])}` : ' (returned)';
      const verb = r.winners.length > 1 ? 'split' : names === 'You' ? 'win' : 'wins';
      this.log.push(`${names} ${verb} ${this.fmt(r.amount)}${desc}`);
    }
    this.finish({
      showdown: true,
      winners,
      shown,
      handNames: Object.fromEntries(Object.entries(scores).map(([s, sc]) => [s, describeScore(sc)])),
      pots: results,
    });
  }

  finish(result) {
    this.handOver = true;
    this.toAct = null;
    result.net = {};
    for (const p of this.players) result.net[p.seat] = p.stack - p.startStack;
    result.board = [...this.board];
    result.runout = this.runout;
    this.result = result;
    this.history.board = [...this.board];
    this.history.result = result;
    this.history.log = [...this.log];
    this.pushFrame(null, 'Hand complete');
  }

  /** Lightweight snapshot used for step-by-step replays. */
  pushFrame(actor, text) {
    this.history.frames.push({
      street: this.street,
      board: [...this.board],
      pot: this.pot,
      actor,
      text,
      actionIndex: this.history.actions.length - 1,
      players: this.players.map((p) => ({
        stack: p.stack, committed: p.committed, folded: p.folded,
        allIn: p.allIn, lastAction: p.lastAction ? { ...p.lastAction } : null,
      })),
    });
  }

  /** Check that no chips were created or destroyed (used by tests). */
  totalChips() {
    return this.players.reduce((s, p) => s + p.stack + (this.handOver ? 0 : p.total), 0);
  }
}
