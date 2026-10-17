/* Small DOM and formatting helpers shared by every screen. */
window.UI = (function () {
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (k === "class") node.className = v;
        else if (k === "html") node.innerHTML = v;
        else if (k === "text") node.textContent = v;
        else if (k === "style" && typeof v === "object") Object.assign(node.style, v);
        else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
        else if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v === true ? "" : v);
      }
    }
    if (children !== undefined && children !== null) {
      (Array.isArray(children) ? children : [children]).forEach(c => {
        if (c === null || c === undefined || c === false) return;
        node.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
      });
    }
    return node;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

  // Format a number for display: commas, sensible decimals, compact suffixes for very large values.
  function fmt(n, opts) {
    opts = opts || {};
    if (n === null || n === undefined || isNaN(n)) return "–";
    const abs = Math.abs(n);
    if (opts.compact !== false && abs >= 1e6) {
      const units = [[1e12, "tn"], [1e9, "bn"], [1e6, "m"]];
      for (const [v, s] of units) {
        if (abs >= v) {
          const x = n / v;
          const d = x >= 100 ? 0 : x >= 10 ? 1 : 2;
          return trimZeros(x.toFixed(d)) + s;
        }
      }
    }
    if (abs >= 1000) return Math.round(n).toLocaleString("en-GB");
    if (abs >= 100) return trimZeros(n.toFixed(1));
    if (abs >= 10) return trimZeros(n.toFixed(2));
    return trimZeros(n.toFixed(abs >= 1 ? 2 : 3));
  }
  function trimZeros(s) { return s.indexOf(".") >= 0 ? s.replace(/\.?0+$/, "") : s; }

  function fmtPct(x, digits) {
    if (x === null || x === undefined || isNaN(x)) return "–";
    const d = digits === undefined ? 1 : digits;
    const s = (x >= 0 ? "+" : "") + x.toFixed(d) + "%";
    return s;
  }

  // Parse user input like "1.2m", "350k", "1,200", "2.5bn".
  function parseNum(str) {
    if (typeof str === "number") return str;
    if (!str) return NaN;
    let s = String(str).trim().toLowerCase().replace(/,/g, "").replace(/\s+/g, "");
    let mult = 1;
    const m = s.match(/^(-?[\d.]+)(k|m|bn|b|tn|t)?$/);
    if (!m) return NaN;
    const suf = m[2];
    if (suf === "k") mult = 1e3;
    else if (suf === "m") mult = 1e6;
    else if (suf === "bn" || suf === "b") mult = 1e9;
    else if (suf === "tn" || suf === "t") mult = 1e12;
    const v = parseFloat(m[1]) * mult;
    return isFinite(v) ? v : NaN;
  }

  function haptic(kind) {
    if (!navigator.vibrate) return;
    try {
      if (kind === "hit") navigator.vibrate(12);
      else if (kind === "bad") navigator.vibrate([40, 30, 40]);
      else if (kind === "win") navigator.vibrate([20, 40, 20, 40, 60]);
      else navigator.vibrate(8);
    } catch (e) { /* ignore */ }
  }

  let toastTimer = null;
  function toast(msg, ms) {
    const old = document.querySelector(".toast");
    if (old) old.remove();
    const t = el("div", { class: "toast", text: msg });
    document.body.appendChild(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.remove(), ms || 1800);
  }

  function confetti() {
    const wrap = el("div", { class: "confetti" });
    const colors = ["#1fc77a", "#2f6bff", "#ffb800", "#ff5a5f", "#9b5cff", "#ff8a00"];
    for (let i = 0; i < 70; i++) {
      const p = el("i");
      p.style.left = Math.random() * 100 + "%";
      p.style.background = colors[i % colors.length];
      p.style.animationDelay = (Math.random() * 0.5) + "s";
      p.style.animationDuration = (1.2 + Math.random() * 0.9) + "s";
      p.style.transform = "rotate(" + Math.random() * 360 + "deg)";
      wrap.appendChild(p);
    }
    document.body.appendChild(wrap);
    setTimeout(() => wrap.remove(), 2600);
  }

  function shake(node) {
    node.classList.remove("shake");
    void node.offsetWidth;
    node.classList.add("shake");
  }

  // Seeded PRNG (mulberry32) so daily puzzles and graded rounds are reproducible.
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  // Standard normal from a uniform generator.
  function gauss(rand) {
    let u = 0, v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }

  function mascot(mood) {
    // Original mascot: Tick, an octopus (two hands on every side of the book).
    const mouth = mood === "sad" ? "M34 60 q10 -8 20 0" : mood === "wow" ? "M38 58 a6 6 0 1 0 12 0 a6 6 0 1 0 -12 0" : "M32 56 q12 12 24 0";
    return (
      '<svg class="mascot" viewBox="0 0 88 88" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      '<path d="M14 62 q-10 14 2 22 M28 70 q-6 14 4 18 M60 70 q6 14 -4 18 M74 62 q10 14 -2 22" stroke="#2f6bff" stroke-width="7" fill="none" stroke-linecap="round"/>' +
      '<ellipse cx="44" cy="44" rx="32" ry="30" fill="#2f6bff"/>' +
      '<ellipse cx="44" cy="52" rx="24" ry="16" fill="#4d82ff"/>' +
      '<circle cx="32" cy="40" r="9" fill="#fff"/><circle cx="56" cy="40" r="9" fill="#fff"/>' +
      '<circle cx="34" cy="41" r="4.5" fill="#3c3c3c"/><circle cx="58" cy="41" r="4.5" fill="#3c3c3c"/>' +
      '<path d="' + mouth + '" stroke="#1c2b55" stroke-width="3.5" fill="none" stroke-linecap="round"/>' +
      '</svg>'
    );
  }

  return { el, clear, fmt, fmtPct, parseNum, haptic, toast, confetti, shake, rng, hashStr, gauss, mascot };
})();
