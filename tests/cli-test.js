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
check("key splitter separates arrows from typing", JSON.stringify(Q.splitKeys("12\x1b[A\t")) === JSON.stringify(["1", "2", "\x1b[A", "\t"]));

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
