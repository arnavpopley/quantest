#!/usr/bin/env node
// Hooks Quantest into Claude Code.
//   node cli/install.js              install hooks, the qt command, and a tmux key if tmux is present
//   node cli/install.js --no-tmux    skip the tmux key
//   node cli/install.js --uninstall  remove all of it (stats and settings in ~/.quantest stay)
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");
const C = require("./common");

const args = new Set(process.argv.slice(2));
const NODE = process.execPath;
const HOOK = path.join(__dirname, "hook.js");
const GAME = path.join(__dirname, "quantest.js");
const MARK = /quantest[^"]*\/cli\/hook\.js/i; // ours, wherever the repo was cloned
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
const SETTINGS = path.join(CLAUDE_DIR, "settings.json");
const TMUX_CONF = path.join(os.homedir(), ".tmux.conf");
const TMUX_TAG = "# quantest: toggle the game beside Claude Code";

const say = s => console.log(s);
const has = cmd => { try { execFileSync("sh", ["-c", "command -v " + cmd], { stdio: "ignore" }); return true; } catch (e) { return false; } };

// ---------- Claude Code hooks ----------
const EVENTS = [
  { event: "UserPromptSubmit" },
  { event: "PostToolUse", matcher: "*" },
  { event: "Notification", matcher: "permission_prompt|elicitation_dialog" },
  { event: "Stop" },
  { event: "SessionEnd" }
];

function isOurs(h) { return h && typeof h.command === "string" && MARK.test(h.command.replace(/\\/g, "/")); }

function stripOurs(settings) {
  const hooks = settings.hooks || {};
  Object.keys(hooks).forEach(ev => {
    hooks[ev] = (hooks[ev] || []).map(g => Object.assign({}, g, { hooks: (g.hooks || []).filter(h => !isOurs(h)) }))
      .filter(g => g.hooks.length);
    if (!hooks[ev].length) delete hooks[ev];
  });
  if (!Object.keys(hooks).length) delete settings.hooks; else settings.hooks = hooks;
  return settings;
}

function addOurs(settings) {
  settings.hooks = settings.hooks || {};
  const command = JSON.stringify(NODE) + " " + JSON.stringify(HOOK);
  EVENTS.forEach(({ event, matcher }) => {
    const group = { hooks: [{ type: "command", command, async: true }] };
    if (matcher) group.matcher = matcher;
    (settings.hooks[event] = settings.hooks[event] || []).push(group);
  });
  return settings;
}

function editSettings(fn) {
  let raw = null, settings = {};
  if (fs.existsSync(SETTINGS)) {
    raw = fs.readFileSync(SETTINGS, "utf8");
    try { settings = JSON.parse(raw); }
    catch (e) { say("Can't parse " + SETTINGS + " (" + e.message + "). Fix it and run this again; nothing changed."); process.exit(1); }
  }
  const next = fn(JSON.parse(JSON.stringify(settings)));
  const out = JSON.stringify(next, null, 2) + "\n";
  if (raw === out) return false;
  fs.mkdirSync(CLAUDE_DIR, { recursive: true });
  if (raw !== null) fs.writeFileSync(SETTINGS + ".quantest-backup", raw);
  fs.writeFileSync(SETTINGS, out);
  return true;
}

// ---------- the qt command ----------
function binDirs() {
  const pathDirs = (process.env.PATH || "").split(path.delimiter);
  const prefer = [path.join(os.homedir(), ".local", "bin"), path.join(os.homedir(), "bin"), "/opt/homebrew/bin", "/usr/local/bin"];
  return prefer.filter(d => pathDirs.indexOf(d) >= 0).concat(prefer[0]);
}
function writable(d) { try { fs.mkdirSync(d, { recursive: true }); fs.accessSync(d, fs.constants.W_OK); return true; } catch (e) { return false; } }
const WRAPPER = "#!/bin/sh\n# quantest launcher\nexec " + JSON.stringify(NODE) + " " + JSON.stringify(GAME) + ' "$@"\n';

function installBin() {
  for (const d of binDirs()) {
    if (!writable(d)) continue;
    for (const name of ["qt", "quantest"]) {
      const f = path.join(d, name);
      if (fs.existsSync(f) && fs.readFileSync(f, "utf8").indexOf("# quantest launcher") < 0) continue; // someone else's qt
      fs.writeFileSync(f, WRAPPER, { mode: 0o755 });
      const onPath = (process.env.PATH || "").split(path.delimiter).indexOf(d) >= 0;
      return { file: f, name, onPath, dir: d };
    }
  }
  return null;
}
function removeBin() {
  binDirs().forEach(d => ["qt", "quantest"].forEach(n => {
    const f = path.join(d, n);
    try { if (fs.readFileSync(f, "utf8").indexOf("# quantest launcher") >= 0) { fs.unlinkSync(f); say("removed " + f); } } catch (e) { /* none */ }
  }));
}

// ---------- tmux key ----------
function tmuxLine(bin) { return "bind-key Q run-shell -b " + JSON.stringify(bin + " --toggle --from-pane '#{pane_id}'"); }
function editTmux(bin) {
  let conf = fs.existsSync(TMUX_CONF) ? fs.readFileSync(TMUX_CONF, "utf8") : "";
  conf = conf.split("\n").filter((l, i, a) => l !== TMUX_TAG && !(i > 0 && a[i - 1] === TMUX_TAG)).join("\n").replace(/\n+$/, "");
  if (bin) conf += (conf ? "\n\n" : "") + TMUX_TAG + "\n" + tmuxLine(bin);
  fs.writeFileSync(TMUX_CONF, conf ? conf + "\n" : "");
  try { execFileSync("tmux", ["source-file", TMUX_CONF], { stdio: "ignore" }); } catch (e) { /* no server running; loads next time */ }
  if (!bin) try { execFileSync("tmux", ["unbind-key", "Q"], { stdio: "ignore" }); } catch (e) { /* fine */ }
}

// ---------- main ----------
if (args.has("--uninstall")) {
  say(editSettings(stripOurs) ? "removed Quantest hooks from " + SETTINGS : "no Quantest hooks in " + SETTINGS);
  removeBin();
  if (fs.existsSync(TMUX_CONF) && fs.readFileSync(TMUX_CONF, "utf8").indexOf(TMUX_TAG) >= 0) { editTmux(null); say("removed the tmux key from " + TMUX_CONF); }
  say("Stats and settings are still in " + C.HOME + ".");
  process.exit(0);
}

const major = parseInt(process.versions.node, 10);
if (major < 16) { say("Node 16 or newer needed (this is " + process.version + ")."); process.exit(1); }

editSettings(s => addOurs(stripOurs(s)));
say("✓ Claude Code hooks added to " + SETTINGS + (fs.existsSync(SETTINGS + ".quantest-backup") ? " (previous version saved as settings.json.quantest-backup)" : ""));

C.ensureHome();
if (!fs.existsSync(C.FILES.config)) C.writeJSON(C.FILES.config, C.DEFAULT_CONFIG);
say("✓ settings in " + C.FILES.config);

const bin = installBin();
if (bin) {
  say("✓ " + bin.name + " command at " + bin.file);
  if (!bin.onPath) say("  " + bin.dir + " isn't on your PATH. Add this to ~/.zshrc:  export PATH=\"" + bin.dir + ":$PATH\"");
} else say("! couldn't write a qt command anywhere on PATH; run it as: node " + GAME);

const qt = bin ? bin.file : NODE + " " + GAME;
if (has("tmux") && !args.has("--no-tmux")) {
  editTmux(qt);
  say("✓ tmux key: prefix then Q opens the game, jumps to it, or jumps back to Claude (in " + TMUX_CONF + ")");
}

say("");
say("How it opens:");
say("  in tmux       a pane splits beside Claude when a turn runs past " + C.config().openAfter + "s");
if (process.platform === "darwin") {
  say("  outside tmux  a Terminal or iTerm2 window opens instead; macOS asks once to let your terminal control itself");
  say("");
  say("One key outside tmux (optional): open Shortcuts, make a shortcut with one 'Run Shell Script' action");
  say("  containing  " + qt + " --toggle");
  say("  then give it a keyboard shortcut in its details (e.g. ⌃⌥Q).");
} else say("  outside tmux  no auto-open; run " + (bin ? bin.name : "the game") + " in a spare terminal and it still tracks Claude");
say("");
say("Restart any running Claude Code sessions so they pick up the hooks. Try it: " + (bin ? bin.name : "node " + GAME) + " status");
