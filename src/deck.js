/**
 * deck.js — card representation, parsing/formatting, shuffling and seeded RNG.
 *
 * Cards are small integers 0..51 so they are cheap to copy and compare:
 *   rank = card >> 2   (0 = deuce ... 12 = ace)
 *   suit = card & 3    (0 = clubs, 1 = diamonds, 2 = hearts, 3 = spades)
 */

export const RANKS = '23456789TJQKA';
export const SUITS = 'cdhs';
export const SUIT_SYMBOLS = ['♣', '♦', '♥', '♠'];
export const RANK_NAMES = ['Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King', 'Ace'];
export const RANK_PLURALS = ['Twos', 'Threes', 'Fours', 'Fives', 'Sixes', 'Sevens', 'Eights', 'Nines', 'Tens', 'Jacks', 'Queens', 'Kings', 'Aces'];

export const makeCard = (rank, suit) => (rank << 2) | suit;
export const cardRank = (card) => card >> 2;
export const cardSuit = (card) => card & 3;

/** "As" -> card int. Accepts "10s"/"Ts" and either case for the suit. */
export function parseCard(str) {
  const s = str.trim();
  const rankStr = s.length === 3 ? 'T' : s[0].toUpperCase();
  const r = RANKS.indexOf(rankStr);
  const u = SUITS.indexOf(s[s.length - 1].toLowerCase());
  if (r < 0 || u < 0) throw new Error(`Bad card: ${str}`);
  return makeCard(r, u);
}

/** Parse a space/comma separated list, e.g. "As Kd 7c". Also accepts "AsKd7c". */
export function parseCards(str) {
  const tokens = str.match(/(10|[2-9TJQKA])[cdhs]/gi) || [];
  return tokens.map(parseCard);
}

export const cardToString = (card) => RANKS[cardRank(card)] + SUITS[cardSuit(card)];
export const cardsToString = (cards) => cards.map(cardToString).join(' ');
/** Pretty form with suit symbol, e.g. "A♠". */
export const cardPretty = (card) => RANKS[cardRank(card)] + SUIT_SYMBOLS[cardSuit(card)];
export const cardsPretty = (cards) => cards.map(cardPretty).join(' ');

/** Fresh ordered 52-card deck. */
export function makeDeck() {
  const d = new Array(52);
  for (let i = 0; i < 52; i++) d[i] = i;
  return d;
}

/**
 * Mulberry32 — tiny, fast, seedable PRNG. Seeding makes tests and drills
 * reproducible; production play just uses a random seed.
 */
export function createRng(seed = (Math.random() * 2 ** 32) >>> 0) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** In-place Fisher–Yates shuffle. */
export function shuffle(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

/** Deck with the given dead cards removed (used by simulations and drills). */
export function deckWithout(dead) {
  const deadSet = new Set(dead);
  return makeDeck().filter((c) => !deadSet.has(c));
}
