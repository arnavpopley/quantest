const fs = require("fs"), vm = require("vm");
const root = require("path").join(__dirname, "..");
const ctx = { window: {}, navigator: {}, document: { createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, appendChild() {}, setAttribute() {}, addEventListener() {} }), querySelector: () => null, body: { appendChild() {} } }, console, setTimeout, clearTimeout, localStorage: { getItem: () => null, setItem() {} }, Math, Date, JSON };
ctx.window = ctx; vm.createContext(ctx);
["js/ui.js", "js/state.js", "js/facts.js", "js/lesson.js", "js/games/numberMarket.js"].forEach(f => vm.runInContext(fs.readFileSync(root + "/" + f, "utf8"), ctx, { filename: f }));
const { NumberMarket, QUANTEST_FACTS } = ctx;
const facts = QUANTEST_FACTS.filter(f => ["un", "everest", "neurons", "tube-stations", "mcd"].includes(f.id));
const around = (mid, hw) => ({ bid: mid * Math.exp(-hw), ask: mid * Math.exp(hw) });
const strategies = {
  "know it, tight 10%":        (T, r, e) => around(T, 0.05),
  "know it, calibrated":       (T, r, e) => around(T, [0.3, 0.2, 0.12, 0.07, 0.04][r]),
  "est +40%, honest wide":     (T, r, e) => around(T * 1.4, [0.6, 0.45, 0.3, 0.2, 0.1][r]),
  "est +40%, overconfident":   (T, r, e) => around(T * 1.4, 0.08),
  "est +40%, follow the flow": (T, r, e) => { const q = e.state.quotes; let m = T * 1.4; if (q.length) { const last = q[q.length - 1]; m = (last.bid + last.ask) / 2; const t = e.state.prints.filter(p => p.round === q.length - 1); let net = 0; t.forEach(p => net += (p.side === "buy" ? 1 : -1) * p.size); m *= Math.exp(0.08 * Math.max(-3, Math.min(3, net))); } return around(m, [0.5, 0.35, 0.25, 0.15, 0.08][r]); },
  "copy the screen":           (T, r, e) => e.compQuote(),
  "know it, compete w/ screen": (T, r, e) => { const c = e.compQuote(); let b = c.bid * 1.1, a = c.ask * 0.9; if (T < b) { const w = a / b; b = T * 0.97; a = b * w; } if (T > a) { const w = a / b; a = T * 1.03; b = a / w; } return { bid: b, ask: a }; },
  "est +40%, adaptive":        (T, r, e) => { const q = e.state.quotes; if (!q.length) return around(T * 1.4, 0.5); const last = q[q.length - 1]; let m = (last.bid + last.ask) / 2, hw = Math.log(last.ask / last.bid) / 2; const t = e.state.prints.filter(p => p.round === q.length - 1); let buy = 0, sell = 0, vol = 0, pv = 0; t.forEach(p => { if (p.side === "buy") buy += p.size; else sell += p.size; vol += p.size; pv += p.size * Math.log(p.price); }); if (vol) { const vwap = Math.exp(pv / vol); m = Math.exp(0.5 * Math.log(m) + 0.5 * Math.log(vwap)); } const myFills = t.filter(p => p.venue === "player"); let net = 0; myFills.forEach(p => net += (p.side === "buy" ? 1 : -1) * p.size); m *= Math.exp(0.06 * Math.max(-4, Math.min(4, net))); if (buy > 0 && sell > 0) hw *= 0.75; else if (vol >= 3) hw *= 1.0; else hw *= 0.85; return around(m, Math.max(0.05, hw)); },
  "inside screen 10%":         (T, r, e) => { const c = e.compQuote(); return { bid: c.bid * 1.1, ask: c.ask * 0.9 }; },
  "clueless x3 wide":          (T, r, e) => around(T * 3, 1.0),
};
const N = 120;
console.log("strategy".padEnd(28), "pnl%".padStart(7), "mkt".padStart(5), "noise".padStart(6), "pick".padStart(5), "hedge".padStart(6), "blow".padStart(5), "xp".padStart(4));
for (const [name, strat] of Object.entries(strategies)) {
  let pnl = 0, ms = 0, noise = 0, pick = 0, hedge = 0, blow = 0, xp = 0, n = 0;
  facts.forEach(fact => { for (let s = 0; s < N; s++) {
    const e = NumberMarket.createEngine({ fact, rounds: 5, seed: s }); e.setEstimate(fact.a);
    for (let r = 0; r < 5; r++) { const q = strat(fact.a, r, e); e.submit(q.bid, q.ask, 2); }
    pnl += e.state.pnlPct; ms += e.state.marketScore; noise += e.state.noiseUnits; pick += e.state.pickedOff; hedge += e.state.cuts; blow += e.state.blownUp ? 1 : 0; xp += e.state.xp; n++;
  } });
  console.log(name.padEnd(28), (pnl / n).toFixed(1).padStart(7), (ms / n).toFixed(0).padStart(5), (noise / n).toFixed(1).padStart(6), (pick / n).toFixed(2).padStart(5), (hedge / n).toFixed(2).padStart(6), (100 * blow / n).toFixed(0).padStart(4) + "%", (xp / n).toFixed(0).padStart(4));
}
