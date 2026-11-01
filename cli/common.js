// Shared state for the terminal client, the Claude Code hook, and the launcher.
// Everything lives in ~/.quantest (override with QUANTEST_HOME) as small JSON files.
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");

const HOME = process.env.QUANTEST_HOME || path.join(os.homedir(), ".quantest");
const FILES = {
  config: path.join(HOME, "config.json"),
  claude: path.join(HOME, "claude.json"), // Claude Code session status, written by the hook
  game: path.join(HOME, "game.json"),     // the running game: pid, pane or window, where to return
  save: path.join(HOME, "save.json"),     // unfinished market, replayed on reopen
  stats: path.join(HOME, "stats.json"),
  lock: path.join(HOME, "launch.lock"),
  pause: path.join(HOME, "pause.json"),   // { until }: no auto-open before this time
  log: path.join(HOME, "hook.log")
};

const DEFAULT_CONFIG = {
  autoOpen: true,     // open the game when Claude starts working
  openAfter: 8,       // seconds Claude must still be working before the game opens (skips quick replies)
  returnAfter: 5,     // countdown after Claude finishes before jumping back; 0 = notify only
  notify: true,       // system notification when Claude finishes or needs permission
  pauseFor: 60,       // minutes the z key (or qt pause) stops the game opening on its own
  pauseFocus: true,   // while paused, still jump to Claude when it finishes or needs permission
  sound: "Glass",     // macOS notification sound; "" for silent
  launcher: "auto",   // auto | tmux | iterm | terminal | none
  split: "auto"       // tmux only: auto | right | below
};

function ensureHome() { fs.mkdirSync(HOME, { recursive: true }); }

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { return fallback; }
}

function writeJSON(file, obj) {
  ensureHome();
  const tmp = file + "." + process.pid + "." + Math.random().toString(36).slice(2) + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file); // atomic, so readers never see half a file
}

function config() { return Object.assign({}, DEFAULT_CONFIG, readJSON(FILES.config, {})); }

// Read-modify-write the Claude status file under a short spin lock, since several hooks
// (one per session, plus tool-use heartbeats) can fire at once.
function updateClaude(fn) {
  ensureHome();
  const lock = FILES.claude + ".lock";
  const start = Date.now();
  let fd = null;
  while (fd === null) {
    try { fd = fs.openSync(lock, "wx"); }
    catch (e) {
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 3000) fs.unlinkSync(lock); } catch (e2) { /* gone */ }
      if (Date.now() - start > 2000) break; // give up on the lock rather than hang a hook
      const t = Date.now(); while (Date.now() - t < 15) { /* spin */ }
    }
  }
  try {
    const cur = readJSON(FILES.claude, { sessions: {} });
    if (!cur.sessions) cur.sessions = {};
    const next = fn(cur) || cur;
    writeJSON(FILES.claude, next);
    return next;
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); fs.unlinkSync(lock); } catch (e) { /* ignore */ } }
  }
}

function alive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; }
}

// The running game, or null if its process has gone.
function runningGame() {
  const g = readJSON(FILES.game, null);
  if (g && alive(g.pid)) return g;
  return null;
}

// One-line summary of every Claude Code session the hook knows about.
// busy: working; waiting: blocked on a permission prompt; done: finished its turn.
const STALE_MS = 6 * 3600 * 1000;
function claudeSummary(now) {
  now = now || Date.now();
  const s = readJSON(FILES.claude, { sessions: {} }).sessions || {};
  const list = Object.keys(s).map(id => Object.assign({ id }, s[id]))
    .filter(x => now - (x.updated || 0) < STALE_MS)
    .sort((a, b) => (b.updated || 0) - (a.updated || 0));
  const busy = list.filter(x => x.status === "busy");
  const waiting = list.filter(x => x.status === "waiting");
  const done = list.filter(x => x.status === "done");
  return { list, busy, waiting, done };
}

// Pause: the game stops opening on its own until `until`. Claude tracking carries on.
function pausedUntil(now) {
  const p = readJSON(FILES.pause, null);
  return p && p.until > (now || Date.now()) ? p.until : 0;
}
function pause(minutes) {
  const until = Date.now() + Math.max(1, minutes) * 60000;
  writeJSON(FILES.pause, { until });
  return until;
}
function unpause() { try { fs.unlinkSync(FILES.pause); } catch (e) { /* not paused */ } }
function hhmm(ms) { const d = new Date(ms); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); }
function mins(m) { return m % 60 === 0 ? m / 60 + "h" : m > 60 ? Math.floor(m / 60) + "h" + (m % 60) + "m" : m + "m"; }
// "90", "90m", "1.5h", "2h" -> minutes
function parseMinutes(s) {
  const m = String(s || "").trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(m|min|mins|h|hr|hrs|hour|hours)?$/);
  if (!m) return NaN;
  return Math.round(parseFloat(m[1]) * (m[2] && m[2][0] === "h" ? 60 : 1));
}

function project(cwd) { const p = cwd ? path.basename(cwd) : "claude"; return p.length > 18 ? p.slice(0, 17) + "…" : p; }

function clock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60), r = s % 60;
  if (m >= 60) return Math.floor(m / 60) + "h" + String(m % 60).padStart(2, "0");
  return m + ":" + String(r).padStart(2, "0");
}

module.exports = { HOME, FILES, DEFAULT_CONFIG, ensureHome, readJSON, writeJSON, config, updateClaude, alive, runningGame, claudeSummary, project, clock, pausedUntil, pause, unpause, hhmm, mins, parseMinutes };
