// Loads the browser game engines into Node without changing them. The engines are pure;
// the screen code in the same files only touches the DOM when play() is called, which the
// terminal client never does. Same shim approach as tests/engine-test.js.
"use strict";
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const FILES = ["js/ui.js", "js/state.js", "js/facts.js", "js/lesson.js",
  "js/games/numberMarket.js", "js/games/cardSum.js", "js/games/diceLadder.js"];

function load() {
  const node = () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, appendChild() {}, setAttribute() {}, addEventListener() {} });
  const ctx = {
    navigator: {}, console, setTimeout, clearTimeout, Math, Date, JSON,
    document: { createElement: node, createTextNode: node, querySelector: () => null, body: { appendChild() {} } },
    localStorage: { getItem: () => null, setItem() {} }
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  FILES.forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), ctx, { filename: f }));
  return {
    UI: ctx.UI,
    NumberMarket: ctx.NumberMarket,
    CardSum: ctx.CardSum,
    DiceLadder: ctx.DiceLadder,
    FACTS: ctx.QUANTEST_FACTS,
    UNITS: ctx.QUANTEST_UNITS
  };
}

module.exports = load();
