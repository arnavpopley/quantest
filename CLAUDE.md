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
- `js/app.js` — hash router (`#learn`, `#games`, `#daily`, `#profile`), path rendering, hosted rooms.
- `js/facts.js` — fact bank; every fact needs `id, q, a, unit, cat, tol, note`. `cat` must be a
  unit id and each unit needs at least `lessons × 3` facts.

## Conventions

- British spelling in UI copy. Sentence case. No exclamation marks in verdicts.
- Scores in Number Markets are P&L as a percentage of the true value; other games use points.
- Hearts: lost on blow-up only (`blownUp` thresholds live in each engine's `settle`).
- Don't add dependencies or a bundler without a reason; the site must keep working from `file://`.
