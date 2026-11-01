// Headless checks for the terminal client and the Claude Code integration. No tmux or TTY needed.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "quantest-cli-"));
process.env.QUANTEST_HOME = path.join(tmp, "qh");
delete process.env.CLAUDE_CODE_REMOTE;

let fails = 0;
function check(name, cond, extra) { if (!cond) { fails++; console.log("FAIL", name, extra === undefined ? "" : extra); } else console.log("ok  ", name); }

const R = require(path.join(ROOT, "cli/run.js"));
const C = require(path.join(ROOT, "cli/common.js"));

// ---- runs replay exactly from their saved actions ----
["nm", "cs", "dl"].forEach(kind => {
  const a = R.create(kind, []);
  if (kind === "dl") R.peek(a);
  const v = R.truth(a);
  const q = kind === "nm" ? [v * 0.5, v * 2] : [v - 6, v + 6];
  R.quote(a, q[0], q[1]);
  if (kind === "dl") R.peek(a);
  R.quote(a, q[0] + 1e-9, q[1]);
  const b = R.build(JSON.parse(JSON.stringify(R.serialise(a))));
  check(kind + " replay restores trades", JSON.stringify(a.eng.state.trades) === JSON.stringify(b.eng.state.trades));
  check(kind + " replay restores round", a.eng.state.round === b.eng.state.round && b.actions.length === a.actions.length);
  while (!R.done(b)) R.quote(b, q[0], q[1]);
  check(kind + " settles with a finite score", isFinite(R.score(b)));
  const stats = R.record(R.emptyStats(), b);
  check(kind + " stats recorded", stats.games[kind].n === 1 && stats.xp > 0);
  check(kind + " tip is a sentence", /\.$/.test(R.tip(b)));
});

const cs = R.build({ kind: "cs", seed: 1, actions: [] });
const fv = R.fairValue(cs);
check("card sum blind fair value is 35", Math.abs(fv.mean - 35) < 1e-9);
check("card sum blind sd near 8", fv.sd > 7.5 && fv.sd < 8.5, fv.sd.toFixed(2));
const dl = R.build({ kind: "dl", seed: 2, actions: [] });
check("dice blind fair value is 17.5", R.fairValue(dl).mean === 17.5);

let threw = false;
try { R.build({ kind: "nm", seed: 1, factId: "no-such-fact", actions: [] }); } catch (e) { threw = true; }
check("unknown fact rejected on resume", threw);

// ---- screens fit the terminal at any width ----
const Q = require(path.join(ROOT, "cli/quantest.js"));
const strip = s => s.replace(/\x1b\[[0-9;]*m/g, "");
let overflow = 0;
[44, 60, 80, 120].forEach(cols => {
  process.stdout.columns = cols; process.stdout.rows = 30;
  const W = Math.min(cols, 88);
  ["nm", "cs", "dl"].forEach(kind => {
    Q.startRun(kind);
    const keys = kind === "nm" ? ["1", "5", "0", "\t", "2", "5", "0"] : ["3", "0", "\t", "4", "0"];
    const screens = [];
    keys.forEach(Q.onKey); screens.push(Q.screen());
    Q.onKey("\r"); screens.push(Q.screen());
    let guard = 0; while (Q.S.phase !== "result" && guard++ < 40) Q.onKey("\r");
    screens.push(Q.screen());
    screens.forEach(lines => lines.forEach(l => { if (strip(l).length > W) overflow++; }));
  });
});
check("no screen line wider than the terminal", overflow === 0, overflow);
// ---- switching games keeps each market where you left it ----
process.stdout.columns = 80; process.stdout.rows = 30;
try { fs.unlinkSync(C.FILES.save); } catch (e) { /* none */ }
Q.startRun("nm");
const nmFact = Q.S.run.factId;
"100".split("").forEach(Q.onKey); Q.onKey("\t"); "900".split("").forEach(Q.onKey); Q.onKey("\r"); // quote round 1
Q.onKey("2");
check("1-3 jump to a game after a fill", Q.S.run.kind === "cs" && Q.S.phase === "quote");
"30".split("").forEach(Q.onKey); Q.onKey("\t"); "40".split("").forEach(Q.onKey); Q.onKey("\r");
Q.onKey("s"); Q.onKey("s");
check("s cycles through the games", Q.S.run.kind === "nm");
check("number market resumes on round 2 with the same question", Q.S.run.factId === nmFact && Q.S.run.eng.state.round === 1);
check("its last quote is prefilled", Q.S.fields.bid === "100" && Q.S.fields.ask === "900");
const sv = Q.saves();
check("each game keeps its own saved market", sv.nm && sv.cs && sv.cs.actions.length === 1);
const bar = strip(Q.screen()[1]);
check("tab bar shows all three games and the switch key", /Number markets/.test(bar) && /Card sum ·r2/.test(bar) && /Dice ladder/.test(bar) && /s switch/.test(bar), bar);
process.stdout.columns = 44;
const narrow = strip(Q.screen()[1]);
check("tab bar shortens on narrow terminals", narrow.length <= 44 && /Numbers/.test(narrow) && /Cards/.test(narrow), narrow);
fs.writeFileSync(C.FILES.save, JSON.stringify(sv.cs)); // old single-market save file
check("old single-market saves still load", Q.saves().cs && Q.saves().cs.seed === sv.cs.seed);

check("key splitter separates arrows from typing", JSON.stringify(Q.splitKeys("12\x1b[A\t")) === JSON.stringify(["1", "2", "\x1b[A", "\t"]));

// ---- pause: z in the game and qt pause / resume ----
check("parse 90 as minutes", C.parseMinutes("90") === 90 && C.parseMinutes("1.5h") === 90 && C.parseMinutes("30m") === 30 && isNaN(C.parseMinutes("soon")));
check("durations read naturally", C.mins(60) === "1h" && C.mins(30) === "30m" && C.mins(90) === "1h30m");
C.unpause();
process.stdout.columns = 80;
Q.onKey("z");
check("z pauses auto-open for the configured hour", Math.abs(C.pausedUntil() - (Date.now() + 60 * 60000)) < 5000);
check("game shows it is paused", /auto-open off till \d\d:\d\d/.test(strip(Q.screen()[0])), strip(Q.screen()[0]));
check("footer offers unpause", Q.screen().some(l => /z unpause/.test(strip(l))));
Q.onKey("z");
check("z again unpauses", C.pausedUntil() === 0);
const qt = a => spawnSync(process.execPath, [path.join(ROOT, "cli/quantest.js")].concat(a), { encoding: "utf8", env: process.env });
let out = qt(["pause", "30m"]).stdout;
check("qt pause 30m pauses for half an hour", /Paused for 30m/.test(out) && Math.abs(C.pausedUntil() - (Date.now() + 30 * 60000)) < 5000, out);
check("qt status reports the pause", /paused until/.test(qt(["status"]).stdout));
out = qt(["resume"]).stdout;
check("qt resume unpauses", /Unpaused/.test(out) && C.pausedUntil() === 0, out);
check("qt pause rejects nonsense", qt(["pause", "later"]).status === 1);

// ---- the hook keeps per-session status and never writes to stdout ----
C.writeJSON(C.FILES.config, Object.assign({}, C.DEFAULT_CONFIG, { launcher: "none", openAfter: 0, notify: false }));
function hook(ev, extra) {
  const input = JSON.stringify(Object.assign({ hook_event_name: ev, session_id: "s1", cwd: "/tmp/proj" }, extra || {}));
  const r = spawnSync(process.execPath, [path.join(ROOT, "cli/hook.js")], { input, encoding: "utf8", env: Object.assign({}, process.env, { TMUX: "", TMUX_PANE: "" }) });
  return r;
}
const status = () => (C.readJSON(C.FILES.claude, { sessions: {} }).sessions.s1 || {}).status;
let r = hook("UserPromptSubmit");
check("prompt hook prints nothing (stdout would reach Claude)", r.stdout === "" && r.status === 0, JSON.stringify(r.stdout));
check("prompt marks the session busy", status() === "busy");
hook("Notification", { notification_type: "idle_prompt", message: "Claude is waiting for your input" });
check("idle notification is ignored", status() === "busy");
hook("Notification", { notification_type: "permission_prompt", message: "Claude needs your permission to use Bash" });
check("permission prompt marks it waiting", status() === "waiting");
hook("PostToolUse", { tool_name: "Bash" });
check("tool use after approval marks it busy again", status() === "busy");
r = hook("Stop");
check("stop marks it done", status() === "done" && r.stdout === "");
check("summary sees the finished session", C.claudeSummary().done.length === 1 && C.claudeSummary().done[0].cwd === "/tmp/proj");
C.pause(60);
hook("UserPromptSubmit"); 
check("while paused, Claude is still tracked", status() === "busy");
r = hook("Stop");
check("while paused, stop still marks done and prints nothing", status() === "done" && r.stdout === "" && r.status === 0);
C.unpause();
hook("SessionEnd", { reason: "prompt_input_exit" });
check("session end forgets it", status() === undefined);

// ---- installer merges into settings.json, is idempotent, and uninstalls cleanly ----
const home = path.join(tmp, "home");
const cdir = path.join(home, ".claude");
fs.mkdirSync(cdir, { recursive: true });
const theirs = { model: "opus", hooks: { Stop: [{ hooks: [{ type: "command", command: "say done" }] }], PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "guard.sh" }] }] } };
fs.writeFileSync(path.join(cdir, "settings.json"), JSON.stringify(theirs));
const ienv = Object.assign({}, process.env, { HOME: home, CLAUDE_CONFIG_DIR: cdir, PATH: path.join(home, ".local", "bin") + path.delimiter + process.env.PATH });
const install = flags => spawnSync(process.execPath, [path.join(ROOT, "cli/install.js"), "--no-tmux"].concat(flags || []), { env: ienv, encoding: "utf8" });
install(); install();
const s = JSON.parse(fs.readFileSync(path.join(cdir, "settings.json"), "utf8"));
const ours = ev => (s.hooks[ev] || []).filter(g => g.hooks.some(h => /cli\/hook\.js/.test(h.command))).length;
check("installer adds each hook once, even run twice", ["UserPromptSubmit", "PostToolUse", "Notification", "Stop", "SessionEnd"].every(ev => ours(ev) === 1));
check("installer keeps your own hooks and settings", s.model === "opus" && s.hooks.Stop.some(g => g.hooks[0].command === "say done") && s.hooks.PreToolUse.length === 1);
check("our hooks are async", s.hooks.Stop.filter(g => /cli\/hook\.js/.test(g.hooks[0].command)).every(g => g.hooks[0].async === true));
check("qt command installed", fs.existsSync(path.join(home, ".local", "bin", "qt")));
install(["--uninstall"]);
const u = JSON.parse(fs.readFileSync(path.join(cdir, "settings.json"), "utf8"));
check("uninstall removes only ours", JSON.stringify(u) === JSON.stringify(theirs), JSON.stringify(u));
check("uninstall removes qt", !fs.existsSync(path.join(home, ".local", "bin", "qt")));

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? ("\n" + fails + " FAILURES") : "\nall checks passed");
process.exit(fails ? 1 : 0);
