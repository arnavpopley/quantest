/* Daily Six-Quote.
   One hidden number, the same for everyone today. Six quotes. After each, three tiles:
   where the number sits relative to your market, how tight you are, and how close your mid is.
   Win by quoting a market that contains the number at 10% width or less. */

window.Daily = (function () {
  const { el, clear, fmt, parseNum, haptic, confetti, shake, hashStr, toast } = UI;
  const LAUNCH = new Date(2026, 9, 16); // 16 Oct 2026
  const MAX = 6;

  function todayInfo(d) {
    d = d || new Date();
    const key = State.dayKey(d);
    const n = Math.floor((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - LAUNCH) / 86400000) + 1;
    const pool = QUANTEST_FACTS.filter(f => f.cat !== "warmup");
    const fact = pool[hashStr("quantest-daily-" + key) % pool.length];
    return { key, n, fact };
  }

  function grade(fact, bid, ask) {
    const T = fact.a;
    const mid = (bid + ask) / 2;
    const w = (ask - bid) / mid;
    const dist = Math.abs(Math.log(mid / T));
    const pos = T < bid ? "high" : T > ask ? "low" : "in";
    const width = w <= 0.10 ? "tight" : w <= 0.30 ? "ok" : "wide";
    const heat = dist <= 0.08 ? "hot" : dist <= 0.4 ? "warm" : "cold";
    return { pos, width, heat, win: pos === "in" && width === "tight" };
  }

  function tileFor(kind, val) {
    const map = {
      pos: { high: ["r", "▼ market too high"], low: ["r", "▲ market too low"], in: ["g", "✓ contains it"] },
      width: { tight: ["g", "tight"], ok: ["y", "could be tighter"], wide: ["r", "too wide"] },
      heat: { hot: ["g", "mid is hot"], warm: ["y", "mid is warm"], cold: ["r", "mid is cold"] }
    };
    const [cls, txt] = map[kind][val];
    return el("div", { class: "tile " + cls + " flip" }, txt);
  }
  const EMO = { g: "🟩", y: "🟨", r: "🟥" };
  function emojiRow(g) {
    const p = g.pos === "in" ? "g" : "r";
    const w = g.width === "tight" ? "g" : g.width === "ok" ? "y" : "r";
    const h = g.heat === "hot" ? "g" : g.heat === "warm" ? "y" : "r";
    return EMO[p] + EMO[w] + EMO[h];
  }

  function play(opts) {
    opts = opts || {};
    const info = todayInfo();
    const s = State.get();
    const prior = s.daily[info.key];
    const L = Lesson.open({ practice: true, confirmQuit: false, progressClass: "gold", onClose: opts.onDone });
    const attempts = prior ? prior.attempts.slice() : [];
    let done = !!prior;

    function render() {
      L.reset();
      L.setProgress(attempts.length / MAX);
      L.inner.append(
        el("div", { class: "row wrap" }, [el("span", { class: "chip gold" }, "Daily #" + info.n), el("span", { class: "chip" }, info.fact.cat), el("span", { class: "chip" }, "quote " + Math.min(attempts.length + 1, MAX) + " of " + MAX)]),
        el("h2", { class: "question" }, info.fact.q),
        el("p", { class: "muted small" }, "Same number for everyone today. Win with a market that contains it at 10% width or less.")
      );
      const tiles = el("div", { class: "tiles" });
      attempts.forEach(a => {
        tiles.appendChild(el("div", { class: "row small muted", style: { gap: "8px" } }, [el("span", { class: "bid-text" }, fmt(a.bid)), "/", el("span", { class: "ask-text" }, fmt(a.ask))]));
        tiles.appendChild(el("div", { class: "tile-row" }, [tileFor("pos", a.g.pos), tileFor("width", a.g.width), tileFor("heat", a.g.heat)]));
      });
      for (let i = attempts.length; i < MAX; i++) tiles.appendChild(el("div", { class: "tile-row" }, [el("div", { class: "tile" }), el("div", { class: "tile" }), el("div", { class: "tile" })]));
      L.inner.appendChild(tiles);

      if (done) return finished();

      const bidIn = el("input", { class: "input bid num", inputmode: "decimal", placeholder: "bid, e.g. 120 or 1.2m" });
      const askIn = el("input", { class: "input ask num", inputmode: "decimal", placeholder: "ask" });
      const lastA = attempts[attempts.length - 1];
      if (lastA) { bidIn.value = fmtIn(lastA.bid); askIn.value = fmtIn(lastA.ask); }
      const nudge = (inp, p) => { const v = parseNum(inp.value); if (isNaN(v)) return; inp.value = fmtIn(v * (1 + p)); upd(); };
      L.inner.append(
        el("div", { class: "quote-grid" }, [
          el("div", { class: "quote-box bid" }, [el("label", { class: "lab" }, "Bid"), bidIn, el("div", { class: "nudge" }, [el("button", { class: "btn xs soft-bid", onclick: () => nudge(bidIn, -0.1) }, "−10%"), el("button", { class: "btn xs soft-bid", onclick: () => nudge(bidIn, 0.1) }, "+10%")])]),
          el("div", { class: "quote-box ask" }, [el("label", { class: "lab" }, "Ask"), askIn, el("div", { class: "nudge" }, [el("button", { class: "btn xs soft-ask", onclick: () => nudge(askIn, -0.1) }, "−10%"), el("button", { class: "btn xs soft-ask", onclick: () => nudge(askIn, 0.1) }, "+10%")])])
        ]),
        el("div", { class: "widen" }, [
          el("button", { class: "btn xs", onclick: () => { nudge(bidIn, -0.1); nudge(askIn, 0.1); } }, "Widen"),
          el("button", { class: "btn xs", onclick: () => { nudge(bidIn, 0.1); nudge(askIn, -0.1); } }, "Tighten"),
          el("button", { class: "btn xs", onclick: () => { nudge(bidIn, 0.15); nudge(askIn, 0.15); } }, "Shift up"),
          el("button", { class: "btn xs", onclick: () => { nudge(bidIn, -0.15); nudge(askIn, -0.15); } }, "Shift down")
        ])
      );
      const sp = el("div", { class: "spreadline" });
      L.inner.appendChild(sp);
      function upd() {
        const b = parseNum(bidIn.value), a = parseNum(askIn.value);
        const ok = b > 0 && a > b;
        btn.disabled = !ok;
        sp.innerHTML = ok ? "Width <b>" + ((a - b) / ((a + b) / 2) * 100).toFixed(0) + "%</b> of mid" : "<span class='muted'>Ask must be above bid.</span>";
      }
      bidIn.addEventListener("input", upd); askIn.addEventListener("input", upd);
      bidIn.addEventListener("keydown", e => { if (e.key === "Enter") askIn.focus(); });
      askIn.addEventListener("keydown", e => { if (e.key === "Enter" && !btn.disabled) btn.click(); });
      const btn = L.setFoot("", "", "", "Quote", () => {
        const b = parseNum(bidIn.value), a = parseNum(askIn.value);
        if (!(b > 0 && a > b)) return;
        const g = grade(info.fact, b, a);
        attempts.push({ bid: b, ask: a, g });
        haptic(g.win ? "win" : g.pos === "in" ? "hit" : "tap");
        if (g.win || attempts.length >= MAX) {
          done = true;
          const won = g.win;
          s.daily[info.key] = { won, attempts, grid: attempts.map(x => emojiRow(x.g)).join("\n") };
          State.save();
          if (won) { State.addXP(30 + (MAX - attempts.length) * 5); confetti(); } else { shake(L.body); State.touchStreak(); }
          State.record("daily", won ? MAX + 1 - attempts.length : 0);
        }
        render();
      }, "gold");
      upd();
      if (!lastA) bidIn.focus();
    }

    function fmtIn(v) { return Math.abs(v) >= 1000 ? String(Math.round(v)) : String(Math.round(v * 100) / 100); }

    function finished() {
      const rec = s.daily[info.key];
      const won = rec.won;
      L.inner.append(
        el("div", { class: "card gold" }, [el("p", { class: "tiny" }, "THE NUMBER"), el("h2", {}, fmt(info.fact.a, { compact: false }) + (info.fact.unit ? " " + info.fact.unit : "")), el("p", { class: "small", style: { marginTop: "6px" } }, info.fact.note || "")]),
        el("div", { class: "lesson-note" }, [
          el("p", { class: "small muted" }, "Share grid"),
          el("pre", { style: { margin: "6px 0 10px", fontSize: "18px", lineHeight: "1.2", fontFamily: "inherit" } }, "Quantest #" + info.n + " " + (won ? attempts.length : "X") + "/" + MAX + "\n" + rec.grid),
          el("button", { class: "btn sm auto", onclick: () => {
            const text = "Quantest #" + info.n + " " + (won ? attempts.length : "X") + "/" + MAX + "\n" + rec.grid + "\nquantest.net";
            if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast("Copied")).catch(() => toast("Copy failed"));
            else toast("Copy not available");
          } }, "Copy result")
        ])
      );
      L.setFoot(won ? "ok" : "bad", won ? "Solved in " + attempts.length : "Not today.", won ? "Come back tomorrow for a fresh number." : "The number was " + fmt(info.fact.a) + ". Tomorrow is a new one.", "Done", () => L.close(false));
    }

    render();
  }

  return { play, todayInfo, grade };
})();
