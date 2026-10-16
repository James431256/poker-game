/**
 * stats.js — per-hand stat extraction, running totals, opponent style
 * classification and plain-English leak detection.
 *
 * The same analyser is used for the player (dashboard) and for every bot (so
 * the table can show an "observed tendencies" label once enough hands have
 * been seen).
 */

export function emptyTotals() {
  return {
    hands: 0, vpip: 0, pfr: 0,
    threeBetOpp: 0, threeBet: 0,
    foldTo3betOpp: 0, foldTo3bet: 0,
    cbetOpp: 0, cbet: 0,
    foldToCbetOpp: 0, foldToCbet: 0,
    riverFacedOpp: 0, riverFold: 0,
    postBets: 0, postCalls: 0, postFolds: 0,
    sawFlop: 0, wtsd: 0, wsd: 0,
    netBB: 0,
    byPosition: {},
    grades: { good: 0, marginal: 0, mistake: 0 },
    evLossBB: 0,
    mistakeTags: {},
    recentNet: [], // per-hand bb results for the win-rate graph (capped)
  };
}

/**
 * Extract boolean/number stat flags for one seat from a finished hand history.
 */
export function analyzeHandFor(history, seat) {
  const f = {
    vpip: false, pfr: false, threeBetOpp: false, threeBet: false,
    foldTo3betOpp: false, foldTo3bet: false, cbetOpp: false, cbet: false,
    foldToCbetOpp: false, foldToCbet: false, riverFacedOpp: false, riverFold: false,
    postBets: 0, postCalls: 0, postFolds: 0, sawFlop: false, wtsd: false, wsd: false, netBB: 0,
  };
  const acts = history.actions.filter((a) => a.type !== 'post');
  const bb = history.bigBlind;

  // ---- preflop
  let raises = 0;
  let opener = null;
  let pfa = null; // last preflop raiser
  let seatOpened = false;
  let facing3betPending = false;
  let firstVoluntary = true;
  let foldedPreflop = false;
  for (const a of acts.filter((x) => x.street === 'preflop')) {
    const isRaise = a.type === 'raise' || a.type === 'bet';
    if (a.seat === seat) {
      if (a.type === 'call' || isRaise) f.vpip = true;
      if (isRaise) f.pfr = true;
      if (firstVoluntary && raises === 1 && opener !== seat) {
        f.threeBetOpp = true;
        if (isRaise) f.threeBet = true;
      }
      firstVoluntary = false;
      if (facing3betPending) {
        f.foldTo3betOpp = true;
        if (a.type === 'fold') f.foldTo3bet = true;
        facing3betPending = false;
      }
      if (a.type === 'fold') foldedPreflop = true;
    }
    if (isRaise) {
      raises++;
      if (raises === 1) { opener = a.seat; if (a.seat === seat) seatOpened = true; }
      if (raises === 2 && seatOpened && a.seat !== seat) facing3betPending = true;
      pfa = a.seat;
    }
  }

  // ---- postflop
  const boardLen = history.board?.length ?? 0;
  // The board only gets dealt if the hand reached the flop (or ran out all-in).
  f.sawFlop = !foldedPreflop && boardLen >= 3;
  let flopBetSeen = false;
  let cbetMade = false;
  let respondedToCbet = false;
  let seatFirstFlop = true;
  let riverChecked = false;
  for (const a of acts.filter((x) => x.street !== 'preflop')) {
    const isRaise = a.type === 'raise' || a.type === 'bet';
    if (a.seat === seat) {
      if (isRaise) f.postBets++;
      else if (a.type === 'call') f.postCalls++;
      else if (a.type === 'fold') f.postFolds++;
      if (a.street === 'flop') {
        if (seatFirstFlop && pfa === seat && !flopBetSeen) {
          f.cbetOpp = true;
          if (a.type === 'bet') f.cbet = true;
        }
        if (cbetMade && !respondedToCbet && pfa !== seat) {
          f.foldToCbetOpp = true;
          if (a.type === 'fold') f.foldToCbet = true;
          respondedToCbet = true;
        }
        seatFirstFlop = false;
      }
      if (a.street === 'river' && a.toCall > 0 && !riverChecked) {
        f.riverFacedOpp = true;
        if (a.type === 'fold') f.riverFold = true;
        riverChecked = true;
      }
    }
    if (a.street === 'flop' && isRaise) {
      if (!flopBetSeen && a.seat === pfa) cbetMade = true;
      flopBetSeen = true;
    }
  }

  const r = history.result;
  if (r) {
    f.netBB = (r.net[seat] ?? 0) / bb;
    if (r.showdown && r.shown && r.shown[seat]) {
      f.wtsd = true;
      f.wsd = f.netBB > 0;
    }
  }
  return f;
}

/** Fold one hand's flags into running totals. */
export function accumulate(t, flags, position) {
  t.hands++;
  for (const k of ['vpip', 'pfr', 'threeBetOpp', 'threeBet', 'foldTo3betOpp', 'foldTo3bet', 'cbetOpp', 'cbet',
    'foldToCbetOpp', 'foldToCbet', 'riverFacedOpp', 'riverFold', 'sawFlop', 'wtsd', 'wsd']) {
    if (flags[k]) t[k]++;
  }
  t.postBets += flags.postBets;
  t.postCalls += flags.postCalls;
  t.postFolds += flags.postFolds;
  t.netBB += flags.netBB;
  if (position) {
    const p = (t.byPosition[position] ??= { hands: 0, vpip: 0, pfr: 0, netBB: 0 });
    p.hands++;
    if (flags.vpip) p.vpip++;
    if (flags.pfr) p.pfr++;
    p.netBB += flags.netBB;
  }
  if (t.recentNet) {
    t.recentNet.push(Math.round(flags.netBB * 10) / 10);
    if (t.recentNet.length > 1000) t.recentNet.shift();
  }
  return t;
}

const ratio = (a, b) => (b > 0 ? a / b : null);

/** Derived percentages (null when there is no sample). */
export function derive(t) {
  return {
    hands: t.hands,
    vpip: ratio(t.vpip, t.hands),
    pfr: ratio(t.pfr, t.hands),
    threeBet: ratio(t.threeBet, t.threeBetOpp),
    foldTo3bet: ratio(t.foldTo3bet, t.foldTo3betOpp),
    cbet: ratio(t.cbet, t.cbetOpp),
    foldToCbet: ratio(t.foldToCbet, t.foldToCbetOpp),
    riverFold: ratio(t.riverFold, t.riverFacedOpp),
    af: t.postCalls > 0 ? t.postBets / t.postCalls : t.postBets > 0 ? Infinity : null,
    wtsd: ratio(t.wtsd, t.sawFlop),
    wsd: ratio(t.wsd, t.wtsd),
    bb100: t.hands > 0 ? (t.netBB / t.hands) * 100 : null,
    accuracy: ratio(t.grades?.good ?? 0, (t.grades?.good ?? 0) + (t.grades?.marginal ?? 0) + (t.grades?.mistake ?? 0)),
  };
}

/**
 * Classify a player's style from observed stats.
 * @returns {{key:string, label:string, short:string}|null}
 */
export function classifyStyle(t, minHands = 25) {
  if (!t || t.hands < minHands) return null;
  const d = derive(t);
  const vpip = d.vpip * 100;
  const pfr = d.pfr * 100;
  const af = d.af ?? 1;
  let key;
  if (vpip >= 45 && pfr >= 28) key = 'maniac';
  else if (vpip >= 35 && pfr < 15) key = 'station';
  else if (vpip >= 26 && pfr >= 18) key = 'lag';
  else if (vpip < 18 && (pfr < 11 || af < 1.2)) key = 'rock';
  else if (vpip < 30 && pfr >= 12) key = 'reg';
  else key = vpip >= 30 ? 'station' : 'rock';
  const names = {
    maniac: 'Maniac', station: 'Calling station', lag: 'Loose-aggressive', rock: 'Tight-passive', reg: 'Solid regular',
  };
  return { key, label: names[key], short: `${Math.round(vpip)}/${Math.round(pfr)} AF ${af === Infinity ? '∞' : af.toFixed(1)}` };
}

/**
 * Leak detection: compare the player's stats with healthy 6-max ranges and
 * return plain-English advice, most important first.
 */
export function detectLeaks(t) {
  const d = derive(t);
  const leaks = [];
  const add = (id, severity, title, advice, stat) => leaks.push({ id, severity, title, advice, stat });
  const P = (x) => `${Math.round(x * 100)}%`;

  if (t.hands >= 30) {
    if (d.vpip > 0.32) add('vpip-high', 3, 'You play too many hands', `Your VPIP is ${P(d.vpip)}; winning 6-max players are usually around 20–27%. Fold more weak offsuit hands, especially from early position.`, 'VPIP');
    if (d.vpip < 0.15) add('vpip-low', 2, 'You play too few hands', `Your VPIP is only ${P(d.vpip)}. Opponents will just fold when you bet. Open wider from the CO, BTN and SB.`, 'VPIP');
    if (d.vpip - d.pfr > 0.12) add('vpip-pfr-gap', 2, 'You call too much preflop', `There is a ${Math.round((d.vpip - d.pfr) * 100)}-point gap between VPIP (${P(d.vpip)}) and PFR (${P(d.pfr)}). Limping and flat-calling hands that should be raised or folded loses money — "raise or fold" is a good default.`, 'VPIP−PFR');
  }
  if (t.postBets + t.postCalls >= 20 && d.af !== null) {
    if (d.af < 1) add('af-low', 3, 'You are too passive after the flop', `Aggression factor ${d.af.toFixed(2)} — you call far more than you bet or raise. Bet your strong hands and good draws instead of calling; the bettor wins pots the caller can't.`, 'AF');
    if (d.af > 4.5) add('af-high', 1, 'You may be over-aggressive', `Aggression factor ${d.af.toFixed(1)}. Lots of aggression is fine, but make sure your bluffs have equity (draws) and that you are not barrelling into calling stations.`, 'AF');
  }
  if (t.riverFacedOpp >= 8) {
    if (d.riverFold > 0.62) add('river-overfold', (t.mistakeTags?.['river-overfold'] ?? 0) >= 2 ? 3 : 2, 'You fold too often to river bets', `You fold ${P(d.riverFold)} of the time when facing a river bet. Against a half-pot bet you only need to win 25% to call — opponents can bluff you profitably with any two cards.`, 'Fold to river bet');
    if (d.riverFold < 0.2) add('river-overcall', 2, 'You call river bets too loosely', `You fold only ${P(d.riverFold)} on the river. Most players under-bluff big river bets — fold your bluff-catchers more often, especially against tight players.`, 'Fold to river bet');
  }
  if (t.foldTo3betOpp >= 6) {
    if (d.foldTo3bet > 0.7) add('fold-3bet-high', 2, 'You fold too much to 3-bets', `You fold ${P(d.foldTo3bet)} to 3-bets. Opponents can 3-bet you with any two. Defend more with suited broadways, pairs and suited aces.`, 'Fold to 3-bet');
    if (d.foldTo3bet < 0.3) add('fold-3bet-low', 1, 'You continue too often vs 3-bets', `You only fold ${P(d.foldTo3bet)} vs 3-bets; dominated hands like KJo or ATo lose a lot of money in 3-bet pots.`, 'Fold to 3-bet');
  }
  if (t.cbetOpp >= 8) {
    if (d.cbet > 0.85) add('cbet-high', 1, 'You c-bet almost every flop', `You c-bet ${P(d.cbet)}. Check more on wet boards and multiway pots where your range doesn't have the advantage.`, 'C-bet');
    if (d.cbet < 0.4) add('cbet-low', 2, 'You miss too many c-bets', `You c-bet only ${P(d.cbet)}. As the preflop raiser you have the range advantage on most flops, especially dry, high-card ones — a small bet wins the pot often.`, 'C-bet');
  }
  if (t.foldToCbetOpp >= 8 && d.foldToCbet > 0.65) add('fold-cbet-high', 2, 'You fold to c-bets too often', `You fold ${P(d.foldToCbet)} vs flop c-bets. Small c-bets need you to defend often — continue with any pair, draws and good overcards.`, 'Fold to c-bet');
  if (t.sawFlop >= 20 && t.wtsd >= 10 && d.wtsd > 0.38 && d.wsd < 0.5) add('wtsd-high', 2, 'You call down too often and lose', `You reach showdown ${P(d.wtsd)} of the times you see a flop but win only ${P(d.wsd)} there. Fold more marginal hands on the turn and river when facing big bets.`, 'WTSD');
  if (t.wtsd >= 12 && d.wsd < 0.45 && !leaks.some((l) => l.id === 'wtsd-high')) add('wsd-low', 2, 'You lose too often at showdown', `You only win ${P(d.wsd)} at showdown — a sign you're calling down with second-best hands.`, 'W$SD');

  // Mistake tags from decision grading.
  const tagText = {
    'loose-call': ['Calling without the right price', 'Several of your calls lacked the pot odds. Compare the equity you need (call ÷ (pot + call)) with your real equity vs their range.'],
    overfold: ['Folding hands with enough equity', 'You folded hands that had the odds to continue. Check pot odds before folding.'],
    'river-overfold': ['Folding rivers you should call', 'You folded river bluff-catchers that had the right price.'],
    'missed-value': ['Missing value bets', 'You checked or called with strong hands that should bet or raise for value.'],
    'bad-bluff': ['Bluffing in bad spots', 'Your bluffs had low equity and little fold equity (multiway, against stations, or with no draw).'],
    'preflop-loose': ['Playing hands outside your range', 'You often play hands the chart folds. Drill the preflop trainer for your weakest position.'],
    'preflop-tight': ['Folding hands in your range', 'You fold hands the chart plays — you lose value, especially in late position and the blinds.'],
    'preflop-passive': ['Flat-calling hands you should raise', 'You limp or call with hands strong enough to raise.'],
  };
  const tags = Object.entries(t.mistakeTags ?? {}).sort((a, b) => b[1] - a[1]);
  for (const [tag, count] of tags.slice(0, 3)) {
    if (count >= 3 && tagText[tag] && !leaks.some((l) => l.id === tag)) {
      add(tag, 1 + Math.min(2, Math.floor(count / 5)), tagText[tag][0], `${tagText[tag][1]} (graded mistake ×${count})`, 'Decision grades');
    }
  }
  return leaks.sort((a, b) => b.severity - a.severity);
}
