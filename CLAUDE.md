# Quantest — notes for Claude Code

Static web game, no build step, no framework, no backend. Plain HTML + CSS + vanilla JS loaded
by `<script>` tags in `index.html` (order matters: ui → state → facts → lesson → games → app).

## Run and test

- Serve: `python3 -m http.server 8000` then open http://localhost:8000 (or open `index.html` directly).
- Engine tests: `npm test` (runs `tests/engine-test.js` in Node with a DOM shim; no browser needed).
- Visual check: `tests/screenshots.py` drives Playwright through every screen at desktop and phone
  width and writes PNGs to `tests/shots/`. Needs `pip install playwright && playwright install chromium`.

## Layout

- `css/styles.css` — tokens at the top (`:root`), then components. Keep the look: flat fills, 2px
  `--line` borders, 4px solid bottom shadow on buttons (`.btn`), 16px radius, Nunito 700–900.
- `js/ui.js` — `UI.el(tag, attrs, children)` is the only DOM builder; `UI.fmt` / `UI.parseNum`
  handle numbers like `1.2m`; `UI.rng(seed)` is mulberry32, `UI.gauss(rand)` is Box-Muller.
- `js/state.js` — all persistence (localStorage key `quantest.v1`): XP, hearts, streak, lessons, bests.
- `js/lesson.js` — `Lesson.open()` full-screen scaffold with `setFoot(tone, title, sub, label, onClick)`.
- `js/games/*.js` — each game exposes `createEngine` (pure, seedable, no DOM) and `play(opts)`.
  Keep engines pure so tests and the arena baseline replay keep working.
- `js/games/numberMarket.js` is the core. Engine v2: the player gives an estimate, then quotes
  bid/ask/size for 5 rounds. Round 1 is blind; from round 2 a competitor "screen" quote is visible
  and has time priority (you need a strictly better price to get flow). Counterparties: a Bayesian
  analyst (private signal sharpening each round, exact on the last; sizes by edge in sd units;
  hits harder if you don't move after a fill), a noise population (truth-centred lognormal
  beliefs, clipped at ±2 sd), and the screen itself which learns from prints and tightens.
  Inventory costs carry; at ±riskLimit the desk cuts your line. Settlement reports estimate error,
  calibration (interval score vs an unbiased reference market; 100 = expert-tight, never missed)
  and flow P&L (% of truth, all units). XP comes from calibration and P&L, not from knowing.
  All constants are in `P` at the top of the file; `tests/engine-test.js` pins the behaviours
  (price priority, stale punishment, one-sided flow, line cut, calibration > overconfidence).
- `js/games/flowDrill.js` — the interview drill. Five scripted personas with a fair value set
  relative to the player's opening mid; they only trade at prices better than it. Scored on
  reaction (moved after fills, final market contains their number, stayed inside the limit).
- `js/app.js` — hash router (`#learn`, `#games`, `#daily`, `#profile`), path rendering, hosted rooms.
- `js/facts.js` — fact bank; every fact needs `id, q, a, unit, cat, tol, note`. `cat` must be a
  unit id and each unit needs at least `lessons × 3` facts.

## Conventions

- British spelling in UI copy. Sentence case. No exclamation marks in verdicts.
- Scores in Number Markets are P&L as a percentage of the true value; other games use points.
- Hearts: lost on blow-up only (`blownUp` thresholds live in each engine's `settle`).
- Before changing engine constants, run `npm run balance` (strategy table) and `npm test`: an
  expert must beat a screen-copier, a calibrated wrong estimate must beat an overconfident one,
  and matching the screen must earn nothing.
- Don't add dependencies or a bundler without a reason; the site must keep working from `file://`.
