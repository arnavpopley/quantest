/* Flow Drill — the interview exercise.
   "Make me a market." You quote. "I buy. Make me another." Five rounds against one scripted
   counterparty whose behaviour you have to read. The number is defined relative to your own
   opening market, so knowing the fact is irrelevant: the score is how you react to flow. */

window.FlowDrill = (function () {
  const { el, fmt, fmtPct, parseNum, haptic, confetti, shake, rng } = UI;
  const LIMIT = 8;

  // Every persona has a fair value T (set relative to your opening mid) and only trades at prices
  // better than it. Move your market far enough and they stop: that is the end state you want.
  const PERSONAS = {
    buyer: { name: "persistent buyer", shift: 0.45, blurb: "Lifts your offer every round it's below my number, bigger each time. The lesson: shift up decisively; creeping 5% a round gets you run over.",
      act: (r, q, T) => (q.ask < T ? { side: "buy", size: [2, 2, 3, 3, 4][r] } : { side: "pass" }) },
    seller: { name: "persistent seller", shift: -0.45, blurb: "Hits your bid every round it's above my number. Mirror of the buyer.",
      act: (r, q, T) => (q.bid > T ? { side: "sell", size: [2, 2, 3, 3, 4][r] } : { side: "pass" }) },
    flipper: { name: "bluffer", shift: -0.3, blurb: "Buys a one-lot twice to drag your market up, then sells hard into it. The lesson: size is information; two one-lots are not a trend.",
      act: (r, q, T) => r < 2 ? (q.ask < T * 1.6 ? { side: "buy", size: 1 } : { side: "pass" }) : (q.bid > T ? { side: "sell", size: [0, 0, 3, 4, 5][r] } : { side: "pass" }) },
    sizer: { name: "size tester", shift: 0.25, blurb: "Wants five units every round and only trades when your offer is below my number. The lesson: your price for five should be worse than your price for one.",
      act: (r, q, T) => (q.ask < T ? { side: "buy", size: 5 } : { side: "pass" }) },
    patient: { name: "patient one", shift: 0.35, blurb: "Passes three rounds, then buys in size in rounds four and five if you're still cheap. The lesson: no flow is not a reason to tighten.",
      act: (r, q, T) => (r < 3 ? { side: "pass" } : (q.ask < T ? { side: "buy", size: [0, 0, 0, 4, 5][r] } : { side: "pass" })) }
  };

  function createEngine(opts) {
    opts = opts || {};
    const rand = rng(opts.seed !== undefined ? opts.seed : (Math.random() * 2 ** 32) >>> 0);
    const keys = Object.keys(PERSONAS);
    const key = opts.persona && PERSONAS[opts.persona] ? opts.persona : keys[Math.floor(rand() * keys.length)];
    const persona = PERSONAS[key];
    const st = { persona: key, round: 0, rounds: 5, quotes: [], trades: [], inv: 0, cash: 0, done: false, T: null, fact: opts.fact };

    function submit(bid, ask) {
      if (st.done) throw new Error("settled");
      if (!(bid > 0 && ask > bid)) throw new Error("bad quote");
      const r = st.round;
      if (r === 0) st.T = ((bid + ask) / 2) * Math.exp(persona.shift);
      st.quotes.push({ round: r, bid, ask });
      const a = persona.act(r, { bid, ask }, st.T);
      let tr = null;
      if (a.side === "buy") { const sz = Math.min(a.size, LIMIT + st.inv); if (sz > 0) { st.cash += ask * sz; st.inv -= sz; tr = { round: r, side: "buy", price: ask, size: sz, capped: sz < a.size }; } }
      else if (a.side === "sell") { const sz = Math.min(a.size, LIMIT - st.inv); if (sz > 0) { st.cash -= bid * sz; st.inv += sz; tr = { round: r, side: "sell", price: bid, size: sz, capped: sz < a.size }; } }
      if (tr) st.trades.push(tr);
      st.round += 1;
      if (st.round >= st.rounds) settle(bid, ask);
      return { trade: tr, done: st.done };
    }

    function settle(bid, ask) {
      st.done = true;
      const T = st.T;
      st.trades.forEach(t => { t.pnl = (t.side === "buy" ? (t.price - T) / T : (T - t.price) / T) * 100 * t.size; });
      st.pnlPct = (st.cash + st.inv * T) / T * 100;
      // reaction grades
      let moved = 0, widened = 0;
      for (let r = 1; r < st.quotes.length; r++) {
        const prev = st.quotes[r - 1], cur = st.quotes[r];
        const lastTrade = st.trades.find(t => t.round === r - 1);
        if (!lastTrade) continue;
        const pm = (prev.bid + prev.ask) / 2, cm = (cur.bid + cur.ask) / 2;
        const dir = lastTrade.side === "buy" ? 1 : -1;
        if ((cm - pm) / pm * dir >= 0.05) moved += 1;
        if (Math.log(cur.ask / cur.bid) > Math.log(prev.ask / prev.bid) * 1.1) widened += 1;
      }
      const hits = st.trades.length;
      st.moved = moved; st.widened = widened; st.hits = hits;
      st.maxInv = Math.max(...st.quotes.map((q, i) => Math.abs(st.trades.filter(t => t.round <= i).reduce((a, t) => a + (t.side === "buy" ? -t.size : t.size), 0))), 0);
      st.capped = st.maxInv < LIMIT;                 // reaching the limit is being run over
      st.containsFinal = bid <= T && T <= ask;
      // reaction score: did your final market contain their number, did you move after each fill, did you stay inside the limit
      const reactable = st.trades.filter(t => t.round < st.rounds - 1).length;
      let score = st.containsFinal ? 40 : 0;
      score += reactable > 0 ? Math.round(40 * moved / reactable) : (st.containsFinal ? 40 : 0);
      score += st.capped ? 20 : 0;
      st.score = Math.min(100, score);
      st.xp = 5 + (st.score >= 50 ? 10 : 0) + (st.score >= 75 ? 10 : 0) + (st.pnlPct > -10 ? 5 : 0) + (st.capped ? 5 : 0);
      st.blownUp = !st.capped || st.pnlPct < -40;
    }

    return { state: st, submit, persona, LIMIT };
  }

  function play(opts) {
    opts = opts || {};
    const pool = (window.QUANTEST_FACTS || []).filter(f => f.tol === "approx");
    const fact = opts.fact || pool[Math.floor(Math.random() * pool.length)] || { q: "the number of grains of rice in a sack" };
    const eng = createEngine({ seed: opts.seed, persona: opts.persona, fact });
    const st = eng.state;
    const L = Lesson.open({ practice: opts.practice, confirmQuit: true, progressClass: "brand", onClose: opts.onDone });
    let last = null;

    function speech(text) {
      return el("div", { class: "row", style: { gap: "12px", alignItems: "flex-start" } }, [el("div", { html: UI.mascot("wow") }), el("div", { class: "speech grow" }, text)]);
    }

    function renderRound() {
      L.reset(); L.setProgress(st.round / st.rounds);
      const r = st.round;
      const lastTrade = st.trades.find(t => t.round === r - 1);
      const line = r === 0 ? "Make me a market on " + fact.q.replace(/^How (many|long|tall|far|deep|much|old) /i, "").replace(/\?$/, "") + "."
        : lastTrade ? (lastTrade.side === "buy" ? "I buy " + lastTrade.size + " at " + fmt(lastTrade.price) + ". Make me another." : "I sell you " + lastTrade.size + " at " + fmt(lastTrade.price) + ". Make me another.")
        : "I'll pass. Make me another.";
      L.inner.append(
        el("div", { class: "row wrap" }, [el("span", { class: "chip brand" }, "Flow drill"), el("span", { class: "chip" }, "round " + (r + 1) + " of " + st.rounds), el("span", { class: "chip" }, "limit ±" + LIMIT)]),
        speech(line),
        el("p", { class: "muted small" }, r === 0 ? "The number isn't the point. The counterparty has a plan; your job is to read it from the flow and move your market the right amount. Position past ±" + LIMIT + " blows you up." : "Position: " + (st.inv === 0 ? "flat" : (st.inv > 0 ? "long " : "short ") + Math.abs(st.inv)) + ". Marked P&L is hidden until the end; react to the flow, not the P&L.")
      );
      const ladder = el("div", { class: "ladder" });
      L.inner.appendChild(ladder);
      const q = Lesson.quoteInputs(null, 1);
      // percent nudges are more useful than ±1 here; rewire the nudge buttons
      q.node.querySelectorAll(".nudge button, .widen button").forEach(b => b.remove());
      const nudge = (inp, pct) => { const v = parseNum(inp.value); if (isNaN(v)) return; inp.value = Math.abs(v) >= 1000 ? String(Math.round(v * (1 + pct))) : String(Math.round(v * (1 + pct) * 100) / 100); inp.dispatchEvent(new Event("input")); };
      q.node.querySelectorAll(".nudge").forEach((n, i) => { const inp = i === 0 ? q.bidIn : q.askIn; n.append(el("button", { class: "btn xs " + (i === 0 ? "soft-bid" : "soft-ask"), onclick: () => nudge(inp, -0.1) }, "−10%"), el("button", { class: "btn xs " + (i === 0 ? "soft-bid" : "soft-ask"), onclick: () => nudge(inp, 0.1) }, "+10%")); });
      q.node.querySelector(".widen").append(
        el("button", { class: "btn xs", onclick: () => { nudge(q.bidIn, -0.1); nudge(q.askIn, 0.1); } }, "Widen"),
        el("button", { class: "btn xs", onclick: () => { nudge(q.bidIn, 0.1); nudge(q.askIn, -0.1); } }, "Tighten"),
        el("button", { class: "btn xs", onclick: () => { nudge(q.bidIn, 0.15); nudge(q.askIn, 0.15); } }, "Shift up"),
        el("button", { class: "btn xs", onclick: () => { nudge(q.bidIn, -0.15); nudge(q.askIn, -0.15); } }, "Shift down")
      );
      if (last) { q.bidIn.value = fmtIn(last.bid); q.askIn.value = fmtIn(last.ask); }
      L.inner.appendChild(q.node);
      function update(v) { v = v || q.get(); btn.disabled = !v.ok; NumberMarket.drawLadder(ladder, st.quotes, st.trades, v.ok ? v : null, null, null); }
      q.onChange(update);
      const btn = L.setFoot("", "", "", "Quote", () => {
        const v = q.get(); if (!v.ok) return;
        last = v;
        const res = eng.submit(v.bid, v.ask);
        q.setDisabled(true); haptic(res.trade ? "hit" : "tap");
        NumberMarket.drawLadder(ladder, st.quotes, st.trades, v, null, null);
        if (res.trade) L.setFoot("neutral", (res.trade.side === "buy" ? "Lifted " : "Hit ") + res.trade.size + " at " + fmt(res.trade.price) + ".", "You're " + (st.inv === 0 ? "flat" : (st.inv > 0 ? "long " : "short ") + Math.abs(st.inv)) + ".", res.done ? "Settle" : "Next", () => res.done ? result() : renderRound());
        else L.setFoot("ok", "Pass.", "No trade this round.", res.done ? "Settle" : "Next", () => res.done ? result() : renderRound());
        L.setProgress(st.round / st.rounds);
      });
      q.onEnter(() => { if (!btn.disabled) btn.click(); });
      update();
      if (!last) q.bidIn.focus();
    }

    function fmtIn(v) { return Math.abs(v) >= 1000 ? String(Math.round(v)) : String(Math.round(v * 100) / 100); }

    function result() {
      L.reset(); L.setProgress(1);
      const p = eng.persona;
      if (!opts.practice && st.blownUp) { State.loseHeart(); L.refreshHearts(); }
      if (!opts.practice) State.addXP(st.xp);
      State.record("flow-drill", st.score);
      const pos = st.pnlPct >= 0;
      L.inner.append(
        el("div", { class: "result-hero" }, [el("div", { class: "big " + (st.score >= 50 ? "pos" : "neg") }, st.score + "/100"), el("p", { class: "muted" }, "reaction score: moved with the flow, widened, stayed inside the limit")]),
        speech("I was the " + p.name + ". " + p.blurb),
        el("div", { class: "result-row" }, [
          Lesson.box(st.moved + "/" + st.trades.filter(t => t.round < st.rounds - 1).length, "moves in the right direction", st.trades.filter(t => t.round < st.rounds - 1).length > 0 && st.moved === st.trades.filter(t => t.round < st.rounds - 1).length ? "gold" : ""),
          Lesson.box(String(st.maxInv), "max position (limit " + LIMIT + ")", st.capped ? "" : "ask"),
          Lesson.box(fmtPct(st.pnlPct), "p&l at the fair value", pos ? "gold" : "")
        ])
      );
      const ladder = el("div", { class: "ladder" });
      L.inner.appendChild(ladder);
      NumberMarket.drawLadder(ladder, st.quotes, st.trades, last, st.T, null);
      L.inner.append(
        el("div", { class: "lesson-note", html: note() }),
        el("p", { class: "tiny" }, "Their number is set relative to your opening market so the drill is about reaction, not knowledge: it was your opening mid " + (p.shift > 0 ? "+" : "") + Math.round((Math.exp(p.shift) - 1) * 100) + "%, and they only trade at prices better than it.")
      );
      if (st.score >= 75) { confetti(); haptic("win"); } else if (st.blownUp) { shake(L.body); haptic("bad"); }
      L.setFoot(st.blownUp ? "bad" : st.score >= 50 ? "ok" : "bad", st.blownUp ? "Run over. Heart lost." : st.score >= 75 ? "Read the flow." : st.score >= 50 ? "Moved, but slowly." : "Didn't move.", st.containsFinal ? "Your final market contained their number, so they stopped trading. That's the end state." : "Your final market still didn't contain their number; they'd have kept hitting you.", "Continue", () => L.close(false));
    }

    function note() {
      const parts = [];
      const p = eng.persona;
      const reactable = st.trades.filter(t => t.round < st.rounds - 1).length;
      if (reactable > 0 && st.moved < reactable) parts.push("After " + (reactable - st.moved) + " of the fills you moved your mid less than 5% toward the trade. A repeat hitter in size is the clearest signal you will ever get: move 10–20% per hit and widen while you do it.");
      if (!st.capped) parts.push("Your position reached " + st.maxInv + ". Past the limit you are no longer making a market, you are holding a view. Either shift so hard they stop trading, or quote a size of one.");
      if (st.persona === "flipper" && st.trades.length >= 3 && st.quotes[2] && (st.quotes[2].bid + st.quotes[2].ask) / 2 > (st.quotes[0].bid + st.quotes[0].ask) / 2 * 1.08) parts.push("Two one-lot buys dragged your market up 8%+ and then the seller hit you in size. Weight flow by size: a five-lot is worth more than two one-lots.");
      if (st.persona === "patient" && st.quotes[3] && Math.log(st.quotes[3].ask / st.quotes[3].bid) < Math.log(st.quotes[0].ask / st.quotes[0].bid) * 0.8) parts.push("You tightened during the silence. No flow tells you nothing about the number; it only tells you nobody wanted your prices yet.");
      if (st.persona === "sizer") parts.push("A buyer who wants five every time is telling you your ask is cheap for that size. Quote one unit tight and five units wide, or just widen the ask.");
      return parts.join(" ") || "Clean. Try the other personas; each one punishes a different habit.";
    }

    renderRound();
  }

  return { createEngine, play, PERSONAS, LIMIT };
})();
