// Headless checks for the Quantest engines (no DOM needed for createEngine/simulate).
const fs = require("fs");
const vm = require("vm");
const root = process.argv[2] || require("path").join(__dirname, "..");
const ctx = { window: {}, navigator: {}, document: { createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, appendChild() {}, setAttribute() {}, addEventListener() {} }), querySelector: () => null, body: { appendChild() {} } }, console, setTimeout, clearTimeout, localStorage: { getItem: () => null, setItem() {} }, Math, Date, JSON };
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
["js/ui.js", "js/state.js", "js/facts.js", "js/lesson.js", "js/games/numberMarket.js", "js/games/flowDrill.js", "js/games/cardSum.js", "js/games/diceLadder.js", "js/games/daily.js", "js/games/arena.js"].forEach(f => vm.runInContext(fs.readFileSync(root + "/" + f, "utf8"), ctx, { filename: f }));

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

// ---------------- NumberMarket v2 ----------------
const fact = QUANTEST_FACTS.find(f => f.id === "un"); // 193
const T = fact.a;
function run(seed, strategy, rounds, size) {
  const e = NumberMarket.createEngine({ fact, rounds: rounds || 5, seed });
  e.setEstimate(T);
  for (let r = 0; r < (rounds || 5); r++) { const q = strategy(r, e); e.submit(q.bid, q.ask, size || 2); }
  return e;
}
const around = (mid, hw) => ({ bid: mid * Math.exp(-hw), ask: mid * Math.exp(hw) });

check("sigma schedule ends at 0", NumberMarket.sigmaSchedule(5)[4] === 0);
let e = run(42, () => around(T, 0.15));
check("engine settles after 5 rounds", e.state.done);
check("final contains truth", e.state.containsFinal === true);
check("last-round analyst never hits a market containing the truth", !e.state.trades.some(t => t.round === 4 && t.who === "analyst"));
check("market score in [0,100]", e.state.marketScore >= 0 && e.state.marketScore <= 100, e.state.marketScore);
check("estimate error recorded", e.state.estLogErr === 0 && e.state.estErrPct === 0);
check("pnl finite, xp assigned", isFinite(e.state.pnlPct) && e.state.xp >= 5);
check("screen hidden in round 1, recorded after", e.state.quotes[0].screen === null && e.state.quotes.slice(1).every(q => q.screen && q.screen.ask > q.screen.bid));

// last-round pick-off when the market misses, with size proportional to edge
e = NumberMarket.createEngine({ fact, rounds: 3, seed: 7 });
e.submit(230, 260, 3); e.submit(230, 260, 3); e.submit(230, 260, 3);
const lastAn = e.state.trades.find(t => t.round === 2 && t.who === "analyst");
check("last round pick-off when truth below bid", lastAn && lastAn.side === "sell" && lastAn.pnl < 0, JSON.stringify(lastAn));
check("pick-off size scales with edge (>1 unit)", lastAn && lastAn.size > 1, lastAn && lastAn.size);
check("pnl formula per unit", Math.abs(lastAn.pnl - (T - 230) / T * 100 * lastAn.size) < 1e-9);
e = NumberMarket.createEngine({ fact, rounds: 3, seed: 7 });
e.submit(230, 260, 1); e.submit(230, 260, 1); e.submit(230, 260, 1);
check("quoted size caps every fill", e.state.trades.every(t => t.size <= 1));

// analyst has memory: its posterior sd shrinks and its belief converges to the truth
e = NumberMarket.createEngine({ fact, rounds: 5, seed: 11 });
const sds = [];
for (let r = 0; r < 5; r++) { e.submit(100, 400, 1); sds.push(Math.sqrt(e.state.analyst.v)); }
check("analyst posterior sd decreases every round", sds.every((v, i) => i === 0 || v <= sds[i - 1] + 1e-12), sds.map(x => x.toFixed(3)).join(","));
check("analyst exact on the last round", Math.abs(Math.exp(e.state.analyst.mu) - T) < 1e-9);

// stale punishment: not moving after a hit draws a bigger hit than moving toward it
let pressedStay = 0, pressedMove = 0;
for (let s = 0; s < 300; s++) {
  const a = run(s, () => ({ bid: 120, ask: 150 }), 5, 1);           // market too low, never moves
  pressedStay += a.state.pressed;
  const b = run(s, (r, eng) => { const t = eng.state.trades.filter(x => x.who === "analyst"); const last = t[t.length - 1]; const m = last && last.side === "buy" ? 1.2 : 1; return { bid: 120 * Math.pow(m, r), ask: 150 * Math.pow(m, r) }; }, 5, 1);
  pressedMove += b.state.pressed;
}
check("staying still after a hit gets pressed more than moving", pressedStay > pressedMove * 2, pressedStay + " vs " + pressedMove);

// price priority: flow goes to whoever is better than the screen
let insideFlow = 0, outsideFlow = 0, insideLost = 0, outsideLost = 0;
for (let s = 0; s < 300; s++) {
  const a = run(s, (r, eng) => { const c = eng.compQuote(); return { bid: c.bid * 1.05, ask: c.ask * 0.95 }; }, 5, 1);
  insideFlow += a.state.noiseCaptured; insideLost += a.state.lostFlow;
  const b = run(s, (r, eng) => { const c = eng.compQuote(); return { bid: c.bid * 0.95, ask: c.ask * 1.05 }; }, 5, 1);
  outsideFlow += b.state.noiseCaptured; outsideLost += b.state.lostFlow;
}
check("inside the screen captures noise flow", insideFlow > 300, insideFlow);
check("outside the screen captures far less (only blind round-1 fills)", outsideFlow < insideFlow / 5, outsideFlow + " vs " + insideFlow);
check("flow lost to the screen is counted", outsideLost > insideLost, outsideLost + " vs " + insideLost);

// one-sided flow when the market is off: an all-buyer round is a signal
let buyUnits = 0, sellUnits = 0;
for (let s = 0; s < 200; s++) { const a = run(s, () => ({ bid: 100, ask: 130 }), 2, 3); a.state.trades.forEach(p => { if (p.side === "buy") buyUnits += p.size; else sellUnits += p.size; }); }
check("market below truth gets mostly buyers", buyUnits > sellUnits * 5, buyUnits + " vs " + sellUnits);

// risk limit: big size on a wrong market gets the line cut
let cutGames = 0;
for (let s = 0; s < 100; s++) { const a = run(s, () => ({ bid: 100, ask: 130 }), 5, 5); if (a.state.cuts > 0) cutGames += 1; }
check("desk cuts the line on oversized wrong-way positions", cutGames > 50, cutGames);
e = run(3, () => ({ bid: 100, ask: 130 }), 5, 5);
check("inventory never exceeds the limit", Math.abs(e.state.inv) <= NumberMarket.P.riskLimit, e.state.inv);
check("carry charged when holding inventory", e.state.carryPaid > 0);

// calibration beats knowledge: an honest wide market on a wrong estimate scores >= 50 vs the screen more often than a tight wrong one
let wideMs = 0, tightMs = 0, wideBlown = 0, tightBlown = 0;
for (let s = 0; s < 300; s++) {
  const est = T * 1.6; // 60% too high
  const a = run(s, (r) => around(est, 0.7 * Math.pow(0.8, r)), 5, 2); wideMs += a.state.marketScore; if (a.state.blownUp) wideBlown += 1;
  const b = run(s, (r) => around(est, 0.1), 5, 2); tightMs += b.state.marketScore; if (b.state.blownUp) tightBlown += 1;
}
check("honest width on a wrong estimate beats overconfidence", wideMs > tightMs + 10 * 300, (wideMs / 300).toFixed(0) + " vs " + (tightMs / 300).toFixed(0));
check("overconfidence blows up more", tightBlown > wideBlown, tightBlown + " vs " + wideBlown);

// a calibrated tightening strategy centred on the truth is profitable and beats the screen
let pnlSum = 0, msSum = 0;
for (let s = 0; s < 300; s++) { const a = run(s, (r) => around(T, [0.4, 0.25, 0.15, 0.08, 0.04][r]), 5, 2); pnlSum += a.state.pnlPct; msSum += a.state.marketScore; }
check("calibrated tightening is profitable on average", pnlSum / 300 > 0, (pnlSum / 300).toFixed(2));
check("calibrated tightening is well calibrated (avg score > 80)", msSum / 300 > 80, (msSum / 300).toFixed(1));

// copying the screen exactly earns nothing
let copyFlow = 0; for (let s = 0; s < 100; s++) copyFlow += run(s, (r, eng) => eng.compQuote(), 5, 1).state.trades.filter(t => t.round >= 1).length;
check("matching the screen exactly gets no flow once it is open (time priority)", copyFlow === 0, copyFlow);
const watcher = run(5, (r, eng) => r === 0 ? { bid: T / 100, ask: T * 100 } : eng.compQuote(), 5, 1).state;
check("no fills means capped xp", watcher.trades.length === 0 && watcher.xp <= 20, watcher.trades.length + " fills, xp " + watcher.xp);

// interval score penalises misses heavily
check("interval score: miss costs more than width", NumberMarket.intervalScore(100, 150, 193) > NumberMarket.intervalScore(100, 400, 193));

// determinism and bad input
const d1 = run(99, () => around(T, 0.2)).state.pnlPct, d2 = run(99, () => around(T, 0.2)).state.pnlPct;
check("seeded engine is deterministic", d1 === d2);
let threw = false; try { NumberMarket.createEngine({ fact, seed: 1 }).submit(200, 100, 1); } catch (err) { threw = true; }
check("ask<=bid rejected", threw);

// ---------------- FlowDrill ----------------
let fd = ctx.FlowDrill.createEngine({ seed: 1, persona: "buyer" });
fd.submit(100, 120); fd.submit(100, 120); fd.submit(100, 120); fd.submit(100, 120); fd.submit(100, 120);
check("drill: buyer keeps lifting a static cheap offer until the limit", fd.state.trades.length >= 4 && fd.state.trades.every(t => t.side === "buy") && fd.state.maxInv === ctx.FlowDrill.LIMIT);
check("drill: never moving scores low", fd.state.moved === 0 && fd.state.score < 50, fd.state.score);
check("drill: static quoter gets run over", !fd.state.capped && fd.state.maxInv === ctx.FlowDrill.LIMIT);
fd = ctx.FlowDrill.createEngine({ seed: 1, persona: "buyer" });
let fb = 100, fa = 120; for (let r = 0; r < 5; r++) { const res = fd.submit(fb, fa); if (res.trade) { fb *= 1.18; fa *= 1.2; } }
check("drill: shifting up with the buyer scores high", fd.state.score >= 75 && fd.state.containsFinal, fd.state.score + " moved " + fd.state.moved + " contains " + fd.state.containsFinal);
check("drill: buyer stops once your ask is above their number", fd.state.trades.length < 5, fd.state.trades.length);
fd = ctx.FlowDrill.createEngine({ seed: 2, persona: "flipper" });
for (let r = 0; r < 5; r++) fd.submit(100, 120);
check("drill: flipper buys twice then sells", fd.state.trades.slice(0, 2).every(t => t.side === "buy") && fd.state.trades.slice(2).every(t => t.side === "sell"));
fd = ctx.FlowDrill.createEngine({ seed: 2, persona: "patient" });
for (let r = 0; r < 5; r++) fd.submit(100, 120);
check("drill: patient passes three rounds then buys", fd.state.trades.length === 2 && fd.state.trades[0].round === 3);
check("drill: fills capped at the limit", fd.state.maxInv <= ctx.FlowDrill.LIMIT);
check("drill: truth is relative to opening mid", Math.abs(fd.state.T - 110 * Math.exp(0.35)) < 1e-9);

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
