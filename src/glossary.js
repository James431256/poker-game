/**
 * glossary.js — poker terms shown as hover/tap tooltips (any element with
 * data-term="key") and on the Glossary page.
 */
export const GLOSSARY = {
  equity: {
    term: 'Equity',
    def: 'Your share of the pot if all cards were dealt out right now — the % of the time you would win (plus half your ties). 40% equity in a 100bb pot is "worth" 40bb.',
  },
  'pot-odds': {
    term: 'Pot odds',
    def: 'The price you are getting on a call: call ÷ (pot + call). Calling 25 into a pot of 75 (after their bet) needs 25 ÷ 100 = 25% equity to break even.',
  },
  'implied-odds': {
    term: 'Implied odds',
    def: 'Extra money you expect to win on later streets when you hit your draw. They let you call with slightly less equity than the pot odds demand — if stacks are deep and your hit is well hidden.',
  },
  'reverse-implied-odds': {
    term: 'Reverse implied odds',
    def: 'Money you lose on later streets when you make a second-best hand (e.g. a weak flush or top pair, bad kicker).',
  },
  range: {
    term: 'Range',
    def: 'All the hands a player could have in a given spot, given their position and actions. Good players think "what is my opponent\'s range?" not "what exact hand do they have?"',
  },
  spr: {
    term: 'SPR (stack-to-pot ratio)',
    def: 'Effective stack ÷ pot on the flop. Low SPR (<4) means top pair is often good enough to get all-in; high SPR (>10) rewards strong hands and draws with implied odds.',
  },
  outs: {
    term: 'Outs',
    def: 'Unseen cards that improve your hand to one that is likely best. A flush draw has 9 outs; an open-ended straight draw 8; a gutshot 4.',
  },
  'rule-of-2-and-4': {
    term: 'Rule of 2 and 4',
    def: 'Quick equity estimate for draws: on the flop (two cards to come) outs × 4; on the turn outs × 2. 9 outs on the flop ≈ 36%; on the turn ≈ 18%.',
  },
  ev: {
    term: 'EV (expected value)',
    def: 'The average amount a decision wins or loses if repeated many times. Good decisions have the highest EV, even when they lose this time.',
  },
  'fold-equity': {
    term: 'Fold equity',
    def: 'The extra value a bet gains from making opponents fold. A semi-bluff wins either by getting folds now or by hitting later.',
  },
  vpip: {
    term: 'VPIP',
    def: '"Voluntarily put money in pot" — % of hands you call or raise preflop (posting blinds doesn\'t count). Winning 6-max players: ~20–27%.',
  },
  pfr: {
    term: 'PFR',
    def: 'Preflop raise % — how often you raise before the flop. Should be close to VPIP (within ~5 points) for a strong, aggressive style.',
  },
  af: {
    term: 'Aggression factor (AF)',
    def: '(Bets + raises) ÷ calls after the flop. Below 1 = passive, 2–4 = healthy aggressive, much higher can mean you are bluffing too much.',
  },
  'bb-100': {
    term: 'bb/100',
    def: 'Win rate in big blinds per 100 hands. +5bb/100 is a solid winner in online 6-max cash games.',
  },
  cbet: {
    term: 'C-bet (continuation bet)',
    def: 'A flop bet by the player who made the last preflop raise, continuing their aggression whether they hit or not.',
  },
  '3bet': {
    term: '3-bet',
    def: 'The first re-raise preflop (the blinds count as the first "bet", the open is the second). A 4-bet re-raises a 3-bet.',
  },
  rfi: {
    term: 'RFI (raise first in)',
    def: 'Opening the pot with a raise when everyone before you has folded. Your RFI range widens the closer you are to the button.',
  },
  position: {
    term: 'Position',
    def: 'Acting after your opponent ("in position", IP) is a big advantage: you see what they do before deciding. UTG → HJ → CO → BTN are the positions from earliest to latest; the BTN is always last postflop.',
  },
  'value-bet': {
    term: 'Value bet',
    def: 'A bet made hoping to get called by worse hands. If worse hands can\'t call, it isn\'t a value bet.',
  },
  bluff: {
    term: 'Bluff',
    def: 'A bet with a hand that will usually lose if called, hoping better hands fold. A bluff with a draw is a semi-bluff.',
  },
  'semi-bluff': {
    term: 'Semi-bluff',
    def: 'Betting or raising with a draw: you win if they fold now, and you can still win if called and you hit.',
  },
  'pot-control': {
    term: 'Pot control',
    def: 'Checking or calling with a medium-strength hand to keep the pot small, because it can win a small pot but rarely a big one.',
  },
  kicker: {
    term: 'Kicker',
    def: 'The side card that breaks ties between hands of the same type. AK and AQ on an A-7-2 board both have top pair — AK has the better kicker.',
  },
  'side-pot': {
    term: 'Side pot',
    def: 'When a player is all-in for less, the extra bets from the others form a separate pot the all-in player cannot win.',
  },
  'calling-station': {
    term: 'Calling station',
    def: 'A player who calls far too often and rarely raises or folds. Exploit: value-bet thinner and almost never bluff.',
  },
  nit: {
    term: 'Nit / rock',
    def: 'A very tight, mostly passive player. Steal their blinds and fold to their big bets.',
  },
  lag: {
    term: 'LAG (loose-aggressive)',
    def: 'Plays many hands aggressively. Tough when good; exploit by calling down a little lighter and trapping strong hands.',
  },
  tag: {
    term: 'TAG (tight-aggressive)',
    def: 'Plays a selective range but plays it aggressively — the standard winning style.',
  },
  'blocker': {
    term: 'Blocker',
    def: 'A card in your hand that removes combinations from the opponent\'s range — e.g. holding the A♠ means they cannot have the nut spade flush.',
  },
  wtsd: {
    term: 'WTSD',
    def: 'Went to showdown — % of hands where you saw the flop and reached showdown. Much above ~30% often means calling down too lightly.',
  },
};
