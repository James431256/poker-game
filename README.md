# ♠ Poker Trainer

A 6-max no-limit hold'em trainer that runs in the browser. You play cash games against five bots with different styles. A live coach explains each decision, every decision is graded after the hand, and there are drills, quizzes and a stats dashboard to help you find and fix leaks.

There are no dependencies and no build step: it's plain ES modules plus a tiny Node static server.

## Play online

**▶ https://james431256.github.io/poker-game/**

The site deploys automatically from `main` via GitHub Actions (`.github/workflows/pages.yml`): tests run first, then `index.html`, `styles.css` and `src/` are published. One-time setup: **Settings → Pages → Source: GitHub Actions**.

## Running it locally

```bash
npm start            # → http://localhost:8080   (PORT=3000 npm start for another port)
npm test             # unit tests (Node's built-in test runner)
```

Requires Node 18+. You can also serve the folder with any static server (for example `python3 -m http.server`). Opening `index.html` directly from disk won't work, because browsers block ES modules on `file://`.

Progress, stats, hand histories and settings are saved in `localStorage`. **Stats → Reset progress** wipes them.

## What's inside

### The table
- A 6-max cash game: you vs 5 bots, 100bb stacks (auto top-up each hand), rotating blinds and standard no-limit rules. That includes min-raise rules, incomplete all-in raises that don't reopen betting, all-in run-outs, correct side pots, split pots and odd-chip rules.
- **Bots with distinct styles:**

  | Bot | Style | How to beat it |
  |---|---|---|
  | 🪨 Rocky | Tight-passive | Steal their blinds; respect their raises |
  | 🦊 Luna | Loose-aggressive | Call down lighter, trap |
  | 📞 Cal | Calling station | Value-bet thin, never bluff |
  | 🎯 Regina | Solid regular (chart-based) | Solid fundamentals |
  | 🔥 Max | Maniac | Let him bluff into your strong hands |

  Each seat shows "Reading… n/30". After 30 hands together it shows a tendency label (e.g. *Loose-aggressive · 31/23 AF 2.9*). The label comes from the stats actually observed, not the hidden profile.

### Training features
1. **Live coach panel** (toggle with **H**): pot odds, Monte Carlo equity against each opponent's *estimated range* (narrowed by their actions and, once known, their style), outs (plus the weaker "pair outs"), SPR, the preflop chart for the spot, EV of each option, and a recommended action with a short reason.
2. **Decision grading:** after every hand, each decision is graded *good / marginal / mistake* with an EV-based explanation. Costly ones go to the **mistake log** (Review → Mistake log).
3. **Preflop chart trainer:** opening, facing an open and facing a 3-bet, by position. You get instant feedback and the full 13×13 chart, and questions are biased toward borderline hands.
4. **Spot drills:** quick-fire postflop scenarios (c-bet or check, facing a c-bet, drawing on the turn, river bluff-catchers), scored with points and streaks.
5. **Hand history and replay:** step through any of the last 150 hands (←/→ keys). You can show all hole cards, and the replay stops at each of your decisions with its grade and EV loss.
6. **Stats dashboard:** VPIP, PFR, aggression factor, bb/100, 3-bet, fold to 3-bet, c-bet, fold to c-bet, fold to river bet, WTSD and W$SD, each with healthy ranges. It also has a cumulative-winnings graph, a positional breakdown, opponent notes and **leak detection** in plain English (e.g. *"You fold too often to river bets"*).
7. **Difficulty progression:** four table levels. Bots make fewer random errors and read ranges more as the level goes up. From level 3 they **exploit your measured leaks**: they 3-bet you more if you over-fold to 3-bets, and bluff rivers more if you over-fold rivers. Levels unlock as your hand count and decision accuracy improve.

### Learning aids
- **Hover glossary:** underlined terms (equity, pot odds, implied odds, range, SPR…) show a definition on hover or tap. There's also a searchable Glossary page.
- **Lesson cards** pop up when you repeat the same mistake (on the 3rd and 8th time, then periodically).
- **Quiz me:** pot odds, outs → equity (rule of 2 and 4), counting outs, who wins at showdown, and naming the hand.

### Keyboard shortcuts
`F` fold · `C` check/call · `R` bet/raise · `Space` next hand · `H` toggle coach · `1–4` answer in trainer/drills/quiz · `Enter` next question · `←/→` step a replay.

## How the coach decides

- **Preflop:** simplified modern 6-max 100bb charts (`src/ranges.js`) for opens, facing an open, facing a 3-bet, vs limpers and vs 4-bets. Against a *revealed* maniac or LAG, the coach widens your continuing range and says why.
- **Postflop:** equity comes from Monte Carlo simulation against each opponent's weighted range. Options are compared with a deliberately simple, explainable model:
  - `EV(call) = eq·R·(pot + call) − call`
  - `EV(check) = eq·R·pot`
  - `EV(bet) = FE·pot + (1 − FE)·(eqC·R·(pot + 2b) − b)`

  Here *R* is equity realisation (lower out of position), *FE* is the share of the opponent's range that folds (air folds, weak pairs fold to big bets, strong hands and draws continue), and *eqC* is your equity against the part that continues. It ignores future streets, so treat the numbers as guidance rather than solver output. It is consistent, though, so it's good at spotting leaks.

## Project layout

```
index.html, styles.css, server.js
src/
  deck.js         cards, parsing, shuffling, seeded RNG
  evaluator.js    5–7 card hand evaluator + descriptions
  pots.js         main/side pot construction and awarding (pure)
  engine.js       game engine: betting rounds, streets, all-ins, showdown, hand history
  ranges.js       hand classes, range notation parser, preflop charts
  analysis.js     made-hand tiers, draws, board texture
  equity.js       Monte Carlo equity vs weighted ranges, outs, rule of 2 & 4
  rangeModel.js   opponent range estimation from actions
  bots.js         bot profiles and decision logic (with skill/exploit levels)
  coach.js        live advice, EV model and decision grading
  stats.js        stat extraction, totals, style classification, leak detection
  session.js      glue: engine + bots + coach + grading + stats + storage (no DOM)
  trainer.js      preflop trainer questions
  drills.js       postflop spot drills (built by scripting real engine hands)
  quiz.js         quiz question generators
  progression.js  table levels and unlock rules
  glossary.js     glossary terms
  lessons.js      lesson cards
  storage.js      localStorage persistence
  ui/             DOM views: app, table, play, coach panel, practice modes, review, stats
tests/            node:test unit tests (evaluator, side pots, engine, ranges, equity/coach/session)
```

## Tests

`npm test` runs:
- **Hand evaluator:** every category, wheel and steel wheel, kickers, best-5-of-7, tie handling.
- **Side pots:** short all-ins, multi-layer side pots, folded contributions, uncalled bets, split pots, odd chips, plus a randomised chip-conservation check.
- **Engine:** blinds and positions, BB option, min-raise rules, incomplete all-in raises not reopening action, all-in run-outs, and 400 random hands with no chips created or lost.
- **Ranges, equity, outs, coach advice, stat extraction,** and a headless session run.
