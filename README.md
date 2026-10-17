# Quantest

Make markets on numbers. A browser game that trains estimation, fair value, and bid-ask spreads
the way trading desks teach it. Static site, no build step, no backend: open `index.html` or drop
the folder on any static host.

## Run it

```
# any static server works; this one ships with Python
cd quantest
python3 -m http.server 8000
# then open http://localhost:8000
```

Opening `index.html` directly from disk also works (everything is relative paths and localStorage).

## Deploy to quantest.net

Static hosting is enough. Three routes that take under ten minutes:

- **Cloudflare Pages**: create a project, upload the folder (or connect the GitHub repo), set the build command to none and output directory to `/`. Add `quantest.net` as a custom domain; Cloudflare handles DNS and TLS if the domain's nameservers are on Cloudflare.
- **Netlify**: drag the folder onto the dashboard. Add the domain under Domain management and point your registrar's A record at Netlify's load balancer (they show the IP) or use their DNS.
- **GitHub Pages**: push to a repo, enable Pages from the `main` branch root, add a `CNAME` file containing `quantest.net`, and set A records at the registrar to GitHub's four Pages IPs plus a `www` CNAME to `<user>.github.io`.

## What's in it

```
index.html             shell: sidebar, main column, right column, mobile tab bar
css/styles.css         design tokens and components (3D buttons, cards, ladder, tiles)
js/ui.js               DOM helpers, number formatting, seeded RNG, haptics, confetti, mascot
js/state.js            localStorage: XP, hearts (regen 1 per 10 min), streak, lesson progress, bests
js/facts.js            the fact bank (~85 numbers with sources) and the six path units
js/lesson.js           full-screen lesson scaffold, linear ladder, shared quote inputs
js/games/numberMarket.js   core game: quote a market on a number, analyst converges, settle
js/games/cardSum.js        five cards, one flips per round, a peeker knows two
js/games/diceLadder.js     five dice, pay to peek, counterparty knows two
js/games/daily.js          six-quote daily puzzle, seeded by date, share grid
js/games/arena.js          45-second live quoting with spread, skew, inventory, news jumps
js/app.js              routing, learning path, games grid, hosted rooms, profile
```

Every engine is a pure function set (`createEngine` / `simulate`) separate from its screen, so
they can be unit-tested in Node without a browser, replayed for a baseline bot, or moved to a
server later for leagues.

## The core mechanic (Number Markets)

1. A question with a numeric answer appears. The player quotes a bid and an ask.
2. An **analyst** trades against the market. Their estimate of the true number carries log-normal
   noise that shrinks every round and is exact on the final round. Early on they only trade when
   their estimate is well outside the market, so early trades are informative but noisy.
3. A **noise trader** shows up with probability `0.85 · exp(−3 · width/mid)`. Tight markets get
   flow; markets wider than about 30% of mid rarely do.
4. After the final round the number is revealed with its source. Each fill settles against it:
   short at the ask earns `(ask − T)/T`, long at the bid earns `(T − bid)/T`. P&L is a share of the
   true value so a market on 46 chromosomes and one on 86 billion neurons score on the same scale.
5. XP rewards a final market that contains the number, tightness, noise flow captured, and
   solvency. P&L below −30% costs a heart.

The same engine powers the learning path (3 facts per lesson, 6 units), quick play, and hosted
rooms (host enters a secret number, players quote in turn on the same seed, leaderboard by P&L).

## Adding facts

Append to `js/facts.js`:

```js
{ id: "unique-id", q: "How many ...?", a: 1234, unit: "things", cat: "world",
  tol: "exact" | "approx", note: "Where the number comes from." }
```

`cat` must match a unit id in `QUANTEST_UNITS`. Each unit needs at least `lessons × 3` facts.

## Roadmap (already in the UI as "soon")

Hunter mode, live Tube markets, spot the pick-off, winner's curse duel, ball on a spring, tape
guessing, battle royale, idle algo. Leagues and friend leaderboards need accounts and a server;
everything else here is client-only.

## Design references

The look is Duolingo-adjacent on purpose: flat sticker fills, 2px borders, solid 4px bottom
shadows that press, one rounded typeface (Nunito), one action per screen, verdict footers.
Public repos and files worth reading for the same vibe:

- bryanjenningz/react-duolingo — Next.js, Tailwind, Zustand clone of the web app
- NickCoder123/duolingo-clone (the CodeWithAntonio "Lingo" build; forks: BernieTv/Duo-Clone,
  RikhiSingh/Duolingo-Clone) — Next.js 14, shadcn/ui, buttons library, lesson path, hearts, shop
- DareDev256/buildright — React Native + Expo with a Duolingo-inspired design system (3D buttons,
  zigzag path nodes) for the mobile version later
- react-native-3d-animated-buttons (npm) — the press animation with haptics
- manuel12/fluent-css — plain CSS library in the Duolingo style
- shadcn.io/design/duolingo and webdesignhot.com/design.md/duolingo — DESIGN.md token files
  (colours, type, radii) you can hand to an AI coding tool
- google-labs-code/design.md — the DESIGN.md spec those files follow
