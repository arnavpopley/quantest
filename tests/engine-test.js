// Headless checks for the Quantest engines (no DOM needed for createEngine/simulate).
const fs = require("fs");
const vm = require("vm");
const root = process.argv[2] || require("path").join(__dirname, "..");
const ctx = { window: {}, navigator: {}, document: { createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, appendChild() {}, setAttribute() {}, addEventListener() {} }), querySelector: () => null, body: { appendChild() {} } }, console, setTimeout, clearTimeout, localStorage: { getItem: () => null, setItem() {} }, Math, Date, JSON };
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
["js/ui.js", "js/state.js", "js/facts.js", "js/lesson.js", "js/games/numberMarket.js", "js/games/cardSum.js", "js/games/diceLadder.js", "js/games/daily.js", "js/games/arena.js"].forEach(f => vm.runInContext(fs.readFileSync(root + "/" + f, "utf8"), ctx, { filename: f }));

const { UI, NumberMarket, CardSum, DiceLadder, Daily, Arena, QUANTEST_FACTS, QUANTEST_UNITS } = ctx;
let fails = 0;
function check(name, cond, extra) { if (!cond) { fails++; console.log("FAIL", name, extra || ""); } else console.log("ok  ", name); }

// facts sanity
check("facts count >= 70", QUANTEST_FACTS.length >= 70, QUANTEST_FACTS.length);
const ids = new Set(); let dup = false; QUANTEST_FACTS.forEach(f => { if (ids.has(f.id)) dup = true; ids.add(f.id); });
check("fact ids unique", !dup);
check("all facts positive numbers", QUANTEST_FACTS.every(f => typeof f.a === "number" && f.a > 0));
QUANTEST_UNITS.forEach(u => {
  const n = QUANTEST_FACTS.filter(f => f.cat === u.id).length;
  check("unit " + u.id + " has enough facts (" + n + " for " + u.lessons * 3 + ")", n >= u.lessons * 3);
});

// number formatting
check("fmt 1234567 -> 1.23m", UI.fmt(1234567) === "1.23m", UI.fmt(1234567));
check("fmt 206 -> 206", UI.fmt(206) === "206", UI.fmt(206));
check("fmt 86e9 -> 86bn", UI.fmt(86e9) === "86bn", UI.fmt(86e9));
check("parseNum 1.2m", UI.parseNum("1.2m") === 1200000);
check("parseNum 1,200", UI.parseNum("1,200") === 1200);
check("parseNum 2.5bn", UI.parseNum("2.5bn") === 2.5e9);
check("parseNum junk NaN", isNaN(UI.parseNum("abc")));

// NumberMarket engine: a market containing the truth with reasonable width never gets picked off on the last round
const fact = QUANTEST_FACTS.find(f => f.id === "un");
let e = NumberMarket.createEngine({ fact, rounds: 5, seed: 42 });
check("sigma schedule ends at 0", NumberMarket.sigmaSchedule(5)[4] === 0);
let res;
for (let r = 0; r < 5; r++) res = e.submit(150, 250);
check("engine settles after 5 rounds", e.state.done && res.done);
check("final contains truth", e.state.containsFinal === true);
check("last-round informed never trades when truth inside", !e.state.trades.some(t => t.round === 4 && t.who === "informed"));
check("pnl is a finite number", isFinite(e.state.pnlPct));
check("xp assigned", e.state.xp >= 5);

// a market that misses the truth on the last round must be picked off
e = NumberMarket.createEngine({ fact, rounds: 3, seed: 7 });
e.submit(300, 400); e.submit(300, 400); e.submit(300, 400);
const lastInformed = e.state.trades.find(t => t.round === 2 && t.who === "informed");
check("last round pick-off when truth below bid", lastInformed && lastInformed.side === "sell" && lastInformed.pnl < 0, JSON.stringify(lastInformed));
check("short-side pnl formula", Math.abs(lastInformed.pnl - (193 - 300) / 193 * 100) < 1e-9);

// expected behaviour over many seeds: tight correct markets earn more noise flow than wide ones
let tightNoise = 0, wideNoise = 0;
for (let s = 0; s < 300; s++) {
  const a = NumberMarket.createEngine({ fact, rounds: 5, seed: s }); for (let r = 0; r < 5; r++) a.submit(185, 200); tightNoise += a.state.noiseCaptured;
  const b = NumberMarket.createEngine({ fact, rounds: 5, seed: s }); for (let r = 0; r < 5; r++) b.submit(100, 400); wideNoise += b.state.noiseCaptured;
}
check("tight markets attract more noise flow", tightNoise > wideNoise * 3, tightNoise + " vs " + wideNoise);

// a wide-then-tighten strategy should be profitable on average
let pnlSum = 0;
for (let s = 0; s < 300; s++) {
  const a = NumberMarket.createEngine({ fact, rounds: 5, seed: s });
  const widths = [0.8, 0.5, 0.3, 0.15, 0.08];
  widths.forEach(w => a.submit(193 * (1 - w / 2), 193 * (1 + w / 2)));
  pnlSum += a.state.pnlPct;
}
check("calibrated tightening strategy is profitable on average", pnlSum / 300 > 0, (pnlSum / 300).toFixed(2));

// bad quotes rejected
let threw = false; try { NumberMarket.createEngine({ fact, seed: 1 }).submit(200, 100); } catch (err) { threw = true; }
check("ask<=bid rejected", threw);

// CardSum
let c = CardSum.createEngine({ seed: 3 });
check("card hand of 5", c.state.hand.length === 5 && c.S >= 5 && c.S <= 65);
check("blind expectation is 35", Math.abs(c.condExpectation(0) - 35) < 1e-9);
for (let r = 0; r < 5; r++) c.submit(c.S - 3, c.S + 3);
check("card game settles", c.state.done && c.state.containsFinal);
check("card shown count = 5 at end", c.state.shown === 5);
let cardPnl = 0;
for (let s = 0; s < 300; s++) { const g = CardSum.createEngine({ seed: s }); for (let r = 0; r < 5; r++) { const ev = g.condExpectation(g.state.shown); g.submit(Math.round(ev - 4), Math.round(ev + 4)); } cardPnl += g.state.pnl; }
check("conditional-expectation quoting is not a disaster (avg pnl > -2)", cardPnl / 300 > -2, (cardPnl / 300).toFixed(2));

// DiceLadder
let d = DiceLadder.createEngine({ seed: 11 });
check("five dice in range", d.state.dice.length === 5 && d.state.dice.every(x => x >= 1 && x <= 6));
const p1 = d.peek(); const p2 = d.peek();
check("peek reveals distinct dice", p1 !== p2 && d.state.peeked.length === 2 && d.state.fees === 3);
for (let r = 0; r < 4; r++) d.submit(d.S - 2, d.S + 2);
check("dice settles with fees subtracted", d.state.done && Math.abs((d.state.pnl + d.state.fees) - d.state.grossPnl) < 1e-9);

// Daily
const g1 = Daily.grade({ a: 193 }, 185, 200);
check("daily grade contains+tight wins", g1.pos === "in" && g1.width === "tight" && g1.win);
const g2 = Daily.grade({ a: 193 }, 300, 400);
check("daily grade market too high", g2.pos === "high" && !g2.win);
const g3 = Daily.grade({ a: 193 }, 100, 150);
check("daily grade market too low", g3.pos === "low");
const t1 = Daily.todayInfo(new Date(2026, 9, 16)), t2 = Daily.todayInfo(new Date(2026, 9, 17));
check("daily numbering starts at 1 on launch day", t1.n === 1 && t2.n === 2);
check("daily is deterministic for a date", Daily.todayInfo(new Date(2026, 9, 20)).fact.id === Daily.todayInfo(new Date(2026, 9, 20)).fact.id);

// Arena simulator
const base = Arena.baseline(123, 456).st;
check("arena baseline runs 450 ticks", base.t === 449 && isFinite(base.finalPnl));
const wide = Arena.simulate({ pathSeed: 123, seed: 456, decide: () => ({ spread: 3, skew: 0, hedge: false }) }).st;
check("very wide spread gets almost no noise flow", wide.noise < base.noise, wide.noise + " vs " + base.noise);
let pickWide = 0, pickTight = 0;
for (let s = 0; s < 40; s++) {
  pickWide += Arena.simulate({ pathSeed: s, seed: s + 1, decide: () => ({ spread: 2.0, skew: 0, hedge: false }) }).st.pickedOff;
  pickTight += Arena.simulate({ pathSeed: s, seed: s + 1, decide: () => ({ spread: 0.3, skew: 0, hedge: false }) }).st.pickedOff;
}
check("tight spreads get picked off more", pickTight > pickWide, pickTight + " vs " + pickWide);
const sk = Arena.simulate({ pathSeed: 5, seed: 6, decide: (s) => ({ spread: 0.8, skew: -0.15 * s.inv, hedge: false }) }).st;
check("skewing bot keeps smaller inventory than baseline", sk.maxInv <= Arena.baseline(5, 6).st.maxInv + 1, sk.maxInv + " vs " + Arena.baseline(5, 6).st.maxInv);

console.log(fails ? ("\n" + fails + " FAILURES") : "\nall checks passed");
process.exit(fails ? 1 : 0);
