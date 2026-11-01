#!/usr/bin/env node
// Quantest in the terminal. Built to sit next to Claude Code: a status bar shows what Claude is
// doing, and when it finishes (or needs permission) the game rings, counts down, and hands focus back.
//
//   qt                 play in this terminal
//   qt --toggle        open the game beside Claude, focus it, or go back (bind this to a key)
//   qt --open          open the game beside Claude now
//   qt status          what Claude Code is doing
//   qt pause [time]    stop the game opening on its own for an hour (or 30m, 2h...); z in the game
//   qt resume          let it open on its own again
//   qt config          show settings and where they live
"use strict";
const fs = require("fs");
const C = require("./common");
const L = require("./launch");
const R = require("./run");
const { UI } = R.E;

// ---------------- arguments ----------------
function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === "--cc") a.cc = true;
    else if (x === "--toggle") a.toggle = true;
    else if (x === "--open") a.open = true;
    else if (x === "--origin") a.origin = argv[++i];
    else if (x === "--from-pane") a.fromPane = argv[++i];
    else if (x === "-h" || x === "--help") a.help = true;
    else a._.push(x);
  }
  return a;
}

// ---------------- colour and layout ----------------
const COLOR = !process.env.NO_COLOR;
const sgr = code => s => COLOR ? "\x1b[" + code + "m" + s + "\x1b[0m" : String(s);
const c = {
  bold: sgr("1"), dim: sgr("2"), inv: sgr("7"),
  green: sgr("32"), red: sgr("31"), blue: sgr("34"), yellow: sgr("33"), magenta: sgr("35"), cyan: sgr("36"),
  bgGreen: sgr("30;42"), bgRed: sgr("97;41"), bgBlue: sgr("97;44"), bgYellow: sgr("30;43")
};
const bid = c.green, ask = c.red;
const vlen = s => String(s).replace(/\x1b\[[0-9;]*m/g, "").length;
const padR = (s, n) => s + " ".repeat(Math.max(0, n - vlen(s)));
function wrap(text, width) {
  const out = []; let line = "";
  String(text).split(/\s+/).forEach(w => {
    if (!w) return;
    if (line && (line + " " + w).length > width) { out.push(line); line = w; }
    else line = line ? line + " " + w : w;
  });
  if (line) out.push(line);
  return out;
}
const fmt = n => UI.fmt(n);
const pct = (x, d) => UI.fmtPct(x, d);
const signed = (x, d) => (x >= 0 ? "+" : "") + x.toFixed(d === undefined ? 1 : d);

// A number line: past quotes faint, the live market as [====], trades as ▲/▼ with their round, the truth as ★.
function ladder(width, run, live, truthVal) {
  const st = run.eng.state;
  const log = run.kind === "nm";
  const pts = [];
  st.quotes.forEach(q => pts.push(q.bid, q.ask));
  if (live) pts.push(live.bid, live.ask);
  if (truthVal !== undefined && truthVal !== null) pts.push(truthVal);
  let lo, hi;
  if (log) {
    if (!pts.length) return [c.dim("·".repeat(width)), c.dim(padR("", Math.floor(width / 2) - 12) + "your market will appear here")];
    lo = Math.min(...pts) / 1.8; hi = Math.max(...pts) * 1.8;
  } else {
    [lo, hi] = run.kind === "cs" ? [5, 65] : [5, 30];
    if (pts.length) { lo = Math.min(lo, ...pts); hi = Math.max(hi, ...pts); }
  }
  const f = log ? v => Math.log(Math.max(v, 1e-9)) : v => v;
  const X = v => Math.max(0, Math.min(width - 1, Math.round((f(v) - f(lo)) / (f(hi) - f(lo)) * (width - 1))));
  const top = Array(width).fill(" ").map(ch => [ch, null]);
  const mid = Array(width).fill(null).map(() => ["─", c.dim]);
  const bot = Array(width).fill(" ");
  st.quotes.forEach(q => { for (let i = X(q.bid); i <= X(q.ask); i++) mid[i] = ["┄", c.dim]; });
  if (live) {
    for (let i = X(live.bid); i <= X(live.ask); i++) mid[i] = ["━", c.blue];
    mid[X(live.bid)] = ["[", bid]; mid[X(live.ask)] = ["]", ask];
  }
  st.trades.forEach(t => {
    const i = X(t.price);
    const mark = (t.side === "buy" ? "▲" : "▼") + (t.round + 1);
    for (let k = 0; k < mark.length && i + k < width; k++) top[i + k] = [mark[k], t.side === "buy" ? ask : bid];
  });
  const label = (v, s) => { const i = Math.max(0, Math.min(width - s.length, X(v) - Math.floor(s.length / 2))); for (let k = 0; k < s.length; k++) bot[i + k] = s[k]; };
  const ticks = log ? [lo * 1.1, Math.sqrt(lo * hi), hi / 1.1].map(sig2) : [lo, (lo + hi) / 2, hi].map(Math.round);
  ticks.forEach(v => { if (truthVal === undefined || truthVal === null || Math.abs(X(v) - X(truthVal)) > 8) label(v, fmt(v)); });
  if (truthVal !== undefined && truthVal !== null) { mid[X(truthVal)] = ["★", c.yellow]; label(truthVal, fmt(truthVal)); }
  const ser = arr => arr.map(([ch, col]) => col ? col(ch) : ch).join("");
  return [ser(top), ser(mid), c.dim(bot.join(""))];
}
function sig2(v) { if (v <= 0) return v; const p = Math.pow(10, Math.floor(Math.log10(v)) - 1); return Math.round(v / p) * p; }

// ---------------- state ----------------
const S = {
  screen: "menu", run: null, phase: "quote", fields: { bid: "", ask: "", active: "bid" },
  verdict: null, err: "", hint: false, banner: null, claude: C.claudeSummary(), prev: {},
  stats: C.readJSON(C.FILES.stats, null) || R.emptyStats(), origin: null, cc: false, recorded: false
};

function setFieldsFrom(q) {
  S.fields.bid = q ? fmtInput(q.bid) : "";
  S.fields.ask = q ? fmtInput(q.ask) : "";
  S.fields.active = q ? "ask" : "bid";
}
function fmtInput(v) {
  if (Math.abs(v) >= 1000) return String(Math.round(v));
  return String(Math.round(v * 100) / 100);
}
function parsed() {
  const b = UI.parseNum(S.fields.bid), a = UI.parseNum(S.fields.ask);
  const okBid = S.run && S.run.kind === "nm" ? b > 0 : b >= 0;
  return { bid: b, ask: a, ok: okBid && a > b && isFinite(a) && isFinite(b) };
}

// Each game keeps its own unfinished market, so switching never throws one away.
function saves() {
  const sv = C.readJSON(C.FILES.save, null);
  if (!sv || typeof sv !== "object") return {};
  if (sv.kind) return { [sv.kind]: sv }; // single-market format from before switching existed
  return sv;
}
function writeSaves(all) {
  if (Object.keys(all).length) C.writeJSON(C.FILES.save, all);
  else { try { fs.unlinkSync(C.FILES.save); } catch (e) { /* none */ } }
}
function save() {
  if (!S.run) return;
  const all = saves();
  if (R.done(S.run)) delete all[S.run.kind]; else all[S.run.kind] = R.serialise(S.run);
  writeSaves(all);
}
function roundOf(sv) { return sv.actions.filter(a => a.t === "quote").length + 1; }

function startRun(kind) {
  S.run = R.create(kind, S.stats.recent);
  S.stats.lastKind = kind;
  S.screen = "game"; S.phase = "quote"; S.verdict = null; S.err = ""; S.recorded = false;
  setFieldsFrom(null);
  save();
}
function resume(kind) {
  const all = saves();
  kind = kind || (all[S.stats.lastKind] ? S.stats.lastKind : Object.keys(all)[0]);
  const sv = kind && all[kind];
  if (!sv) return false;
  try { S.run = R.build(sv); } catch (e) { delete all[kind]; writeSaves(all); return false; }
  S.stats.lastKind = kind;
  S.screen = "game"; S.phase = "quote"; S.verdict = null; S.err = ""; S.recorded = false;
  setFieldsFrom(R.lastQuote(S.run));
  return true;
}
// A market whose last round was quoted but not yet settled on screen still counts.
function settleIfDone() { if (S.run && R.done(S.run) && !S.recorded) advance(); }

function switchTo(kind) {
  if (S.screen === "game" && S.run && S.run.kind === kind && S.phase !== "result") return;
  settleIfDone();
  save();
  if (!resume(kind)) startRun(kind);
  C.writeJSON(C.FILES.stats, S.stats);
}
function nextKind() {
  const i = S.run ? R.ORDER.indexOf(S.run.kind) : -1;
  return R.ORDER[(i + 1) % R.ORDER.length];
}

// ---------------- rendering ----------------
let W = 80, H = 24;
function dims() {
  W = Math.max(40, Math.min(process.stdout.columns || 80, 88));
  H = Math.max(12, process.stdout.rows || 24);
}

function claudeBadge() {
  const s = S.claude, now = Date.now();
  if (s.waiting.length) return c.red("! Claude needs you · " + C.project(s.waiting[0].cwd));
  if (s.busy.length) {
    const x = s.busy[0];
    return c.yellow("● Claude working " + C.clock(now - (x.since || now)) + " · " + C.project(x.cwd) + (s.busy.length > 1 ? " +" + (s.busy.length - 1) : ""));
  }
  if (s.done.length && now - (s.done[0].finished || 0) < 30 * 60000) return c.green("✓ Claude done · " + C.project(s.done[0].cwd));
  return c.dim("○ no Claude session");
}

function header() {
  const left = c.bold(c.blue(" QUANTEST"));
  const right = claudeBadge() + " ";
  const until = C.pausedUntil();
  let l = left + (until ? c.yellow("  ⏸ auto-open off till " + C.hhmm(until)) : "");
  if (W - vlen(l) - vlen(right) < 1) l = left + (until ? c.yellow(" ⏸ " + C.hhmm(until)) : "");
  if (W - vlen(l) - vlen(right) < 1) l = left;
  const gap = W - vlen(l) - vlen(right);
  const lines = [(gap >= 1 ? l + " ".repeat(gap) : "") + right];
  if (S.screen === "game") lines.push(tabBar());
  lines.push(c.dim("─".repeat(W)));
  if (S.banner) {
    const b = S.banner;
    const secs = b.deadline ? Math.max(0, Math.ceil((b.deadline - Date.now()) / 1000)) : null;
    let text = b.kind === "waiting" ? " ! Claude needs your permission in " + b.project : " ✓ Claude finished in " + b.project + (b.took ? " (" + b.took + ")" : "");
    text += secs !== null ? " · back in " + secs + "s · any key to stay" : " · esc to go back";
    if (vlen(text) > W) text = text.slice(0, W - 1) + "…";
    lines.push((b.kind === "waiting" ? c.bgRed : c.bgGreen)(padR(text, W)));
  }
  if (S.flash && Date.now() < S.flash.until) wrap(S.flash.text, W - 2).forEach(t => lines.push(c.bgYellow(padR(" " + t, W))));
  return lines;
}

// One line, always visible in a game: the three games, the current one highlighted,
// a dot on any with a market waiting, and the key that switches.
const SHORT = { nm: "Numbers", cs: "Cards", dl: "Dice" };
function tabBar() {
  const all = saves();
  const cur = S.run && S.run.kind;
  const typing = S.phase === "quote";
  const hint = typing ? "s switch" : "1-3 or s switch";
  const build = names => R.ORDER.map((k, i) => {
    const waiting = k !== cur && all[k] && all[k].actions.length > 0; // untouched markets aren't flagged
    const label = " " + (i + 1) + " " + names(k) + (waiting ? " ·r" + roundOf(all[k]) : "") + " ";
    return k === cur ? c.bgBlue(c.bold(label)) : waiting ? c.yellow(label) : c.dim(label);
  }).join(" ");
  let tabs = build(k => R.GAMES[k].title);
  if (vlen(tabs) + vlen(hint) + 2 > W) tabs = build(k => SHORT[k]);
  const showHint = vlen(tabs) + vlen(hint) + 2 <= W;
  return tabs + (showHint ? " ".repeat(W - vlen(tabs) - vlen(hint) - 1) + c.dim(hint) : "");
}

function screen() {
  dims();
  const body = S.screen === "menu" ? menuBody() : S.phase === "result" ? resultBody() : gameBody();
  const foot = footer();
  const top = header();
  const room = H - top.length - foot.length;
  const lines = top.concat(body.slice(0, Math.max(0, room)));
  while (lines.length < H - foot.length) lines.push("");
  return lines.concat(foot);
}

function render() {
  if (!process.stdout.isTTY) return;
  const lines = screen();
  process.stdout.write("\x1b[H" + lines.map(l => l + "\x1b[K").join("\r\n") + "\x1b[J");
}

function menuBody() {
  const out = [""];
  const all = saves();
  R.ORDER.forEach((k, i) => {
    const g = R.GAMES[k], st = S.stats.games[k] || { n: 0, sum: 0 };
    const avg = st.n ? (k === "nm" ? pct(st.sum / st.n) : signed(st.sum / st.n) + " pts") + " avg over " + st.n : "not played yet";
    out.push("  " + c.bold(c.blue(String(i + 1))) + "  " + padR(c.bold(g.title), 18) + c.dim(g.blurb));
    out.push("      " + c.dim(avg) + (all[k] && all[k].actions.length ? c.yellow("  · market open, round " + roundOf(all[k])) : ""));
  });
  out.push("");
  const k0 = all[S.stats.lastKind] ? S.stats.lastKind : Object.keys(all)[0];
  if (k0) out.push("  " + c.bold("enter") + "  carry on with " + R.GAMES[k0].title.toLowerCase() + " (round " + roundOf(all[k0]) + ")");
  out.push("");
  out.push("  " + c.yellow("XP " + (S.stats.xp || 0)));
  return out;
}

function quoteBlock(run) {
  const p = parsed();
  const active = S.phase === "quote";
  const box = (name, val, col) => {
    const on = active && S.fields.active === name;
    const label = name === "bid" ? "BID" : "ASK";
    const shown = val + (on ? c.inv(" ") : "");
    return (on ? col(c.bold("▸ " + label)) : c.dim("  " + label)) + "  " + padR(on ? col(c.bold(shown)) : (val ? col(val) : c.dim("–")), W < 60 ? 9 : 14);
  };
  const out = ["  " + box("bid", S.fields.bid, bid) + (W < 60 ? " " : "   ") + box("ask", S.fields.ask, ask)];
  if (p.ok) {
    const m = (p.bid + p.ask) / 2;
    out.push(c.dim("  mid " + fmt(m) + " · width " + fmt(p.ask - p.bid) + (run.kind === "nm" ? " · " + ((p.ask - p.bid) / m * 100).toFixed(0) + "% of mid" : " pts")));
  } else out.push(c.dim(S.err || (S.fields.bid && S.fields.ask ? "  ask must be above bid" : "  type a number: 150, 2.5k, 1.2m, 3bn")));
  return out;
}

function tradeLog(run, revealed) {
  const st = run.eng.state, out = [];
  const narrow = W < 70;
  st.quotes.forEach(q => {
    const rt = st.trades.filter(t => t.round === q.round);
    const head = "  " + c.dim(String(q.round + 1)) + "  " + padR(bid(fmt(q.bid)), 8) + c.dim("/ ") + padR(ask(fmt(q.ask)), 8);
    const items = rt.map(t => {
      const who = revealed ? (t.who === "informed" ? (run.kind === "nm" ? "analyst" : run.kind === "cs" ? "peeker" : "insider") : "noise") : "trader";
      const what = (t.side === "buy" ? ask("▲ lifted at ") : bid("▼ hit at ")) + fmt(t.price) + c.dim(" · " + who);
      return what + (revealed && t.pnl !== undefined ? "  " + (t.pnl >= 0 ? c.green : c.red)(run.kind === "nm" ? pct(t.pnl) : signed(t.pnl)) : "");
    });
    if (!items.length) { out.push(head + c.dim("no trade")); return; }
    if (narrow) { out.push(head); items.forEach(it => out.push("     " + it)); }
    else items.forEach((it, i) => out.push((i ? " ".repeat(vlen(head)) : head) + it));
  });
  return out;
}

function situation(run) {
  const st = run.eng.state, out = [];
  if (run.kind === "nm") {
    wrap(st.fact.q, W - 4).forEach(l => out.push("  " + c.bold(l)));
    wrap((st.fact.unit ? st.fact.unit + " · " : "") + (st.round === 0 ? "the analyst trades on a rough estimate that sharpens every round" : "re-quote: the analyst knows more each round, exactly on the last"), W - 4).forEach(l => out.push(c.dim("  " + l)));
  } else if (run.kind === "cs") {
    out.push("  " + c.bold("What is the sum of these five cards?"));
    wrap("A=1, J=11, Q=12, K=13. One flips each round; someone at the table has seen two of the hidden ones.", W - 4).forEach(l => out.push(c.dim("  " + l)));
    out.push("");
    out.push("  " + st.hand.map((cd, i) => i < st.shown || st.done ? ((cd.s === 1 || cd.s === 2) ? c.red : c.bold)(padR(R.cardLabel(cd), 4)) : c.dim("▒▒  ")).join(" "));
    if (S.hint) { const fv = R.fairValue(run); out.push(c.cyan("  fair value from what you can see: " + fv.mean.toFixed(1) + " ± " + fv.sd.toFixed(1))); }
  } else {
    const faces = ["⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
    out.push("  " + c.bold("What is the sum of these five dice?"));
    wrap("Nothing flips on its own. A peek costs " + run.eng.PEEK_FEE + " points; your counterparty already knows two.", W - 4).forEach(l => out.push(c.dim("  " + l)));
    out.push("");
    out.push("  " + st.dice.map((d, i) => st.peeked.indexOf(i) >= 0 || st.done ? c.bold(faces[d - 1] + " " + d) : c.dim("? ?")).join("   ") + c.yellow("    fees " + st.fees.toFixed(1)));
    const fv = R.fairValue(run);
    out.push(c.cyan("  given what you can see: " + fv.mean.toFixed(1) + " ± " + fv.sd.toFixed(1)));
  }
  return out;
}

function gameBody() {
  const run = S.run, st = run.eng.state;
  const p = parsed();
  const rounds = st.rounds;
  const r = Math.min(st.round + (S.phase === "fills" ? 0 : 1), rounds);
  const out = [c.dim("  round " + r + " of " + rounds + (run.kind === "nm" ? " · " + (st.fact.cat || "") : "")), ""];
  situation(run).forEach(l => out.push(l));
  out.push("");
  ladder(W - 4, run, S.phase === "quote" && p.ok ? p : R.lastQuote(run), null).forEach(l => out.push("  " + l));
  out.push("");
  if (st.quotes.length) { tradeLog(run, false).forEach(l => out.push(l)); out.push(""); }
  quoteBlock(run).forEach(l => out.push(l));
  if (S.verdict) {
    out.push("");
    wrap(S.verdict.title, W - 4).forEach(l => out.push("  " + (S.verdict.tone === "ok" ? c.green : c.yellow)(c.bold(l))));
    wrap(S.verdict.sub, W - 4).forEach(l => out.push("  " + c.dim(l)));
  }
  return out;
}

function resultBody() {
  const run = S.run, st = run.eng.state, T = R.truth(run), sc = R.score(run);
  const pos = sc >= 0;
  const out = [""];
  const big = run.kind === "nm" ? pct(sc) : signed(sc) + " pts";
  const sub = run.kind === "nm" ? "  P&L as a share of the true value" : run.kind === "dl" ? "  after " + st.fees.toFixed(1) + " in peek fees" : "  points across your fills";
  out.push("  " + (pos ? c.bgGreen : c.bgRed)(" " + big + " ") + (big.length + 4 + sub.length <= W ? c.dim(sub) : ""));
  out.push("");
  if (run.kind === "nm") {
    out.push("  " + c.yellow(c.bold("THE NUMBER  " + UI.fmt(T, { compact: false }) + (st.fact.unit ? " " + st.fact.unit : ""))));
    wrap(st.fact.note || "", W - 4).forEach(l => out.push("  " + c.dim(l)));
  } else {
    out.push(situation(run).find(l => /▒|[♠♥♦♣]|[⚀-⚅]/.test(l.replace(/\x1b\[[0-9;]*m/g, ""))));
    out.push("  " + c.yellow(c.bold("THE SUM  " + T)));
  }
  out.push("");
  ladder(W - 4, run, R.lastQuote(run), T).forEach(l => out.push("  " + l));
  out.push("");
  const width = run.kind === "nm" ? st.finalWidthPct.toFixed(0) + "% wide vs truth" : "noise captured " + (st.noise || 0);
  out.push("  " + (st.containsFinal ? c.green("contained it") : c.red("missed it")) + c.dim(" · ") + width + c.dim(" · ") + c.yellow("+" + st.xp + " xp"));
  out.push("");
  // verdict and coaching go above the trade log so a short window never cuts them off
  const idle = !st.trades.length;
  const verdict = st.blownUp ? "Blown up." : idle ? "Flat. Nobody traded with you." : pos ? (run.kind === "nm" ? "Profitable market." : run.kind === "cs" ? "Profitable table." : "Information paid for itself.") : (run.kind === "nm" ? "You paid the informed trader." : run.kind === "cs" ? "The peeker got you." : "You paid for information and still lost.");
  const tip = idle ? "Safe, but a market nobody trades earns nothing. Noise flow is the only source of profit: keep the truth inside your market and tighten until flow arrives." : R.tip(run);
  out.push("  " + (idle ? c.yellow : pos ? c.green : c.red)(c.bold(verdict)));
  wrap(tip, W - 4).forEach(l => out.push("  " + c.dim(l)));
  out.push("");
  tradeLog(run, true).forEach(l => out.push(l));
  return out;
}

function footer() {
  const back = S.origin && (S.origin.pane || S.origin.app) ? "back to Claude" : "quit";
  const z = ["z", C.pausedUntil() ? "unpause" : "pause " + C.mins(C.config().pauseFor)];
  let keys;
  if (S.screen === "menu") keys = [["1-3", "play"], ["enter", "carry on"], z, ["esc", back]];
  else if (S.phase === "quote") {
    keys = [["enter", "quote"], ["tab", "bid/ask"], ["↑↓", S.run.kind === "nm" ? "±10%" : "±1"], ["[ ]", "wider/tighter"], ["< >", "shift"]];
    if (S.run.kind === "dl") keys.push(["p", "peek"]);
    if (S.run.kind === "cs") keys.push(["?", "fair value"]);
    keys.push(["s", "switch game"], z, ["esc", back]);
  } else if (S.phase === "fills") keys = [["enter", R.done(S.run) ? "settle" : "next round"], ["1-3 s", "switch game"], z, ["esc", back]];
  else keys = [["enter", "next market"], ["1-3 s", "switch game"], ["m", "menu"], z, ["esc", back]];
  const lines = [""]; let plain = 0;
  keys.forEach(([k, d]) => {
    const n = k.length + d.length + 3;
    if (plain && plain + n > W - 1) { lines.push(""); plain = 0; }
    lines[lines.length - 1] += " " + c.bold(k) + " " + c.dim(d) + " ";
    plain += n;
  });
  return [c.dim("─".repeat(W))].concat(lines);
}

// ---------------- actions ----------------
function nudge(field, dir) {
  const v = UI.parseNum(S.fields[field]);
  if (isNaN(v)) return;
  const nv = S.run.kind === "nm" ? v * (1 + 0.1 * dir) : v + dir;
  S.fields[field] = fmtInput(Math.max(0, nv));
}
function both(fb, fa) { nudgeBy("bid", fb); nudgeBy("ask", fa); }
function nudgeBy(field, step) {
  const v = UI.parseNum(S.fields[field]);
  if (isNaN(v)) return;
  S.fields[field] = fmtInput(Math.max(0, S.run.kind === "nm" ? v * (1 + step) : v + step * 10));
}

function submit() {
  const p = parsed();
  if (!p.ok) { S.err = "  ask must be above bid" + (S.run.kind === "nm" ? ", both above zero" : ""); return; }
  const res = R.quote(S.run, p.bid, p.ask);
  save();
  const trades = res.events.filter(e => e.side !== "pass");
  const word = S.run.kind === "nm" ? "number" : "sum";
  if (!trades.length) S.verdict = { tone: "ok", title: "No trade. Your market held.", sub: "Nobody thought your market was wrong enough to trade, or it was too wide to bother with." };
  else {
    const t = trades[0], pos = R.position(S.run);
    const posWord = pos === 0 ? "flat" : (pos > 0 ? "long " : "short ") + Math.abs(pos);
    const sides = new Set(trades.map(x => x.side));
    if (sides.size === 2) {
      // one trader hit the bid, another lifted the offer: a round trip through the spread
      const p = R.lastQuote(S.run);
      S.verdict = {
        tone: "ok",
        title: "Both sides traded: bought at " + fmt(p.bid) + ", sold at " + fmt(p.ask) + ".",
        sub: "That round trip earns you the " + fmt(p.ask - p.bid) + " spread. At most one of them was the informed trader; the other was flow. You're " + posWord + "."
      };
    } else {
      S.verdict = {
        tone: "warn",
        title: (trades.length > 1 ? "Two traders " + (t.side === "buy" ? "lifted your offer" : "hit your bid") + " at " : t.side === "buy" ? "Someone lifted your offer at " : "Someone hit your bid at ") + fmt(t.price) + ".",
        sub: (t.side === "buy" ? (trades.length > 1 ? "Buyers think" : "A buyer thinks") + " the " + word + " is higher than your ask." : (trades.length > 1 ? "Sellers think" : "A seller thinks") + " the " + word + " is lower than your bid.") + " You're " + posWord + "."
      };
    }
  }
  S.phase = "fills";
}

function advance() {
  if (R.done(S.run)) {
    S.phase = "result";
    if (!S.recorded) {
      S.stats = R.record(S.stats, S.run);
      S.recorded = true;
      C.writeJSON(C.FILES.stats, S.stats);
      save();
    }
  } else { S.phase = "quote"; S.verdict = null; S.err = ""; S.fields.active = "ask"; }
}

// ---------------- keys ----------------
function onKey(key) {
  if (key === "\x03" || key === "\x1b") return back();
  if (S.banner && S.banner.deadline) { S.banner.deadline = null; render(); return; } // any other key: stay
  if (key === "z" || key === "Z") return togglePause(); // z is never part of a number
  if (S.screen === "menu") {
    if (/^[123]$/.test(key)) switchTo(R.ORDER[+key - 1]);
    else if (key === "s") switchTo(S.stats.lastKind || "nm");
    else if (key === "\r" && !resume()) startRun(S.stats.lastKind || "nm");
    else if (key === "q") return back();
    return render();
  }
  // s switches from anywhere (it is never part of a number); 1-3 jump when nothing is being typed
  if (key === "s" || key === "S") { switchTo(nextKind()); return render(); }
  if (S.phase === "result") {
    if (key === "\r" || key === " ") startRun(S.run.kind);
    else if (key === "m") { S.screen = "menu"; S.run = null; }
    else if (/^[123]$/.test(key)) switchTo(R.ORDER[+key - 1]);
    return render();
  }
  if (S.phase === "fills") {
    if (key === "\r" || key === " ") advance();
    else if (/^[123]$/.test(key)) switchTo(R.ORDER[+key - 1]);
    return render();
  }
  // quote phase
  const f = S.fields.active;
  S.err = "";
  if (/^[0-9.,kmbtn]$/i.test(key)) { if (S.fields[f].length < 14) S.fields[f] += key.toLowerCase(); }
  else if (key === "\x7f" || key === "\b") S.fields[f] = S.fields[f].slice(0, -1);
  else if (key === "\t" || key === "\x1b[C" || key === "\x1b[D" || key === "\x1b[Z") S.fields.active = f === "bid" ? "ask" : "bid";
  else if (key === "\r") { if (f === "bid") S.fields.active = "ask"; else submit(); }
  else if (key === "\x1b[A") nudge(f, 1);
  else if (key === "\x1b[B") nudge(f, -1);
  else if (key === "[") both(-0.05, 0.05);
  else if (key === "]") { const p = parsed(); if (p.ok && (S.run.kind === "nm" ? p.ask / p.bid > 1.12 : p.ask - p.bid > 1)) both(0.05, -0.05); }
  else if (key === "<") both(-0.1, -0.1);
  else if (key === ">") both(0.1, 0.1);
  else if (key === "p" && S.run.kind === "dl") { if (R.peek(S.run) === null) S.err = "  every die is already showing"; save(); }
  else if (key === "?" && S.run.kind === "cs") S.hint = !S.hint;
  render();
}

function splitKeys(data) {
  // a chunk can hold several keypresses (fast typing, paste); split escape sequences out
  const out = [];
  let i = 0;
  while (i < data.length) {
    if (data[i] === "\x1b" && data[i + 1] === "[" && i + 2 < data.length) { out.push(data.slice(i, i + 3)); i += 3; }
    else if (data[i] === "\x1b" && data[i + 1] === "O" && i + 2 < data.length) { out.push("\x1b[" + data[i + 2]); i += 3; }
    else { out.push(data[i]); i += 1; }
  }
  return out;
}

// ---------------- Claude status ----------------
function hasReturn() { return !!(S.origin && (S.origin.pane || S.origin.app)); }

function poll(initial) {
  S.claude = C.claudeSummary();
  const now = {};
  S.claude.list.forEach(x => { now[x.id] = x.status; });
  if (!initial) {
    S.claude.list.forEach(x => {
      const was = S.prev[x.id];
      if (x.status === "done" && was && was !== "done") alert("done", x);
      else if (x.status === "waiting" && was !== "waiting") alert("waiting", x);
    });
    if (S.banner && S.claude.busy.length && !S.claude.waiting.length && !S.banner.deadline) S.banner = null; // Claude is off again
  }
  S.prev = now;
}

function alert(kind, x) {
  process.stdout.write("\x07");
  const cfg = C.config();
  const took = x.finished && x.since ? C.clock(x.finished - x.since) : null;
  S.banner = { kind, project: C.project(x.cwd), took, deadline: hasReturn() && cfg.returnAfter > 0 ? Date.now() + cfg.returnAfter * 1000 : null };
  // tmux: if the person is looking at another pane, ring that client too
  if (process.env.TMUX) require("child_process").spawn("tmux", ["display-message", (kind === "waiting" ? "Claude needs you" : "Claude finished") + " · " + S.banner.project], { stdio: "ignore" }).on("error", () => {});
}

// ---------------- lifecycle ----------------
let leaving = false;
function restoreTerminal() {
  if (!process.stdout.isTTY) return;
  process.stdout.write("\x1b[?25h\x1b[?1049l");
  try { process.stdin.setRawMode(false); } catch (e) { /* not a tty */ }
}
function dropGameFile() {
  const g = C.readJSON(C.FILES.game, null);
  if (g && g.pid === process.pid) { try { fs.unlinkSync(C.FILES.game); } catch (e) { /* gone */ } }
}

function flash(text, ms) { S.flash = { text, until: Date.now() + (ms || 4000) }; }

// z: stop the game opening on its own for a while and get out of the way. Claude tracking,
// notifications, and the jump back to Claude when it finishes all carry on.
function togglePause() {
  if (C.pausedUntil()) {
    C.unpause();
    flash("Unpaused. The game opens on its own again when Claude starts working.");
    return render();
  }
  const cfg = C.config();
  const until = C.pause(cfg.pauseFor);
  if (hasReturn()) return back(); // opened beside Claude: close and go back
  flash("Paused for " + C.mins(cfg.pauseFor) + ", until " + C.hhmm(until) + ". The game won't open on its own" + (cfg.pauseFocus ? "; you still get switched to Claude when it finishes." : "."), 6000);
  render();
}

// Leave: save the market, hand focus back to Claude, exit (the pane or window closes behind us).
function back() {
  if (leaving) return;
  if (!hasReturn() && process.env.TMUX && S.signalled) { S.signalled = false; require("child_process").spawnSync("tmux", ["last-pane"]); return; }
  leaving = true;
  settleIfDone();
  save();
  const g = C.readJSON(C.FILES.game, {}) || {};
  dropGameFile();
  restoreTerminal();
  if (hasReturn()) L.returnFocus(Object.assign({}, g, { origin: S.origin, via: g.via || S.origin.via }));
  process.exit(0);
}

function hangup() { if (leaving) return; leaving = true; save(); dropGameFile(); process.exit(0); }

function play(args) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) { console.error("quantest needs an interactive terminal"); process.exit(1); }
  const other = C.runningGame();
  if (other && other.pid !== process.pid) {
    if (L.focus(other)) { console.log("Quantest is already open; switched to it."); process.exit(0); }
    console.log("Quantest is already open in another terminal (pid " + other.pid + "). Close it first, or run qt --toggle.");
    process.exit(1);
  }
  S.cc = !!args.cc;
  if (args.origin) { try { S.origin = JSON.parse(Buffer.from(args.origin, "base64").toString("utf8")); } catch (e) { S.origin = null; } }
  const prev = C.readJSON(C.FILES.game, {}) || {};
  const via = S.origin && S.origin.via ? S.origin.via : (process.env.TMUX ? "tmux" : "here");
  C.writeJSON(C.FILES.game, Object.assign(prev.pid && !C.alive(prev.pid) ? {} : prev, { pid: process.pid, via, pane: process.env.TMUX_PANE, origin: S.origin, started: Date.now() }));

  if (S.cc) { if (!resume()) startRun(S.stats.lastKind || "nm"); }
  poll(true);

  process.stdout.write("\x1b[?1049h\x1b[?25l");
  process.stdin.setRawMode(true);
  process.stdin.setEncoding("utf8");
  process.stdin.resume();
  process.stdin.on("data", d => splitKeys(d).forEach(onKey));
  process.stdout.on("resize", render);
  process.on("SIGUSR2", () => { S.signalled = true; back(); });
  process.on("SIGHUP", hangup);
  process.on("SIGTERM", hangup);
  process.on("exit", restoreTerminal);
  process.on("uncaughtException", e => { restoreTerminal(); console.error(e && e.stack || e); save(); dropGameFile(); process.exit(1); });

  setInterval(() => {
    poll(false);
    if (S.banner && S.banner.deadline && Date.now() >= S.banner.deadline) return back();
    render();
  }, 500);
  render();
}

// ---------------- commands ----------------
function status() {
  const s = C.claudeSummary(), now = Date.now();
  const until = C.pausedUntil();
  if (until) console.log("paused until " + C.hhmm(until) + " (qt resume to undo)");
  if (!s.list.length) return console.log("No Claude Code sessions seen yet. Is the hook installed? (node cli/install.js)");
  s.list.forEach(x => {
    const age = x.status === "busy" || x.status === "waiting" ? C.clock(now - (x.since || now)) : "finished " + C.clock(now - (x.finished || x.updated)) + " ago";
    console.log(padR(x.status, 8) + " " + padR(C.project(x.cwd), 24) + age + (x.msg ? "  " + x.msg : ""));
  });
  const g = C.runningGame();
  console.log(g ? "game open (" + g.via + ", pid " + g.pid + ")" : "game closed");
}

function pauseCmd(arg) {
  const cfg = C.config();
  const m = arg === undefined ? cfg.pauseFor : C.parseMinutes(arg);
  if (!(m > 0)) { console.log("Give a time like 30m, 90, or 2h."); process.exit(1); }
  const until = C.pause(m);
  const g = C.runningGame();
  if (g) { try { process.kill(g.pid, "SIGTERM"); } catch (e) { /* already gone */ } } // its market is saved
  console.log("Paused for " + C.mins(m) + ", until " + C.hhmm(until) + ". The game won't open on its own" +
    (cfg.pauseFocus ? "; you still get switched back to Claude when it finishes." : ".") + " qt resume to undo.");
}

function toggle(args) {
  const game = C.runningGame();
  if (game) {
    if (L.isFocused(game, args.fromPane)) { process.kill(game.pid, "SIGUSR2"); return; }
    if (!L.focus(game)) console.log("Quantest is open (pid " + game.pid + ") but this terminal can't switch to it.");
    return;
  }
  const origin = args.fromPane ? { via: "tmux", pane: args.fromPane } : L.captureOrigin();
  if (origin.via === "none") return play({ _: [] });
  if (!L.open(origin)) console.log("Couldn't open a pane or window here. Run qt in a spare terminal instead.");
}

function showConfig() {
  console.log("settings: " + C.FILES.config + "\n");
  const cfg = C.config();
  Object.keys(C.DEFAULT_CONFIG).forEach(k => console.log("  " + padR(k, 12) + JSON.stringify(cfg[k])));
  console.log("\nlauncher in this terminal: " + L.detect());
}

const args = parseArgs(process.argv.slice(2));
if (require.main === module) {
  if (args.help) console.log(fs.readFileSync(__filename, "utf8").split("\n").slice(1, 11).map(l => l.replace(/^\/\/ ?/, "")).join("\n"));
  else if (args._[0] === "status") status();
  else if (args._[0] === "config") showConfig();
  else if (args._[0] === "pause") pauseCmd(args._[1]);
  else if (args._[0] === "resume" || args._[0] === "unpause") { const was = C.pausedUntil(); C.unpause(); console.log(was ? "Unpaused. The game opens on its own again." : "Wasn't paused."); }
  else if (args.toggle) toggle(args);
  else if (args.open) { if (!L.open(L.captureOrigin())) console.log("Couldn't open a pane or window here."); }
  else play(args);
}

module.exports = { S, screen, onKey, splitKeys, startRun, resume, switchTo, saves, ladder, parsed, setFieldsFrom, poll, dims };
