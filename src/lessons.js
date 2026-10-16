/**
 * lessons.js — short lesson cards, keyed by the mistake tags produced by
 * decision grading. A card pops up when the same mistake keeps repeating.
 */
export const LESSONS = {
  'loose-call': {
    title: 'Calling needs the right price',
    body: 'Before calling, compare two numbers: the equity you need and the equity you have. Needed equity = call ÷ (pot + call). A half-pot bet needs 25%, a pot-sized bet 33%. Then ask: against the hands that bet like this, how often do I win?',
    tip: 'Most players under-bluff big bets. If your hand only beats a bluff, big bets are often a fold.',
    terms: ['pot-odds', 'equity', 'range'],
  },
  overfold: {
    title: 'Don\'t fold when the price is right',
    body: 'If your equity is higher than the pot odds, calling makes money in the long run — even if you lose this particular hand. Draws with 8–9 outs usually have the odds to call a half-pot bet on the flop.',
    tip: 'Rule of 2 and 4: outs × 4 on the flop, × 2 on the turn ≈ your equity %.',
    terms: ['outs', 'rule-of-2-and-4', 'pot-odds'],
  },
  'river-overfold': {
    title: 'Defending against river bets',
    body: 'On the river there are no more cards, so the math is pure: against a half-pot bet you need to win 25% of the time; against a pot-sized bet 33%. If you always fold your bluff-catchers, any opponent can bluff you with any two cards.',
    tip: 'Call more with hands that beat bluffs (e.g. top pair, good second pair), especially versus aggressive players.',
    terms: ['pot-odds', 'bluff'],
  },
  'missed-value': {
    title: 'Bet your strong hands',
    body: 'The biggest winners in poker come from getting paid with strong hands. When you are ahead of the hands that would call, bet or raise — don\'t let the opponent see free cards or keep the pot small.',
    tip: 'Ask: "If I bet, can worse hands call?" If yes, bet. Size up against calling stations.',
    terms: ['value-bet', 'calling-station'],
  },
  'missed-bluff': {
    title: 'Use fold equity with your draws',
    body: 'Strong draws are great hands to bet or raise with: you can win immediately when they fold, and you still have outs when called. Passive draws only win when they hit.',
    tip: 'Prefer semi-bluffs with flush draws and open-enders heads-up; check more multiway.',
    terms: ['semi-bluff', 'fold-equity'],
  },
  'bad-bluff': {
    title: 'Choose your bluffs carefully',
    body: 'Good bluffs have (1) few opponents, (2) an opponent who can fold, and (3) some equity if called. Bluffing calling stations or into several players rarely works.',
    tip: 'Bluff the tight players, value-bet the loose ones.',
    terms: ['bluff', 'fold-equity', 'calling-station'],
  },
  overaggressive: {
    title: 'Aggression with a purpose',
    body: 'Betting a medium-strength hand often folds out worse hands and gets called by better ones — the worst of both worlds. Medium hands usually prefer checking and calling (pot control).',
    tip: 'Bet the top (value) and the bottom (bluffs/draws) of your range; check the middle.',
    terms: ['pot-control', 'value-bet'],
  },
  sizing: {
    title: 'Bet sizing basics',
    body: 'Small bets (~1/3 pot) work on dry boards where opponents rarely have strong hands. Big bets (2/3–pot) are for wet boards, strong value hands and polarized bluffs.',
    tip: 'Size for the hands you want to call you.',
    terms: ['value-bet'],
  },
  'preflop-loose': {
    title: 'Tighten your starting hands',
    body: 'Most money is lost before the flop by playing weak hands from early position. From UTG, open roughly the top 18% of hands; from the button you can open nearly half.',
    tip: 'Weak offsuit hands like K8o, Q9o and J7o are the most common leaks — they make second-best pairs.',
    terms: ['rfi', 'position', 'vpip'],
  },
  'preflop-tight': {
    title: 'Open up in late position',
    body: 'From the cutoff, button and small blind, the fewer players left to act, the more often everyone folds — so more hands become profitable opens. Folding too much lets the blinds take the pot for free.',
    tip: 'Use the preflop trainer for CO and BTN until those ranges feel natural.',
    terms: ['rfi', 'position'],
  },
  'preflop-passive': {
    title: 'Raise or fold — avoid limping and flatting',
    body: 'Raising gives you two ways to win: everyone folds, or you take the initiative into the flop. Limping or calling with strong hands gives opponents cheap flops and makes you predictable.',
    tip: 'If a hand is good enough to play, it is usually good enough to raise.',
    terms: ['pfr', '3bet'],
  },
  'preflop-overaggressive': {
    title: 'Not every playable hand is a raise',
    body: 'Some hands (small pairs, suited connectors) play better as calls in position or in the big blind than as 3-bets.',
    tip: 'Use the trainer\'s "vs open" drills to learn which hands call and which 3-bet.',
    terms: ['3bet', 'range'],
  },
};

/** When should a lesson card pop up for a tag? On the 3rd, 8th, 15th... occurrence. */
export function shouldShowLesson(count) {
  return count === 3 || count === 8 || (count > 8 && count % 7 === 1);
}
