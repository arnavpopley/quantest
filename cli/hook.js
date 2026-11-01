#!/usr/bin/env node
// Claude Code hook. Registered (async, so it never slows Claude down) for:
//   UserPromptSubmit  Claude starts working: mark busy, open the game if the turn runs long
//   PostToolUse       heartbeat; flips "waiting" back to "busy" after a permission prompt
//   Notification      permission prompt: mark waiting and notify
//   Stop              Claude finished: mark done and notify (the open game counts down and returns)
//   SessionEnd        forget the session
// It must never print to stdout: on UserPromptSubmit, stdout is added to Claude's context.
"use strict";
const fs = require("fs");
const C = require("./common");
const L = require("./launch");

function readStdin() {
  return new Promise(resolve => {
    let buf = "";
    const done = () => { try { resolve(JSON.parse(buf || "{}")); } catch (e) { resolve({}); } };
    if (process.stdin.isTTY) return resolve({});
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", d => { buf += d; });
    process.stdin.on("end", done);
    setTimeout(done, 1500);
  });
}

function log(msg) {
  try {
    C.ensureHome();
    const st = fs.existsSync(C.FILES.log) ? fs.statSync(C.FILES.log) : null;
    if (st && st.size > 200000) fs.writeFileSync(C.FILES.log, "");
    fs.appendFileSync(C.FILES.log, new Date().toISOString() + " " + msg + "\n");
  } catch (e) { /* never fail a hook over logging */ }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function takeLock() {
  try { fs.writeFileSync(C.FILES.lock, String(process.pid), { flag: "wx" }); return true; }
  catch (e) {
    try { if (Date.now() - fs.statSync(C.FILES.lock).mtimeMs > 30000) { fs.unlinkSync(C.FILES.lock); return takeLock(); } } catch (e2) { /* raced */ }
    return false;
  }
}
function dropLock() { try { fs.unlinkSync(C.FILES.lock); } catch (e) { /* gone */ } }

async function onPrompt(input, cfg) {
  const sid = input.session_id || "default";
  const turn = Math.random().toString(36).slice(2);
  const now = Date.now();
  const paused = C.pausedUntil() > 0;
  // where Claude is, so the game (or, while paused, the focus jump) can come back to it
  const origin = (cfg.autoOpen && !paused && !C.runningGame()) || (paused && cfg.pauseFocus) ? L.captureOrigin() : { pane: process.env.TMUX_PANE };
  C.updateClaude(s => {
    s.sessions[sid] = { status: "busy", since: now, updated: now, cwd: input.cwd || process.cwd(), turn, pane: origin.pane, origin };
    return s;
  });
  if (paused || !cfg.autoOpen || origin.via === "none") return;
  await sleep(Math.max(0, cfg.openAfter) * 1000);
  const cur = (C.readJSON(C.FILES.claude, { sessions: {} }).sessions || {})[sid];
  if (!cur || cur.turn !== turn || cur.status !== "busy") return; // quick reply, or a newer prompt took over
  if (C.runningGame() || C.pausedUntil()) return; // paused during the wait
  if (!takeLock()) return;
  try {
    if (C.runningGame()) return;
    const r = L.open(origin);
    log("open " + JSON.stringify(r));
  } finally { setTimeout(dropLock, 3000); await sleep(3100); }
}

function onToolUse(input) {
  const sid = input.session_id || "default";
  const cur = (C.readJSON(C.FILES.claude, { sessions: {} }).sessions || {})[sid];
  if (cur && cur.status === "busy" && Date.now() - (cur.updated || 0) < 30000) return; // skip needless writes
  C.updateClaude(s => {
    const x = s.sessions[sid] || { since: Date.now(), cwd: input.cwd };
    x.status = "busy"; x.updated = Date.now(); delete x.msg;
    s.sessions[sid] = x;
    return s;
  });
}

function onNotification(input, cfg) {
  const type = input.notification_type || "";
  const msg = input.message || "";
  const needsYou = type === "permission_prompt" || type === "elicitation_dialog" || (!type && /permission|needs your|approve/i.test(msg));
  if (!needsYou) return;
  const sid = input.session_id || "default";
  let cwd = input.cwd, origin = null;
  C.updateClaude(s => {
    const x = s.sessions[sid] || { since: Date.now() };
    x.status = "waiting"; x.updated = Date.now(); x.msg = msg || "Claude needs your permission";
    cwd = x.cwd = x.cwd || cwd;
    origin = x.origin || null;
    s.sessions[sid] = x;
    return s;
  });
  L.notify("Claude needs you", C.project(cwd) + ": " + (msg || "permission requested"), cfg);
  if (C.pausedUntil() && cfg.pauseFocus && !C.runningGame()) L.focusOrigin(origin);
}

function onStop(input, cfg) {
  const sid = input.session_id || "default";
  let since = Date.now(), cwd = input.cwd, origin = null;
  C.updateClaude(s => {
    const x = s.sessions[sid] || { since: Date.now() };
    since = x.since || since; cwd = x.cwd = x.cwd || cwd; origin = x.origin || null;
    x.status = "done"; x.updated = Date.now(); x.finished = Date.now(); delete x.msg;
    s.sessions[sid] = x;
    return s;
  });
  const took = Date.now() - since;
  const game = C.runningGame();
  // the open game handles its own alert and return; otherwise tell the person, unless it was a quick reply
  if (took >= cfg.openAfter * 1000 && (!game || !cfg.returnAfter)) {
    L.notify("Claude finished", C.project(cwd) + " · " + C.clock(took), cfg);
    // paused: no game, but still put you back in Claude
    if (!game && C.pausedUntil() && cfg.pauseFocus) L.focusOrigin(origin);
  }
}

function onEnd(input) {
  const sid = input.session_id || "default";
  C.updateClaude(s => { delete s.sessions[sid]; return s; });
}

async function main() {
  const input = await readStdin();
  if (process.env.CLAUDE_CODE_REMOTE === "true") return;
  const cfg = C.config();
  const ev = input.hook_event_name || process.argv[2] || "";
  try {
    if (ev === "UserPromptSubmit") await onPrompt(input, cfg);
    else if (ev === "PostToolUse") onToolUse(input);
    else if (ev === "Notification") onNotification(input, cfg);
    else if (ev === "Stop") onStop(input, cfg);
    else if (ev === "SessionEnd") onEnd(input);
  } catch (e) { log(ev + " " + (e && e.stack || e)); }
}

main().then(() => process.exit(0), e => { log(String(e && e.stack || e)); process.exit(0); });
