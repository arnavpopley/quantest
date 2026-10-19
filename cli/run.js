// A "run" is one market in one game, wrapped so it can be saved mid-way and resumed.
// Engines are seeded and deterministic, so a run is just { kind, seed, factId, actions }:
// rebuilding it replays the actions against a fresh engine and lands in the same state.
"use strict";
const E = require("./engines");

const GAMES = {
  nm: { title: "Number markets", blurb: "quote a market on a fact, 5 rounds", unit: "%" },
  cs: { title: "Card sum", blurb: "five cards, one flips each round", unit: "pts" },
  dl: { title: "Dice ladder", blurb: "five hidden dice, pay to peek", unit: "pts" }
};
const ORDER = ["nm", "cs", "dl"];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUITS = ["♠", "♥", "♦", "♣"];

function seed32() { return (Math.random() * 2 ** 32) >>> 0; }

// Pick a fact not seen recently, so short sessions don't repeat questions.
function pickFact(recent) {
  const avoid = new Set(recent || []);
  let pool = E.FACTS.filter(f => !avoid.has(f.id));
  if (!pool.length) pool = E.FACTS;
  return pool[Math.floor(Math.random() * pool.length)];
}

function create(kind, recent) {
  const r = { kind, seed: seed32(), actions: [] };
  if (kind === "nm") r.factId = pickFact(recent).id;
  return build(r);
}

function build(saved) {
  const run = { kind: saved.kind, seed: saved.seed, factId: saved.factId, actions: [] };
  if (run.kind === "nm") {
    const fact = E.FACTS.find(f => f.id === run.factId);
    if (!fact) throw new Error("unknown fact " + run.factId);
    run.eng = E.NumberMarket.createEngine({ fact, rounds: 5, seed: run.seed });
  } else if (run.kind === "cs") run.eng = E.CardSum.createEngine({ seed: run.seed });
  else if (run.kind === "dl") run.eng = E.DiceLadder.createEngine({ seed: run.seed });
  else throw new Error("unknown game " + run.kind);
  (saved.actions || []).forEach(a => apply(run, a));
  return run;
}

function apply(run, a) {
  let res;
  if (a.t === "quote") res = run.eng.submit(a.bid, a.ask);
  else if (a.t === "peek") res = run.eng.peek();
  else throw new Error("bad action");
  run.actions.push(a);
  return res;
}

function quote(run, bid, ask) { return apply(run, { t: "quote", bid, ask }); }
function peek(run) { return run.kind === "dl" ? apply(run, { t: "peek" }) : null; }

function done(run) { return run.eng.state.done; }
function serialise(run) { return { kind: run.kind, seed: run.seed, factId: run.factId, actions: run.actions }; }

function lastQuote(run) {
  const q = run.eng.state.quotes;
  return q.length ? q[q.length - 1] : null;
}

// The settled score in the game's own unit: % of truth for number markets, points otherwise.
function score(run) {
  const st = run.eng.state;
  return run.kind === "nm" ? st.pnlPct : st.pnl;
}

function truth(run) { return run.kind === "nm" ? run.eng.T : run.eng.S; }

// What the player can see right now: a fair value and its uncertainty, where the game has one.
function fairValue(run) {
  const st = run.eng.state;
  if (run.kind === "cs") {
    const hidden = 5 - st.shown;
    // sampling without replacement from a 52-card deck: per-card variance ≈ 14, finite-population corrected
    const N = 52 - st.shown;
    const sd = hidden > 0 ? Math.sqrt(hidden * 14 * (N - hidden) / (N - 1)) : 0;
    return { mean: run.eng.condExpectation(st.shown), sd };
  }
  if (run.kind === "dl") {
    let seen = 0;
    st.peeked.forEach(i => { seen += st.dice[i]; });
    const hidden = 5 - st.peeked.length;
    return { mean: seen + 3.5 * hidden, sd: Math.sqrt(hidden * 35 / 12) };
  }
  return null;
}

function position(run) {
  let pos = 0;
  run.eng.state.trades.forEach(t => { pos += t.side === "buy" ? -1 : 1; });
  return pos;
}

// Stats live in ~/.quantest/stats.json; separate from the web app's localStorage.
function emptyStats() {
  return { xp: 0, recent: [], games: { nm: { n: 0, sum: 0, best: null }, cs: { n: 0, sum: 0, best: null }, dl: { n: 0, sum: 0, best: null } } };
}

function record(stats, run) {
  stats = stats || emptyStats();
  if (!stats.games) stats.games = emptyStats().games;
  const g = stats.games[run.kind] || (stats.games[run.kind] = { n: 0, sum: 0, best: null });
  const s = score(run);
  g.n += 1; g.sum += s;
  if (g.best === null || s > g.best) g.best = s;
  stats.xp = (stats.xp || 0) + (run.eng.state.xp || 0);
  if (run.kind === "nm") {
    stats.recent = [run.factId].concat((stats.recent || []).filter(id => id !== run.factId)).slice(0, 40);
  }
  return stats;
}

// One short coaching line for the result screen, in the same voice as the web lessons.
function tip(run) {
  const st = run.eng.state;
  const T = truth(run);
  const q0 = st.quotes[0], qN = st.quotes[st.quotes.length - 1];
  if (run.kind === "nm") {
    if (!(q0.bid <= T && T <= q0.ask)) return "Your opening market missed the number. Open wide, then tighten as trades tell you where it is.";
    const inf = st.trades.filter(t => t.who === "informed" && t.pnl < 0);
    if (inf.length) return "A buyer at your ask means shift up; a seller at your bid means shift down. Move the whole market, not just one side.";
    const w0 = (q0.ask - q0.bid) / ((q0.ask + q0.bid) / 2), wN = (qN.ask - qN.bid) / ((qN.ask + qN.bid) / 2);
    if (wN >= w0) return "You never tightened. Every round without a trade is information; use it.";
    if (!st.noiseCaptured) return "No noise flow came. Markets wider than about 30% of mid rarely get hit by anyone but the informed.";
    return "Contained, tightened, and paid by the flow. That is the job.";
  }
  if (run.kind === "cs") {
    const w = q0.ask - q0.bid;
    if (st.trades.some(t => t.who === "informed")) return "The peeker traded, so the hidden cards leaned their way. Shift toward the trade, not just wider.";
    return w < 8 ? "Blind fair value is 35 with a standard deviation near 8.4. Opening under one standard deviation is brave against someone who has seen two cards." : "The peeker never traded: your market sat around their private number all game.";
  }
  if (st.peeked.length === 0) return "You never peeked. Against someone who knows two dice you quoted with roughly twice their uncertainty.";
  if (st.peeked.length >= 4) return "Nearly all the information bought. Safe, but " + st.fees.toFixed(1) + " in fees is a lot of spread to earn back.";
  return "Each unpeeked die adds about 1.7 points of standard deviation. A peek is worth it when it saves more than its fee.";
}

function cardLabel(c) { return RANKS[c.v - 1] + SUITS[c.s]; }

module.exports = { GAMES, ORDER, create, build, quote, peek, done, serialise, lastQuote, score, truth, fairValue, position, emptyStats, record, tip, cardLabel, E };
