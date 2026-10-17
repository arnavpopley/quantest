/* Number Markets — the core Quantest game.
   Take any number fact. Quote a two-way market on it. Traders arrive; each one knows a bit
   more than the last. Re-quote each round. Settle against the true number and track P&L.

   Engine is pure (no DOM) so it can be unit-tested headlessly; the screen is below it. */

window.NumberMarket = (function () {
  const { el, clear, fmt, fmtPct, parseNum, haptic, toast, confetti, shake, rng, hashStr, gauss } = UI;

  // ---------------- Engine ----------------
  function sigmaSchedule(rounds) {
    // log-space noise of the informed trader's belief, shrinking to zero on the last round
    const out = [];
    for (let r = 0; r < rounds; r++) {
      const t = rounds === 1 ? 1 : r / (rounds - 1);
      out.push(r === rounds - 1 ? 0 : 0.4 * Math.pow(1 - t, 1.3));
    }
    return out;
  }

  function createEngine(opts) {
    const fact = opts.fact;
    const rounds = opts.rounds || 5;
    const rand = rng(opts.seed !== undefined ? opts.seed : (Math.random() * 2 ** 32) >>> 0);
    const sig = sigmaSchedule(rounds);
    const T = fact.a;
    const st = {
      fact, rounds, round: 0, quotes: [], trades: [], done: false,
      pnlPct: 0, noiseCaptured: 0, pickedOff: 0, containsFinal: false
    };

    function tradePnl(tr) {
      // player is short when a counterparty BUYS at the ask, long when they SELL at the bid
      return tr.side === "buy" ? (tr.price - T) / T * 100 : (T - tr.price) / T * 100;
    }

    function submit(bid, ask) {
      if (st.done) throw new Error("market settled");
      if (!(bid > 0) || !(ask > bid)) throw new Error("bad quote");
      const r = st.round;
      const mid = (bid + ask) / 2;
      const relWidth = (ask - bid) / mid;
      st.quotes.push({ round: r, bid, ask });

      const events = [];
      // analyst: a trader whose estimate sharpens each round. They know they are uncertain,
      // so early on they only trade when their estimate is well outside your market.
      const belief = T * Math.exp(sig[r] * gauss(rand));
      const margin = 1 + 0.6 * sig[r];
      let informedTrade = null;
      if (belief > ask * margin) informedTrade = { round: r, side: "buy", price: ask, who: "informed", belief };
      else if (belief < bid / margin) informedTrade = { round: r, side: "sell", price: bid, who: "informed", belief };
      if (informedTrade) { st.trades.push(informedTrade); events.push(informedTrade); }
      else events.push({ round: r, side: "pass", who: "informed", belief });

      // noise trader: more likely to show up when your market is tight
      const pNoise = 0.85 * Math.exp(-3 * relWidth);
      if (rand() < pNoise) {
        const side = rand() < 0.5 ? "buy" : "sell";
        const tr = { round: r, side, price: side === "buy" ? ask : bid, who: "noise" };
        st.trades.push(tr); events.push(tr);
      }

      st.round += 1;
      if (st.round >= rounds) settle(bid, ask);
      return { events, round: r, done: st.done };
    }

    function settle(bid, ask) {
      st.done = true;
      st.containsFinal = bid <= T && T <= ask;
      st.finalWidthPct = (ask - bid) / T * 100;
      let pnl = 0;
      st.trades.forEach(tr => {
        tr.pnl = tradePnl(tr);
        pnl += tr.pnl;
        if (tr.who === "noise") st.noiseCaptured += 1;
        if (tr.who === "informed" && tr.pnl < 0) st.pickedOff += 1;
      });
      st.pnlPct = pnl;
      // XP: calibration + flow capture + staying solvent
      let xp = 5;
      if (st.containsFinal) xp += 15;
      if (st.containsFinal && st.finalWidthPct <= 20) xp += 10;
      xp += Math.min(15, st.noiseCaptured * 5);
      if (pnl > 0) xp += 10;
      if (pnl > 25) xp += 10;
      st.xp = xp;
      st.blownUp = pnl < -30;
    }

    return { state: st, submit, T, sig };
  }

  // ---------------- Screen ----------------
  // opts: { facts, title, unitId, practice, rounds, onDone, players }
  function play(opts) {
    const facts = opts.facts;
    const rounds = opts.rounds || 5;
    let idx = 0;
    const results = [];
    const overlay = el("div", { class: "lesson" });
    const top = el("div", { class: "lesson-top" });
    const body = el("div", { class: "lesson-body" });
    const foot = el("div", { class: "lesson-foot" });
    overlay.append(top, body, foot);
    document.body.appendChild(overlay);

    const progress = el("div", { class: "progress" }, el("div"));
    const heartsEl = el("div", { class: "stat heart" });
    top.append(
      el("button", { class: "close", "aria-label": "Quit", onclick: () => { if (confirm("Quit this lesson? Progress on it is lost.")) finish(true); } }, "✕"),
      progress,
      opts.practice ? el("span", { class: "chip" }, "practice") : heartsEl
    );
    function refreshHearts() { heartsEl.textContent = "♥ " + State.get().hearts; }
    refreshHearts();

    function setProgress() {
      const totalSteps = facts.length * rounds;
      const done = idx * rounds + (eng ? eng.state.round : 0);
      progress.firstChild.style.width = Math.round(done / totalSteps * 100) + "%";
    }

    let eng = null;
    let lastQuote = null;

    function startFact() {
      const fact = facts[idx];
      eng = createEngine({ fact, rounds, seed: opts.seed !== undefined ? opts.seed + idx : undefined });
      lastQuote = null;
      renderRound();
    }

    function renderRound() {
      setProgress();
      const fact = eng.state.fact;
      const r = eng.state.round;
      clear(body); clear(foot); foot.className = "lesson-foot";
      const inner = el("div", { class: "lesson-inner stack" });
      body.appendChild(inner);

      inner.append(
        el("div", { class: "row wrap" }, [
          el("span", { class: "chip brand" }, "Round " + (r + 1) + " of " + rounds),
          el("span", { class: "chip" }, fact.cat || "custom"),
          fact.unit ? el("span", { class: "chip" }, fact.unit) : null
        ]),
        el("h2", { class: "question" }, fact.q),
        el("p", { class: "muted small" }, r === 0
          ? "Quote a bid and an ask. An analyst with a rough estimate will hit your bid, lift your offer, or pass. Random flow shows up when you're tight."
          : "Re-quote. The analyst's estimate sharpens every round; by the last round it is exact.")
      );

      // ladder
      const ladder = el("div", { class: "ladder" });
      inner.appendChild(ladder);

      // quote inputs
      const bidIn = el("input", { class: "input bid num", inputmode: "decimal", placeholder: "e.g. 150 or 1.2m" });
      const askIn = el("input", { class: "input ask num", inputmode: "decimal", placeholder: "e.g. 250 or 2.5m" });
      if (lastQuote) { bidIn.value = fmtInput(lastQuote.bid); askIn.value = fmtInput(lastQuote.ask); }

      const nudgeBid = el("div", { class: "nudge" }, [
        el("button", { class: "btn xs soft-bid", onclick: () => nudge(bidIn, -0.1) }, "−10%"),
        el("button", { class: "btn xs soft-bid", onclick: () => nudge(bidIn, 0.1) }, "+10%")
      ]);
      const nudgeAsk = el("div", { class: "nudge" }, [
        el("button", { class: "btn xs soft-ask", onclick: () => nudge(askIn, -0.1) }, "−10%"),
        el("button", { class: "btn xs soft-ask", onclick: () => nudge(askIn, 0.1) }, "+10%")
      ]);
      const grid = el("div", { class: "quote-grid" }, [
        el("div", { class: "quote-box bid" }, [el("label", { class: "lab" }, "Your bid (you buy)"), bidIn, nudgeBid]),
        el("div", { class: "quote-box ask" }, [el("label", { class: "lab" }, "Your ask (you sell)"), askIn, nudgeAsk])
      ]);
      const spreadInfo = el("div", { class: "spreadline" });
      const widenRow = el("div", { class: "widen" }, [
        el("button", { class: "btn xs", onclick: () => { nudge(bidIn, -0.1); nudge(askIn, 0.1); } }, "Widen"),
        el("button", { class: "btn xs", onclick: () => { nudge(bidIn, 0.1); nudge(askIn, -0.1); } }, "Tighten"),
        el("button", { class: "btn xs", onclick: () => { nudge(bidIn, 0.15); nudge(askIn, 0.15); } }, "Shift up"),
        el("button", { class: "btn xs", onclick: () => { nudge(bidIn, -0.15); nudge(askIn, -0.15); } }, "Shift down")
      ]);
      inner.append(grid, spreadInfo, widenRow);

      // trade log so far
      if (eng.state.trades.length || eng.state.quotes.length) inner.appendChild(renderLog(eng, false));

      function nudge(input, pct) {
        const v = parseNum(input.value);
        if (isNaN(v)) return;
        input.value = fmtInput(v * (1 + pct));
        update();
      }
      function update() {
        const b = parseNum(bidIn.value), a = parseNum(askIn.value);
        bidIn.classList.toggle("invalid", bidIn.value !== "" && (isNaN(b) || b <= 0));
        askIn.classList.toggle("invalid", askIn.value !== "" && (isNaN(a) || (!isNaN(b) && a <= b)));
        const ok = b > 0 && a > b;
        if (ok) {
          const mid = (a + b) / 2;
          spreadInfo.innerHTML = "Mid <b>" + fmt(mid) + "</b> · Spread <b>" + fmt(a - b) + "</b> (" + ((a - b) / mid * 100).toFixed(0) + "% of mid)";
        } else spreadInfo.innerHTML = "<span class='muted'>Ask must be above bid.</span>";
        submitBtn.disabled = !ok;
        drawLadder(ladder, eng, ok ? { bid: b, ask: a } : null, null);
      }
      bidIn.addEventListener("input", update);
      askIn.addEventListener("input", update);
      bidIn.addEventListener("keydown", e => { if (e.key === "Enter") askIn.focus(); });
      askIn.addEventListener("keydown", e => { if (e.key === "Enter" && !submitBtn.disabled) submitBtn.click(); });

      const submitBtn = el("button", { class: "btn primary lg", disabled: true, onclick: () => {
        const b = parseNum(bidIn.value), a = parseNum(askIn.value);
        if (!(b > 0 && a > b)) return;
        lastQuote = { bid: b, ask: a };
        const res = eng.submit(b, a);
        haptic("tap");
        afterSubmit(res, inner, ladder, grid, spreadInfo, widenRow);
      } }, "Quote");
      foot.appendChild(el("div", { class: "lesson-foot-inner" }, [el("div", { class: "verdict" }), submitBtn]));
      update();
      if (!lastQuote) bidIn.focus();
    }

    function afterSubmit(res, inner, ladder, grid, spreadInfo, widenRow) {
      // freeze inputs
      grid.querySelectorAll("input,button").forEach(n => n.disabled = true);
      widenRow.querySelectorAll("button").forEach(n => n.disabled = true);
      drawLadder(ladder, eng, lastQuote, null);
      const trades = res.events.filter(e => e.side !== "pass");
      const T = eng.T;
      let title, sub, tone;
      if (trades.length === 0) {
        title = "No trade. Your market held.";
        sub = "The trader's number sat inside your spread, or your market was too wide to bother with.";
        tone = "ok";
      } else {
        const t = trades[0];
        const n = trades.length;
        title = (t.side === "buy" ? "Someone lifted your offer at " : "Someone hit your bid at ") + fmt(t.price) + (n > 1 ? " (and more)" : "");
        sub = n > 1
          ? "Two trades this round. Whoever they are, you're now " + posWord(eng) + "."
          : (t.side === "buy" ? "A buyer thinks the number is higher than your ask. You're " : "A seller thinks the number is lower than your bid. You're ") + posWord(eng) + ".";
        tone = "neutral";
        haptic("hit");
      }
      const old = inner.querySelector(".log");
      if (old) old.remove();
      inner.appendChild(renderLog(eng, false));

      clear(foot);
      foot.className = "lesson-foot " + tone;
      const nextBtn = el("button", { class: "btn primary lg", onclick: () => res.done ? showResult() : renderRound() }, res.done ? "Settle" : "Next round");
      foot.appendChild(el("div", { class: "lesson-foot-inner" }, [
        el("div", { class: "verdict" }, [el("h3", {}, title), el("p", { class: "small" }, sub)]),
        nextBtn
      ]));
      setProgress();
      nextBtn.focus();
    }

    function posWord(e) {
      let pos = 0;
      e.state.trades.forEach(t => pos += t.side === "buy" ? -1 : 1);
      if (pos === 0) return "flat";
      return (pos > 0 ? "long " : "short ") + Math.abs(pos);
    }

    function showResult() {
      const s = eng.state;
      const fact = s.fact;
      const T = eng.T;
      results.push({ fact, pnl: s.pnlPct, xp: s.xp, contains: s.containsFinal, blownUp: s.blownUp });
      if (!opts.practice && s.blownUp) { State.loseHeart(); refreshHearts(); }

      clear(body); clear(foot);
      const inner = el("div", { class: "lesson-inner stack" });
      body.appendChild(inner);

      const pos = s.pnlPct >= 0;
      inner.append(
        el("div", { class: "result-hero" }, [
          el("div", { class: "big " + (pos ? "pos" : "neg") }, fmtPct(s.pnlPct)),
          el("p", { class: "muted" }, "P&L as a share of the true value, summed over your fills")
        ]),
        el("div", { class: "card gold" }, [
          el("p", { class: "tiny" }, "THE NUMBER"),
          el("h2", {}, fmt(T, { compact: false }) + (fact.unit ? " " + fact.unit : "")),
          el("p", { class: "small", style: { marginTop: "6px" } }, fact.note || ""),
          fact.tol === "approx" ? el("p", { class: "tiny", style: { marginTop: "6px" } }, "Best public estimate; treat the last few percent as noise.") : null
        ])
      );

      const ladder = el("div", { class: "ladder" });
      inner.appendChild(ladder);
      drawLadder(ladder, eng, lastQuote, T);

      inner.appendChild(el("div", { class: "result-row" }, [
        box(s.containsFinal ? "Yes" : "No", "final market contained it", s.containsFinal ? "gold" : ""),
        box(s.finalWidthPct.toFixed(0) + "%", "final width vs truth", s.containsFinal && s.finalWidthPct <= 20 ? "gold" : ""),
        box("+" + s.xp, "xp", "gold")
      ]));

      inner.appendChild(renderLog(eng, true));
      inner.appendChild(el("div", { class: "lesson-note", html: lessonText(s, T) }));

      if (s.pnlPct > 0 && s.containsFinal) { confetti(); haptic("win"); }
      else if (s.blownUp) { shake(body); haptic("bad"); }

      foot.className = "lesson-foot " + (pos ? "ok" : "bad");
      const last = idx === facts.length - 1;
      const btn = el("button", { class: "btn primary lg", onclick: () => { idx += 1; if (last) summary(); else startFact(); } }, last ? "Finish" : "Next market");
      foot.appendChild(el("div", { class: "lesson-foot-inner" }, [
        el("div", { class: "verdict" }, [
          el("h3", {}, s.blownUp ? "Blown up. Heart lost." : pos ? "Profitable market." : "You paid the informed trader."),
          el("p", { class: "small" }, s.blownUp ? "Below −30%. Width is how you express uncertainty; use it." : s.pickedOff ? "Picked off " + s.pickedOff + " time" + (s.pickedOff > 1 ? "s" : "") + " by the analyst." : "No one picked you off.")
        ]),
        btn
      ]));
      btn.focus();
    }

    function box(v, k, cls) {
      return el("div", { class: "box " + (cls || "") }, [el("div", { class: "v" }, v), el("div", { class: "k" }, k)]);
    }

    function lessonText(s, T) {
      const q0 = s.quotes[0];
      const qN = s.quotes[s.quotes.length - 1];
      const firstContains = q0.bid <= T && T <= q0.ask;
      const parts = [];
      if (!firstContains) parts.push("Your opening market <b>missed</b> the number. Early on, width is cheap and being wrong is not: open wide, then tighten as trades tell you where the number is.");
      else parts.push("Your opening market <b>contained</b> the number. Good. The job from there is tightening without losing it.");
      const informedLosses = s.trades.filter(t => t.who === "informed" && t.pnl < 0);
      if (informedLosses.length) parts.push("Trades against the analyst cost you " + fmtPct(informedLosses.reduce((a, t) => a + t.pnl, 0)) + ". Every trade is information: a buyer at your ask means <b>shift up</b>, a seller at your bid means <b>shift down</b>.");
      const noise = s.trades.filter(t => t.who === "noise");
      if (noise.length) parts.push("You captured " + noise.length + " noise trade" + (noise.length > 1 ? "s" : "") + " worth " + fmtPct(noise.reduce((a, t) => a + t.pnl, 0)) + ". Tight markets attract flow; that is what pays for the risk.");
      else parts.push("No noise flow came. Markets wider than about 30% of mid rarely get hit by anyone but the informed.");
      if (s.quotes.length > 1) {
        const w0 = (q0.ask - q0.bid) / ((q0.ask + q0.bid) / 2);
        const wN = (qN.ask - qN.bid) / ((qN.ask + qN.bid) / 2);
        if (wN >= w0) parts.push("You never tightened. By round " + s.quotes.length + " you had " + (s.trades.length) + " data points; use them.");
      }
      return parts.join(" ");
    }

    function summary() {
      clear(body); clear(foot);
      const totalXp = results.reduce((a, r) => a + r.xp, 0);
      const totalPnl = results.reduce((a, r) => a + r.pnl, 0);
      const contained = results.filter(r => r.contains).length;
      if (!opts.practice) {
        State.addXP(totalXp);
        if (opts.unitId) State.completeLesson(opts.unitId);
      }
      State.record("number-markets", Math.round(totalPnl), { n: results.length });
      const inner = el("div", { class: "lesson-inner stack" });
      body.appendChild(inner);
      inner.append(
        el("div", { class: "row", style: { gap: "16px", marginTop: "10px" } }, [
          el("div", { html: UI.mascot(totalPnl >= 0 ? "happy" : "sad") }),
          el("div", { class: "speech grow" }, totalPnl >= 0 ? "Markets made. The informed traders went home poorer than you." : "The informed traders ate your lunch. Wider early, tighter late.")
        ]),
        el("div", { class: "result-row" }, [
          box("+" + totalXp, "xp earned", "gold"),
          box(fmtPct(totalPnl), "total p&l"),
          box(contained + "/" + results.length, "markets that contained the number")
        ]),
        el("table", { class: "table" }, [
          el("thead", {}, el("tr", {}, [el("th", {}, "Market"), el("th", {}, "True"), el("th", {}, "P&L")])),
          el("tbody", {}, results.map(r => el("tr", {}, [
            el("td", {}, r.fact.q),
            el("td", { class: "num" }, fmt(r.fact.a)),
            el("td", { class: "num pnl " + (r.pnl >= 0 ? "pos" : "neg") }, fmtPct(r.pnl))
          ])))
        ])
      );
      if (totalPnl > 0) confetti();
      foot.className = "lesson-foot ok";
      const btn = el("button", { class: "btn primary lg", onclick: () => finish(false) }, "Continue");
      foot.appendChild(el("div", { class: "lesson-foot-inner" }, [el("div", { class: "verdict" }, el("h3", {}, "Lesson complete")), btn]));
      btn.focus();
    }

    function finish(aborted) {
      overlay.remove();
      if (opts.onDone) opts.onDone({ aborted, results });
    }

    startFact();
    return { close: () => finish(true) };
  }

  function sig2(v) { if (v <= 0) return v; const p = Math.pow(10, Math.floor(Math.log10(v)) - 1); return Math.round(v / p) * p; }

  function fmtInput(v) {
    if (Math.abs(v) >= 1000) return String(Math.round(v));
    return String(Math.round(v * 100) / 100);
  }

  function renderLog(eng, revealed) {
    const T = eng.T;
    const log = el("div", { class: "log" });
    const trades = eng.state.trades;
    const quotes = eng.state.quotes;
    quotes.forEach(q => {
      const rt = trades.filter(t => t.round === q.round);
      const row = el("div", { class: "log-row" }, [
        el("span", { class: "r" }, q.round + 1),
        el("span", { class: "bid-text num" }, fmt(q.bid)),
        el("span", { class: "muted" }, "/"),
        el("span", { class: "ask-text num" }, fmt(q.ask)),
        el("span", { class: "muted small" }, rt.length ? "" : "no trade")
      ]);
      log.appendChild(row);
      rt.forEach(t => {
        const who = revealed ? (t.who === "informed" ? "analyst" : "noise") : "trader";
        const r2 = el("div", { class: "log-row " + t.side }, [
          el("span", { class: "r" }, t.side === "buy" ? "↑" : "↓"),
          el("span", {}, (t.side === "buy" ? "Bought from you at " : "Sold to you at ") + fmt(t.price)),
          el("span", { class: "chip " + (revealed ? (t.who === "informed" ? "ask" : "bid") : "") }, who),
          revealed ? el("span", { class: "pnl " + (t.pnl >= 0 ? "pos" : "neg") }, fmtPct(t.pnl)) : null
        ]);
        log.appendChild(r2);
      });
    });
    return log;
  }

  // Log-scale number line showing the live quote, past quotes faintly, trade chips, and the truth once revealed.
  function drawLadder(ladder, eng, live, truth) {
    clear(ladder);
    const pts = [];
    eng.state.quotes.forEach(q => { pts.push(q.bid, q.ask); });
    if (live) pts.push(live.bid, live.ask);
    if (truth) pts.push(truth);
    if (!pts.length) {
      ladder.appendChild(el("div", { class: "axis" }));
      ladder.appendChild(el("div", { class: "tick", style: { left: "50%" } }, "your market will appear here"));
      return;
    }
    let lo = Math.min(...pts), hi = Math.max(...pts);
    lo = lo / 1.8; hi = hi * 1.8;
    const L = Math.log(lo), H = Math.log(hi);
    const x = v => ((Math.log(Math.max(v, 1e-9)) - L) / (H - L) * 100);
    ladder.appendChild(el("div", { class: "axis" }));
    // ticks (rounded to two significant figures, skipped where the truth label will sit)
    [lo * 1.1, Math.sqrt(lo * hi), hi / 1.1].forEach(v => {
      const r = sig2(v);
      if (truth && Math.abs(x(r) - x(truth)) < 12) return;
      ladder.appendChild(el("div", { class: "tick", style: { left: x(r) + "%" } }, fmt(r)));
    });
    // past quotes
    eng.state.quotes.forEach(q => {
      if (live && q.bid === live.bid && q.ask === live.ask) return;
      ladder.appendChild(el("div", { class: "band ghost", style: { left: x(q.bid) + "%", width: Math.max(0.5, x(q.ask) - x(q.bid)) + "%" } }));
    });
    if (live) {
      ladder.appendChild(el("div", { class: "band", style: { left: x(live.bid) + "%", width: Math.max(0.5, x(live.ask) - x(live.bid)) + "%" } }));
      ladder.appendChild(el("div", { class: "handle bid", style: { left: x(live.bid) + "%" } }));
      ladder.appendChild(el("div", { class: "handle ask", style: { left: x(live.ask) + "%" } }));
    }
    eng.state.trades.forEach((t, i) => {
      ladder.appendChild(el("div", { class: "trade " + t.side, style: { left: x(t.price) + "%", top: (i % 2 ? 24 : 2) + "px" } }, (t.side === "buy" ? "▲" : "▼") + (t.round + 1)));
    });
    if (truth) {
      ladder.appendChild(el("div", { class: "truth", style: { left: x(truth) + "%" } }, "★"));
      ladder.appendChild(el("div", { class: "truth-label", style: { left: x(truth) + "%" } }, fmt(truth)));
    }
  }

  return { createEngine, play, sigmaSchedule };
})();
