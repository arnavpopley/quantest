// Opening the game next to Claude Code, focusing it, and handing focus back.
// tmux: a split pane beside Claude's pane. macOS without tmux: a Terminal.app or iTerm2 window.
// Anything else: no auto-open; run `qt` in a spare terminal and you still get the status bar.
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync, spawn } = require("child_process");
const C = require("./common");

const NODE = process.execPath;
const GAME = path.join(__dirname, "quantest.js");
const isMac = process.platform === "darwin";

function sh(cmd, args, opts) {
  try { return execFileSync(cmd, args, Object.assign({ encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 8000 }, opts)).trim(); }
  catch (e) { return null; }
}
function osa(lines) { return sh("osascript", [].concat(...lines.map(l => ["-e", l]))); }
function q(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; }
function asStr(s) { return '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"'; }

const MAC_APPS = { terminal: "com.apple.Terminal", iterm: "com.googlecode.iterm2" };

// Which launcher to use, given where Claude Code is running.
function detect(env, cfg) {
  env = env || process.env;
  cfg = cfg || C.config();
  if (env.CLAUDE_CODE_REMOTE === "true") return "none";
  if (cfg.launcher && cfg.launcher !== "auto") return cfg.launcher;
  if (env.TMUX) return "tmux";
  if (isMac) return env.TERM_PROGRAM === "iTerm.app" ? "iterm" : "terminal";
  return "none";
}

// Where to come back to. Captured when Claude starts, before anything steals focus.
function captureOrigin(env) {
  env = env || process.env;
  const o = { via: detect(env) };
  if (env.TMUX_PANE) o.pane = env.TMUX_PANE;
  // on macOS also note the app (Terminal, iTerm2, VS Code...) so it can be brought to the front later
  if (isMac && o.via !== "none") {
    o.app = osa(["id of application (path to frontmost application as text)"]);
    if (o.app === MAC_APPS.terminal) o.window = num(osa(['tell application "Terminal" to id of front window']));
    else if (o.app === MAC_APPS.iterm) o.window = num(osa(['tell application "iTerm2" to id of current window']));
  }
  return o;
}
function num(s) { const n = parseInt(s, 10); return isFinite(n) ? n : undefined; }

// A tiny script so terminal apps get a command with no quoting surprises.
function playScript(origin) {
  C.ensureHome();
  const file = path.join(C.HOME, "play.sh");
  const b64 = Buffer.from(JSON.stringify(origin || {})).toString("base64");
  fs.writeFileSync(file, "#!/bin/sh\nexec " + q(NODE) + " " + q(GAME) + " --cc --origin " + q(b64) + "\n", { mode: 0o755 });
  return file;
}

function open(origin) {
  origin = origin || captureOrigin();
  const via = origin.via || detect();
  if (via === "tmux") return openTmux(origin);
  if (via === "terminal" || via === "iterm") return openMac(origin, via);
  return null;
}

function openTmux(origin) {
  const target = origin.pane ? ["-t", origin.pane] : [];
  const cfg = C.config();
  let dir = cfg.split;
  if (dir !== "right" && dir !== "below") {
    const w = num(sh("tmux", ["display-message", "-p"].concat(target, ["#{pane_width}"])));
    dir = w && w >= 150 ? "right" : "below";
  }
  const b64 = Buffer.from(JSON.stringify(origin)).toString("base64");
  const cmd = "exec " + q(NODE) + " " + q(GAME) + " --cc --origin " + q(b64);
  const base = ["split-window", dir === "right" ? "-h" : "-v"].concat(target);
  const size = dir === "right" ? "42" : "55";
  let pane = sh("tmux", base.concat(["-l", size + "%", "-P", "-F", "#{pane_id}", cmd]));
  if (!pane) pane = sh("tmux", base.concat(["-p", size, "-P", "-F", "#{pane_id}", cmd])); // tmux < 3.1
  return pane ? { via: "tmux", pane } : null;
}

function openMac(origin, via) {
  const script = playScript(origin);
  let id;
  if (via === "iterm") {
    id = osa([
      'tell application "iTerm2"',
      "set w to (create window with default profile command " + asStr(script) + ")",
      "activate",
      "return id of w",
      "end tell"
    ]);
  } else {
    id = osa([
      'tell application "Terminal"',
      "set t to do script " + asStr("exec " + q(script)),
      "activate",
      "try",
      "return id of (first window whose selected tab is t)",
      "on error",
      "return id of front window",
      "end try",
      "end tell"
    ]);
  }
  const window = num(id);
  if (window === undefined) return null;
  // the game writes game.json as it starts; add the window id it cannot know about itself
  let g = C.readJSON(C.FILES.game, {}) || {};
  if (g.pid && !C.alive(g.pid)) g = {}; // left over from a game that crashed
  C.writeJSON(C.FILES.game, Object.assign(g, { via, window }));
  return { via, window };
}

// Bring an already-running game to the front.
function focus(game) {
  if (!game) return false;
  if (game.via === "tmux" && game.pane) {
    sh("tmux", ["select-window", "-t", game.pane]);
    return sh("tmux", ["select-pane", "-t", game.pane]) !== null;
  }
  if (isMac && game.window !== undefined) {
    if (game.via === "iterm") return osa(['tell application "iTerm2"', "activate", "try", "select (first window whose id is " + game.window + ")", "end try", "end tell"]) !== null;
    return osa(['tell application "Terminal"', "activate", "try", "set index of (first window whose id is " + game.window + ") to 1", "end try", "end tell"]) !== null;
  }
  return false;
}

// Is the game what the person is looking at right now?
function isFocused(game, fromPane) {
  if (!game) return false;
  if (game.via === "tmux") {
    const active = fromPane || sh("tmux", ["display-message", "-p", "#{pane_id}"]);
    return active === game.pane;
  }
  if (isMac && game.window !== undefined) {
    const app = osa(["id of application (path to frontmost application as text)"]);
    if (game.via === "iterm") return app === MAC_APPS.iterm && num(osa(['tell application "iTerm2" to id of current window'])) === game.window;
    return app === MAC_APPS.terminal && num(osa(['tell application "Terminal" to id of front window'])) === game.window;
  }
  return false;
}

// Hand focus back to where Claude is. Called by the game just before it exits; the pane or
// window closes behind it. On macOS the window is closed a moment later from a detached helper,
// once the game process has gone, so Terminal never asks about a running process.
function returnFocus(game) {
  if (!game || !game.origin) return;
  const o = game.origin;
  if (game.via === "tmux" || o.via === "tmux") {
    if (o.pane) { sh("tmux", ["select-window", "-t", o.pane]); sh("tmux", ["select-pane", "-t", o.pane]); }
    return;
  }
  if (!isMac) return;
  const lines = [];
  if (game.window !== undefined) {
    if (game.via === "iterm") lines.push('tell application "iTerm2"', "try", "close (first window whose id is " + game.window + ")", "end try", "end tell");
    else lines.push('tell application "Terminal"', "try", "close (first window whose id is " + game.window + ")", "end try", "end tell");
  }
  if (o.app) {
    lines.push("tell application id " + asStr(o.app) + " to activate");
    if (o.window !== undefined && o.app === MAC_APPS.terminal) lines.push('tell application "Terminal"', "try", "set index of (first window whose id is " + o.window + ") to 1", "end try", "end tell");
    if (o.window !== undefined && o.app === MAC_APPS.iterm) lines.push('tell application "iTerm2"', "try", "select (first window whose id is " + o.window + ")", "end try", "end tell");
  }
  if (!lines.length) return;
  const args = [].concat(...lines.map(l => ["-e", l]));
  const child = spawn("/bin/sh", ["-c", "sleep 0.4; exec osascript \"$@\"", "sh"].concat(args), { detached: true, stdio: "ignore" });
  child.unref();
}

// Bring Claude's terminal to the front without any game involved: raise its app or window on
// macOS, then select its tmux window and pane. Used while the game is paused.
function focusOrigin(o) {
  if (!o) return false;
  let ok = false;
  if (isMac && o.app) {
    const lines = ["tell application id " + asStr(o.app) + " to activate"];
    if (o.window !== undefined && o.app === MAC_APPS.terminal) lines.push('tell application "Terminal"', "try", "set index of (first window whose id is " + o.window + ") to 1", "end try", "end tell");
    if (o.window !== undefined && o.app === MAC_APPS.iterm) lines.push('tell application "iTerm2"', "try", "select (first window whose id is " + o.window + ")", "end try", "end tell");
    ok = osa(lines) !== null;
  }
  if (o.pane) {
    sh("tmux", ["select-window", "-t", o.pane]);
    ok = sh("tmux", ["select-pane", "-t", o.pane]) !== null || ok;
  }
  return ok;
}

function notify(title, message, cfg) {
  cfg = cfg || C.config();
  if (!cfg.notify) return;
  if (isMac) {
    osa(["display notification " + asStr(message) + " with title " + asStr(title) + (cfg.sound ? " sound name " + asStr(cfg.sound) : "")]);
  } else if (sh("sh", ["-c", "command -v notify-send"])) {
    sh("notify-send", ["-a", "Quantest", title, message]);
  }
  if (process.env.TMUX) sh("tmux", ["display-message", title + " · " + message]);
}

module.exports = { detect, captureOrigin, open, focus, isFocused, returnFocus, focusOrigin, notify, playScript };
