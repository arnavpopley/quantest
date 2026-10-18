/* Number Markets v2 — the core Quantest game.

   Take any number fact. Give an estimate. Then make a two-way market on it, in size, against:
     - the SCREEN: a competitor market maker whose quote you can see. Flow goes to the better price.
     - an ANALYST: an informed trader with a private signal that sharpens every round, a memory,
       sizing proportional to edge, and a habit of hitting you harder when you don't move.
     - a NOISE POPULATION: traders with wide, truth-centred beliefs who trade whenever your market
       excludes them. Tight markets get more of them; one-sided noise flow means you're off.
   Inventory marks to the screen every round and costs carry; at the risk limit the desk cuts your
   line, so you can only trade in the direction that reduces it.
   Settlement scores three things separately: your estimate, your market quality against the
   screen (interval score), and your flow P&L. Knowing the number is not the game.

   Engine is pure (no DOM) so it can be unit-tested headlessly; the screen is below it. */

window.NumberMarket = (function () {
  const { el, clear, fmt, fmtPct, parseNum, haptic, confetti, shake, rng, gauss } = UI;

  // How unsure a sensible non-expert is about facts in each unit (log-space sd).
  const REF_SD = { warmup: 0.25, world: 0.5, london: 0.45, body: 0.6, science: 0.7, business: 0.6, room: 0.5 };

  const P = {
    analystSig0: 0.45,   // analyst's private-signal sd (log) in round 1; exact on the last round
    analystPrior: 0.6,   // analyst's prior sd around the truth
    analystZ: 0.5,       // trades only when edge exceeds z posterior sds
    edgePerUnit: 0.08,   // log-edge needed per unit of size
    maxSize: 5,
    noiseN: 12, noiseArrive: 0.25, noiseSdMult: 1.0, noiseClip: 2.0,  // beliefs clipped at ±2 sd: nobody pays absurd prices
    compHwMult: 0.6,     // the screen's opening half-width as a multiple of the unit's reference sd
    compBiasMult: 0.4,   // the screen's opening mid is off the truth by N(0, refSd × this) in log space
    compTighten: 0.85,   // the screen narrows its width by this factor each round
    compLearn: 0.5,      // how far (in half-widths) the screen moves toward net flow each round
    riskLimit: 8,        // at this inventory the desk cuts your line on the side that would add to it
    screenFrom: 1,       // the screen opens from this round; round 1 you quote blind, like an interview
    carry: 0.004,        // inventory carry per unit per round, as a share of the screen mid
    isAlpha: 0.2         // interval-score miss penalty factor (2/alpha = 10)
  };

  function sigmaSchedule(rounds) {
    const out = [];
    for (let r = 0; r < rounds; r++) {
      const t = rounds === 1 ? 1 : r / (rounds - 1);
      out.push(r === rounds - 1 ? 0 : P.analystSig0 * Math.pow(1 - t, 1.3));
    }
    return out;
  }
  function refSd(fact) { return fact.refSd || REF_SD[fact.cat] || 0.5; }
  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

  // Interval score in log space (lower is better): width plus a heavy penalty for missing.
  function intervalScore(bid, ask, T) {
    const lb = Math.log(bid), la = Math.log(ask), lt = Math.log(T);
    const k = 2 / P.isAlpha;
    return (la - lb) + k * Math.max(0, lb - lt) + k * Math.max(0, lt - la);
  }

  // ---------------- Engine ----------------
  function createEngine(opts) {
    const fact = opts.fact;
    const rounds = opts.rounds || 5;
    const rand = rng(opts.seed !== undefined ? opts.seed : (Math.random() * 2 ** 32) >>> 0);
    const sig = sigmaSchedule(rounds);
    const T = fact.a, lnT = Math.log(T);
    const rsd = refSd(fact);
    const st = {
      fact, rounds, round: 0, done: false,
      estimate: null,
      quotes: [], trades: [], prints: [], compHist: [],
      inv: 0, cash: 0, cuts: 0, cutUnits: 0, carryPaid: 0,
      comp: { logMid: lnT + rsd * P.compBiasMult * gauss(rand), hw: rsd * P.compHwMult },
      analyst: { mu: lnT + P.analystPrior * gauss(rand), v: P.analystPrior * P.analystPrior, last: null },
      lostFlow: 0, noiseCaptured: 0, pickedOff: 0, pressed: 0
    };

    function compQuote() { return { bid: Math.exp(st.comp.logMid - st.comp.hw), ask: Math.exp(st.comp.logMid + st.comp.hw) }; }
    function consensus() { return Math.exp(st.comp.logMid); }
    function setEstimate(x) { if (x > 0) st.estimate = x; }
    function mtmPct() { const C = consensus(); return (st.cash + st.inv * C) / C * 100; }

    // Counterparty-side semantics: side "buy" means the counterparty bought from you (you sold).
    // Returns the trade, or null if nothing could fill. Fills are capped by the size you quoted this
    // round on that side, and by the desk's risk limit (partial fills at the limit count as a cut).
    let roundFilled = { buy: 0, sell: 0 }, roundSize = 1;
    function applyFill(side, price, size, who, round, extra) {
      const dir = side === "buy" ? -1 : 1;                       // counterparty buys → you go short
      const room = (dir < 0) ? P.riskLimit + st.inv : P.riskLimit - st.inv; // units you may still add this way
      const quotedLeft = Math.max(0, roundSize - roundFilled[side]);
      let sz = Math.max(0, Math.min(size, quotedLeft));
      if (sz > room) { st.cuts += 1; st.cutUnits += sz - room; sz = Math.max(0, room); }
      if (sz === 0) return null;
      roundFilled[side] += sz;
      if (side === "buy") { st.cash += price * sz; st.inv -= sz; } else { st.cash -= price * sz; st.inv += sz; }
      const tr = Object.assign({ round, side, price, size: sz, who, venue: "player", cut: sz < size }, extra || {});
      st.trades.push(tr); st.prints.push(tr);
      return tr;
    }

    function submit(bid, ask, size) {
      if (st.done) throw new Error("market settled");
      if (!(bid > 0) || !(ask > bid)) throw new Error("bad quote");
      size = clamp(Math.round(size || 1), 1, P.maxSize);
      roundSize = size; roundFilled = { buy: 0, sell: 0 };
      const r = st.round;
      const screenOpen = r >= P.screenFrom;
      const c = screenOpen ? compQuote() : { bid: 0, ask: Infinity, hidden: true };
      st.compHist.push(screenOpen ? c : null);
      st.quotes.push({ round: r, bid, ask, size, screen: screenOpen ? c : null });
      const events = [];
      const bestAsk = Math.min(ask, c.ask), bestBid = Math.max(bid, c.bid);

      // ---- analyst: Bayesian update with this round's private signal ----
      const a = st.analyst;
      if (sig[r] === 0) { a.mu = lnT; a.v = 0; }
      else {
        const s2 = sig[r] * sig[r];
        const signal = lnT + sig[r] * gauss(rand);
        const prec = 1 / a.v + 1 / s2;
        a.mu = (a.mu / a.v + signal / s2) / prec;
        a.v = 1 / prec;
      }
      const B = Math.exp(a.mu), sd = Math.sqrt(a.v);
      const buyEdge = Math.log(B / bestAsk) - P.analystZ * sd;
      const sellEdge = Math.log(bestBid / B) - P.analystZ * sd;
      let side = null, edge = 0;
      if (buyEdge > 0) { side = "buy"; edge = buyEdge; }
      else if (sellEdge > 0) { side = "sell"; edge = sellEdge; }
      if (side) {
        const mine = side === "buy" ? ask < c.ask : bid > c.bid;   // the screen was there first: ties go to it
        let sz = clamp(Math.round(edge / (P.edgePerUnit + sd)), 1, P.maxSize);   // size grows with edge and with certainty
        let pressed = false;
        if (mine && a.last && a.last.venue === "player" && a.last.side === side && a.last.round === r - 1) {
          // you were hit last round on this side: did you move toward the trade?
          const q0 = st.quotes[r - 1];
          const prevMid = (q0.bid + q0.ask) / 2, curMid = (bid + ask) / 2;
          const gap = a.last.price - prevMid;
          if (Math.abs(gap) > 1e-9 && (curMid - prevMid) / gap < 0.25) { sz = Math.min(P.maxSize, sz + 1); pressed = true; st.pressed += 1; }
        }
        const price = side === "buy" ? (mine ? ask : c.ask) : (mine ? bid : c.bid);
        if (mine) {
          const tr = applyFill(side, price, sz, "analyst", r, { pressed, belief: B });
          if (tr) events.push(tr);
          const rest = sz - (tr ? tr.size : 0);
          const screenEdge = side === "buy" ? Math.log(B / c.ask) - P.analystZ * sd : Math.log(c.bid / B) - P.analystZ * sd;
          if (rest > 0 && screenEdge > 0) { const t2 = { round: r, side, price: side === "buy" ? c.ask : c.bid, size: rest, who: "analyst", venue: "screen", belief: B }; st.prints.push(t2); events.push(t2); st.lostFlow += rest; }
          else if (!tr) events.push({ round: r, side, price, size: sz, who: "analyst", venue: "cut", belief: B });
        } else {
          const tr = { round: r, side, price, size: sz, who: "analyst", venue: "screen", belief: B };
          st.prints.push(tr); events.push(tr); st.lostFlow += sz;
        }
        a.last = { round: r, side, price, venue: mine ? "player" : "screen" };
      } else {
        events.push({ round: r, side: "pass", who: "analyst", belief: B });
        a.last = null;
      }

      // ---- noise population ----
      const nsd = rsd * P.noiseSdMult;
      for (let i = 0; i < P.noiseN; i++) {
        if (rand() >= P.noiseArrive) continue;
        const b = T * Math.exp(nsd * clamp(gauss(rand), -P.noiseClip, P.noiseClip));
        if (b > bestAsk) {
          let tr = ask < c.ask ? applyFill("buy", ask, 1, "noise", r) : null;
          if (tr) { events.push(tr); st.noiseCaptured += 1; }
          else if (b > c.ask) { tr = { round: r, side: "buy", price: c.ask, size: 1, who: "noise", venue: "screen" }; st.prints.push(tr); events.push(tr); st.lostFlow += 1; }
        } else if (b < bestBid) {
          let tr = bid > c.bid ? applyFill("sell", bid, 1, "noise", r) : null;
          if (tr) { events.push(tr); st.noiseCaptured += 1; }
          else if (b < c.bid) { tr = { round: r, side: "sell", price: c.bid, size: 1, who: "noise", venue: "screen" }; st.prints.push(tr); events.push(tr); st.lostFlow += 1; }
        }
      }

      // ---- carry: holding inventory costs a little every round ----
      const carry = Math.abs(st.inv) * consensus() * P.carry;
      st.cash -= carry; st.carryPaid += carry;
      const cutThisRound = events.some(e => e.venue === "cut" || e.cut);

      // ---- the screen learns from this round's prints and tightens ----
      const roundPrints = st.prints.filter(p => p.round === r);
      let buyU = 0, sellU = 0;
      roundPrints.forEach(p => { if (p.side === "buy") buyU += p.size; else sellU += p.size; });
      const tot = buyU + sellU;
      if (tot > 0) st.comp.logMid += P.compLearn * ((buyU - sellU) / tot) * st.comp.hw;
      st.comp.hw *= P.compTighten;

      st.round += 1;
      if (st.round >= rounds) settle(bid, ask);
      return { events, round: r, done: st.done, cut: cutThisRound, mtmPct: mtmPct(), inv: st.inv };
    }

    function settle(bid, ask) {
      st.done = true;
      st.containsFinal = bid <= T && T <= ask;
      st.finalWidthPct = (ask - bid) / T * 100;
      // per-trade P&L as % of truth, summed over units
      st.trades.forEach(tr => {
        const per = tr.side === "buy" ? (tr.price - T) / T * 100 : (T - tr.price) / T * 100;
        tr.pnl = per * tr.size;
        if (tr.who === "analyst" && tr.pnl < 0) st.pickedOff += 1;
      });
      st.pnlPct = (st.cash + st.inv * T) / T * 100;
      st.carryPct = st.carryPaid / T * 100;
      st.noiseUnits = st.trades.filter(t => t.who === "noise").reduce((a, t) => a + t.size, 0);
      // market quality: your interval score vs a reference market centred on the truth with the
      // screen's (unbiased) width schedule. 100 = at least that tight and never missed.
      let isP = 0, isC = 0, isR = 0;
      let nC = 0;
      st.quotes.forEach((q, r) => {
        isP += intervalScore(q.bid, q.ask, T);
        if (q.screen) { isC += intervalScore(q.screen.bid, q.screen.ask, T); nC += 1; }
        const hw = rsd * P.compHwMult * Math.pow(P.compTighten, r);
        isR += intervalScore(T * Math.exp(-hw), T * Math.exp(hw), T);
      });
      isP /= st.quotes.length; isC = nC ? isC / nC : isP; isR /= st.quotes.length;
      st.isPlayer = isP; st.isScreen = isC; st.isRef = isR;
      st.marketScore = Math.round(100 * clamp(isR / Math.max(isP, 1e-9), 0, 1));
      st.beatScreen = isP < isC;
      st.roundsContained = st.quotes.filter(q => q.bid <= T && T <= q.ask).length;
      // estimate
      if (st.estimate) { st.estErrPct = (st.estimate / T - 1) * 100; st.estLogErr = Math.abs(Math.log(st.estimate / T)); }
      // xp: for pricing, not for knowing; and only if you actually made a market someone traded
      const filled = st.trades.length > 0;
      let xp = 5;
      if (filled && st.marketScore >= 50) xp += 10;
      if (filled && st.marketScore >= 70) xp += 10;
      if (filled && st.marketScore >= 85) xp += 10;
      if (st.pnlPct > 0) xp += 10;
      if (st.containsFinal) xp += 5;
      if (filled && st.cuts === 0) xp += 5;
      st.xp = xp;
      st.blownUp = st.pnlPct < -40;
    }

    return { state: st, submit, setEstimate, compQuote, consensus, mtmPct, screenOpen: () => st.round >= P.screenFrom, T, sig, rsd };

  }

  // ---------------- Screen ----------------
  // opts: { facts, unitId, practice, rounds, seed, onDone }
  function play(opts) {
    const facts = opts.facts;
    const rounds = opts.rounds || 5;
    let idx = 0;
    const results = [];
    const L = Lesson.open({ practice: opts.practice, confirmQuit: true, onClose: (aborted) => { if (opts.onDone) opts.onDone({ aborted, results }); } });
    let eng = null, lastQuote = null, lastSize = 2;

    function setProgress() { L.setProgress((idx * (rounds + 1) + (eng ? eng.state.round + (eng.state.estimate ? 1 : 0) : 0)) / (facts.length * (rounds + 1))); }

    function startFact() {
      eng = createEngine({ fact: facts[idx], rounds, seed: opts.seed !== undefined ? opts.seed + idx : undefined });
      lastQuote = null;
      renderEstimate();
    }

    function header(fact, extraChips) {
      return el("div", { class: "row wrap" }, [el("span", { class: "chip" }, fact.cat || "custom"), fact.unit ? el("span", { class: "chip" }, fact.unit) : null].concat(extraChips || []));
    }

    function renderEstimate() {
      L.reset(); setProgress();
      const fact = eng.state.fact;
      const inp = el("input", { class: "input num", inputmode: "decimal", placeholder: "e.g. 150 or 1.2m" });
      L.inner.append(
        header(fact, [el("span", { class: "chip brand" }, "Step 1 of 2")]),
        el("h2", { class: "question" }, fact.q),
        el("p", { class: "muted small" }, "Before you see any prices: what's your best single guess? This is scored on its own, so an honest rough number is fine."),
        el("div", { class: "quote-box" }, [el("label", { class: "lab" }, "Your estimate"), inp])
      );
      const btn = L.setFoot("", "", "", "Lock estimate", () => {
        const v = parseNum(inp.value);
        if (!(v > 0)) return;
        eng.setEstimate(v); haptic("tap"); renderRound();
      });
      inp.addEventListener("input", () => { btn.disabled = !(parseNum(inp.value) > 0); });
      inp.addEventListener("keydown", e => { if (e.key === "Enter" && !btn.disabled) btn.click(); });
      btn.disabled = true;
      inp.focus();
    }

    function statRow() {
      const s = eng.state;
      const m = eng.mtmPct();
      return el("div", { class: "result-row" }, [
        Lesson.box((s.inv > 0 ? "+" : "") + s.inv, "inventory (limit ±" + P.riskLimit + ")", Math.abs(s.inv) >= P.riskLimit - 1 ? "ask" : ""),
        Lesson.box(fmtPct(m), "marked to screen", m < 0 ? "ask" : ""),
        Lesson.box(String(s.trades.reduce((a, t) => a + t.size, 0)) + (s.lostFlow ? " · " + s.lostFlow : ""), "units filled" + (s.lostFlow ? " · lost to screen" : ""))
      ]);
    }

    function renderRound() {
      L.reset(); setProgress();
      const s = eng.state, fact = s.fact, r = s.round;
      const open = eng.screenOpen();
      const c = open ? eng.compQuote() : null;
      L.inner.append(
        header(fact, [el("span", { class: "chip brand" }, "Round " + (r + 1) + " of " + rounds)]),
        el("h2", { class: "question" }, fact.q),
        el("p", { class: "muted small" }, r === 0
          ? "Quote blind: a bid you'd buy at, an ask you'd sell at, and how many units at each. Width is your uncertainty. From the next round another market maker's quote (the screen) opens beside yours."
          : r === P.screenFrom ? "The screen is live. It was there first, so you only get flow where your price is strictly better. Go inside it where you're confident, stay outside where you're not."
          : "Re-quote. Every print is information: one-sided flow means your market is off, a repeat hitter means you didn't move enough, prints at the screen tell you where others are trading.")
      );
      const ladder = el("div", { class: "ladder" });
      L.inner.appendChild(ladder);
      L.inner.appendChild(el("div", { class: "spreadline" }, open ? [
        el("span", { class: "chip" }, "screen"), " ", el("b", { class: "bid-text num" }, fmt(c.bid)), " / ", el("b", { class: "ask-text num" }, fmt(c.ask)),
        el("span", { class: "muted" }, "  · your estimate " + fmt(s.estimate))
      ] : [el("span", { class: "chip" }, "screen opens next round"), el("span", { class: "muted" }, "  · your estimate " + fmt(s.estimate))]));
      L.inner.appendChild(statRow());

      const bidIn = el("input", { class: "input bid num", inputmode: "decimal", placeholder: "bid" });
      const askIn = el("input", { class: "input ask num", inputmode: "decimal", placeholder: "ask" });
      if (lastQuote) { bidIn.value = fmtInput(lastQuote.bid); askIn.value = fmtInput(lastQuote.ask); }
      const nudge = (inp, pct) => { const v = parseNum(inp.value); if (isNaN(v)) return; inp.value = fmtInput(v * (1 + pct)); update(); };
      const sizeBtns = [1, 2, 3, 4, 5].map(n => el("button", { class: "btn xs" + (n === lastSize ? " primary" : ""), onclick: () => { lastSize = n; sizeBtns.forEach((b, i) => b.classList.toggle("primary", i + 1 === n)); haptic("tap"); } }, String(n)));
      L.inner.append(
        el("div", { class: "quote-grid" }, [
          el("div", { class: "quote-box bid" }, [el("label", { class: "lab" }, "Your bid (you buy)"), bidIn, el("div", { class: "nudge" }, [el("button", { class: "btn xs soft-bid", onclick: () => nudge(bidIn, -0.1) }, "−10%"), el("button", { class: "btn xs soft-bid", onclick: () => nudge(bidIn, 0.1) }, "+10%")])]),
          el("div", { class: "quote-box ask" }, [el("label", { class: "lab" }, "Your ask (you sell)"), askIn, el("div", { class: "nudge" }, [el("button", { class: "btn xs soft-ask", onclick: () => nudge(askIn, -0.1) }, "−10%"), el("button", { class: "btn xs soft-ask", onclick: () => nudge(askIn, 0.1) }, "+10%")])])
        ]),
        el("div", { class: "widen" }, [
          el("button", { class: "btn xs", onclick: () => { nudge(bidIn, -0.1); nudge(askIn, 0.1); } }, "Widen"),
          el("button", { class: "btn xs", onclick: () => { nudge(bidIn, 0.1); nudge(askIn, -0.1); } }, "Tighten"),
          el("button", { class: "btn xs", onclick: () => { nudge(bidIn, 0.15); nudge(askIn, 0.15); } }, "Shift up"),
          el("button", { class: "btn xs", onclick: () => { nudge(bidIn, -0.15); nudge(askIn, -0.15); } }, "Shift down")
        ]),
        el("div", { class: "row between wrap", style: { marginTop: "10px" } }, [el("span", { class: "lab", style: { margin: 0 } }, "Size per side"), el("div", { class: "row" }, sizeBtns)])
      );
      const info = el("div", { class: "spreadline" });
      L.inner.appendChild(info);
      if (s.prints.length) L.inner.appendChild(renderLog(eng, false));

      function update() {
        const b = parseNum(bidIn.value), a = parseNum(askIn.value);
        bidIn.classList.toggle("invalid", bidIn.value !== "" && (isNaN(b) || b <= 0));
        askIn.classList.toggle("invalid", askIn.value !== "" && (isNaN(a) || (!isNaN(b) && a <= b)));
        const ok = b > 0 && a > b;
        if (ok) {
          const mid = (a + b) / 2;
          const tighter = c ? (b > c.bid ? "bid" : "") + (a < c.ask ? (b > c.bid ? " and ask" : "ask") : "") : "";
          info.innerHTML = "Mid <b>" + fmt(mid) + "</b> · width <b>" + ((a - b) / mid * 100).toFixed(0) + "%</b> of mid" + (c ? " · " + (tighter ? "better than the screen on <b>" + tighter + "</b>" : "<span class='muted'>not better than the screen on either side: you get no flow</span>") : "");
        } else info.innerHTML = "<span class='muted'>Ask must be above bid.</span>";
        submitBtn.disabled = !ok;
        drawLadder(ladder, s.quotes, s.trades, ok ? { bid: b, ask: a } : null, null, c);
        return;
      }
      bidIn.addEventListener("input", update); askIn.addEventListener("input", update);
      bidIn.addEventListener("keydown", e => { if (e.key === "Enter") askIn.focus(); });
      askIn.addEventListener("keydown", e => { if (e.key === "Enter" && !submitBtn.disabled) submitBtn.click(); });
      const submitBtn = L.setFoot("", "", "", "Quote", () => {
        const b = parseNum(bidIn.value), a = parseNum(askIn.value);
        if (!(b > 0 && a > b)) return;
        lastQuote = { bid: b, ask: a };
        const res = eng.submit(b, a, lastSize);
        haptic("tap");
        L.inner.querySelectorAll("input,button").forEach(n => { if (!n.closest(".lesson-foot")) n.disabled = true; });
        afterSubmit(res, ladder, c);
      });
      update();
      if (!lastQuote) bidIn.focus();
    }

    function afterSubmit(res, ladder, c) {
      const s = eng.state;
      drawLadder(ladder, s.quotes, s.trades, lastQuote, null, c);
      const old = L.inner.querySelector(".log"); if (old) old.remove();
      L.inner.appendChild(renderLog(eng, false));
      const oldStats = L.inner.querySelector(".result-row"); if (oldStats) oldStats.replaceWith(statRow());
      const mine = res.events.filter(e => e.venue === "player");
      const theirs = res.events.filter(e => e.venue === "screen");
      let title, sub, tone;
      if (res.cut) {
        title = "Line cut at ±" + P.riskLimit + ".";
        sub = "The desk refused the size that would have taken you further. You can only trade back now: skew your market against your position.";
        tone = "bad"; haptic("bad"); shake(L.body);
      } else if (mine.length === 0) {
        title = theirs.length ? "No fills. The screen got " + theirs.reduce((a, t) => a + t.size, 0) + " unit" + (theirs.reduce((a, t) => a + t.size, 0) > 1 ? "s" : "") + "." : "No trade.";
        sub = theirs.length ? "Flow goes to the better price. You can see those prints; use them." : "Nobody wanted to trade at these prices.";
        tone = "ok";
      } else {
        const bought = mine.filter(e => e.side === "buy").reduce((a, t) => a + t.size, 0);
        const sold = mine.filter(e => e.side === "sell").reduce((a, t) => a + t.size, 0);
        const pressed = mine.some(e => e.pressed);
        title = (bought ? bought + " lifted your offer" : "") + (bought && sold ? ", " : "") + (sold ? sold + " hit your bid" : "") + ".";
        sub = pressed ? "Someone hit you on the same side as last round, harder, because you didn't move. You're " + posWord(s) + "." :
          bought && !sold ? "All buyers. Either your market is low or your ask is the cheapest on the screen. You're " + posWord(s) + "." :
          sold && !bought ? "All sellers. Either your market is high or your bid is the best on the screen. You're " + posWord(s) + "." :
          "Two-way flow. That's the spread paying you. You're " + posWord(s) + ".";
        tone = "neutral"; haptic("hit");
      }
      L.setFoot(tone, title, sub, res.done ? "Settle" : "Next round", () => res.done ? showResult() : renderRound());
      setProgress();
    }

    function posWord(s) {
      if (s.inv === 0) return "flat";
      return (s.inv > 0 ? "long " : "short ") + Math.abs(s.inv);
    }

    function showResult() {
      const s = eng.state, fact = s.fact, T = eng.T;
      results.push({ fact, pnl: s.pnlPct, xp: s.xp, contains: s.containsFinal, blownUp: s.blownUp, marketScore: s.marketScore, estErrPct: s.estErrPct });
      if (!opts.practice && s.blownUp) { State.loseHeart(); L.refreshHearts(); }
      L.reset(); L.setProgress((idx + 1) / facts.length);
      const pos = s.pnlPct >= 0;
      L.inner.append(
        el("div", { class: "result-hero" }, [el("div", { class: "big " + (pos ? "pos" : "neg") }, fmtPct(s.pnlPct)), el("p", { class: "muted" }, "flow P&L as a share of the true value, all units")]),
        el("div", { class: "card gold" }, [
          el("p", { class: "tiny" }, "THE NUMBER"),
          el("h2", {}, fmt(T, { compact: false }) + (fact.unit ? " " + fact.unit : "")),
          el("p", { class: "small", style: { marginTop: "6px" } }, fact.note || ""),
          fact.tol === "approx" ? el("p", { class: "tiny", style: { marginTop: "6px" } }, "Best public estimate; treat the last few percent as noise.") : null
        ])
      );
      const ladder = el("div", { class: "ladder" });
      L.inner.appendChild(ladder);
      drawLadder(ladder, s.quotes, s.trades, lastQuote, T, s.compHist[s.compHist.length - 1] || null);
      L.inner.append(
        el("div", { class: "result-row" }, [
          Lesson.box(estWord(s), "your estimate: " + fmtPct(s.estErrPct, 0), ""),
          Lesson.box(String(s.marketScore), "calibration (100 = expert-tight, never missed)", s.marketScore >= 70 ? "gold" : ""),
          Lesson.box("+" + s.xp, "xp", "gold")
        ]),
        el("div", { class: "result-row" }, [
          Lesson.box(s.roundsContained + "/" + s.rounds, "rounds containing it", s.roundsContained === s.rounds ? "gold" : ""),
          Lesson.box(String(s.noiseUnits), "noise units captured"),
          Lesson.box(fmtPct(-s.carryPct, 1).replace("+", ""), "carry" + (s.cuts ? " · line cut ×" + s.cuts : ""), s.cuts ? "ask" : "")
        ]),
        renderLog(eng, true),
        el("div", { class: "lesson-note", html: lessonText(s, T) })
      );
      if (s.pnlPct > 0 && s.marketScore >= 50) { confetti(); haptic("win"); }
      else if (s.blownUp) { shake(L.body); haptic("bad"); }
      const last = idx === facts.length - 1;
      L.setFoot(pos ? "ok" : "bad",
        s.blownUp ? "Blown up. Heart lost." : s.beatScreen && s.marketScore >= 70 ? "Better market than the screen." : s.marketScore >= 70 ? "Well calibrated." : pos ? "Profitable, but the screen priced it better." : "You paid for your market.",
        s.estLogErr !== undefined && s.estLogErr > 0.7 && s.marketScore >= 60 ? "Your estimate was far off and your market still beat the screen. That is the skill." : s.pressed ? "You were pressed " + s.pressed + " time" + (s.pressed > 1 ? "s" : "") + " for not moving after a hit." : s.cuts ? "Your line was cut " + s.cuts + " time" + (s.cuts > 1 ? "s" : "") + "; carry cost you " + fmtPct(-s.carryPct, 1) + "." : s.lostFlow ? s.lostFlow + " units of flow went to the screen instead of you." : "You took every unit of flow that came.",
        last ? "Finish" : "Next market", () => { idx += 1; if (last) summary(); else startFact(); });
    }

    function estWord(s) {
      if (s.estLogErr === undefined) return "–";
      return s.estLogErr < 0.1 ? "Sharp" : s.estLogErr < 0.3 ? "Fine" : s.estLogErr < 0.7 ? "Rough" : "Way off";
    }

    function lessonText(s, T) {
      const parts = [];
      const q0 = s.quotes[0];
      const w0 = Math.log(q0.ask / q0.bid) / 2, ref = eng.rsd;
      if (s.estLogErr !== undefined) {
        if (s.estLogErr > 0.5 && w0 < s.estLogErr) parts.push("Your estimate was " + (s.estErrPct > 0 ? "high" : "low") + " by " + Math.round(Math.abs(s.estErrPct)) + "% but your opening market was only ±" + Math.round(w0 * 100) + "% wide, so it <b>missed</b>. The width has to cover how wrong your estimate could be, not how wrong it feels.");
        else if (s.estLogErr > 0.5) parts.push("Your estimate was off by " + Math.round(Math.abs(s.estErrPct)) + "% and your market was wide enough to survive it. That is calibration, and it is worth more than knowing the number.");
        else if (w0 > ref * 1.5 && s.estLogErr < 0.15) parts.push("Your estimate was within 15% but your opening market was ±" + Math.round(w0 * 100) + "%. You knew more than you quoted; the screen took the flow you left on the table.");
      }
      const anBad = s.trades.filter(t => t.who === "analyst" && t.pnl < 0);
      if (anBad.length) parts.push("The analyst cost you " + fmtPct(anBad.reduce((a, t) => a + t.pnl, 0)) + ". Each of those prints told you which way to shift; the fix is to move the whole market toward the trade, by more than feels comfortable, not just to widen.");
      if (s.pressed) parts.push("You were hit on the same side two rounds running without moving: the analyst sized up because you were slow. Stale quotes are the most expensive thing in this game.");
      if (s.cuts) parts.push("Your line was cut " + s.cuts + " time" + (s.cuts > 1 ? "s" : "") + ": you reached ±" + P.riskLimit + " and the desk refused more. When you're long, shade the whole market lower so buyers lift you and sellers stay away; when short, the reverse. Carry cost you " + fmtPct(-s.carryPct, 1).replace("+", "") + " on top.");
      if (s.lostFlow > 0 && s.noiseUnits === 0) parts.push("You captured no noise flow while the screen took " + s.lostFlow + " units: you were never the best price. Being wide is right when you're unsure, but then you earn nothing; that trade-off is the whole job.");
      if (s.marketScore >= 70) parts.push("Your markets were close to expert-tight and contained the number in " + s.roundsContained + " of " + s.rounds + " rounds" + (s.beatScreen ? ", and they were better than the screen's" : "") + ". That is what a good market maker's P&L looks like over time, whatever one settlement says.");
      if (!s.trades.length) parts.push("Nobody traded with you in five rounds: you were never strictly better than the screen on either side. Matching the screen is watching a market, not making one.");
      return parts.join(" ") || "Clean round. Try a size of 4 or 5 next time and see what inventory does to you.";
    }

    function summary() {
      L.reset(); L.setProgress(1);
      const totalXp = results.reduce((a, r) => a + r.xp, 0);
      const totalPnl = results.reduce((a, r) => a + r.pnl, 0);
      const avgMs = Math.round(results.reduce((a, r) => a + r.marketScore, 0) / results.length);
      if (!opts.practice) { State.addXP(totalXp); if (opts.unitId) State.completeLesson(opts.unitId); }
      State.record("number-markets", Math.round(totalPnl), { n: results.length, marketScore: avgMs });
      L.inner.append(
        el("div", { class: "row", style: { gap: "16px", marginTop: "10px" } }, [
          el("div", { html: UI.mascot(avgMs >= 50 ? "happy" : "sad") }),
          el("div", { class: "speech grow" }, avgMs >= 70 ? "Well calibrated. The P&L follows from that, eventually." : avgMs >= 50 ? "Decent. Tighten where you know, widen where you don't, and move with the flow." : "Your widths didn't match your uncertainty, or you didn't move when the flow told you to.")
        ]),
        el("div", { class: "result-row" }, [Lesson.box("+" + totalXp, "xp earned", "gold"), Lesson.box(fmtPct(totalPnl), "total flow p&l"), Lesson.box(String(avgMs), "avg calibration", avgMs >= 70 ? "gold" : "")]),
        el("table", { class: "table" }, [
          el("thead", {}, el("tr", {}, [el("th", {}, "Market"), el("th", {}, "True"), el("th", {}, "Estimate"), el("th", {}, "Calib."), el("th", {}, "P&L")])),
          el("tbody", {}, results.map(r => el("tr", {}, [
            el("td", {}, r.fact.q), el("td", { class: "num" }, fmt(r.fact.a)),
            el("td", { class: "num" }, fmtPct(r.estErrPct, 0)), el("td", { class: "num" }, String(r.marketScore)),
            el("td", { class: "num pnl " + (r.pnl >= 0 ? "pos" : "neg") }, fmtPct(r.pnl))
          ])))
        ])
      );
      if (avgMs >= 50 && totalPnl > 0) confetti();
      L.setFoot("ok", "Lesson complete", "", "Continue", () => L.close(false));
    }

    startFact();
    return { close: () => L.close(true) };
  }

  function fmtInput(v) { return Math.abs(v) >= 1000 ? String(Math.round(v)) : String(Math.round(v * 100) / 100); }
  function sig2(v) { if (v <= 0) return v; const p = Math.pow(10, Math.floor(Math.log10(v)) - 1); return Math.round(v / p) * p; }

  function renderLog(eng, revealed) {
    const T = eng.T, s = eng.state;
    const log = el("div", { class: "log" });
    s.quotes.forEach(q => {
      const rp = s.prints.filter(p => p.round === q.round);
      log.appendChild(el("div", { class: "log-row" }, [
        el("span", { class: "r" }, q.round + 1),
        el("span", { class: "bid-text num" }, fmt(q.bid)), el("span", { class: "muted" }, "/"), el("span", { class: "ask-text num" }, fmt(q.ask)),
        el("span", { class: "muted small" }, "×" + q.size),
        el("span", { class: "muted small" }, q.screen ? "screen " + fmt(q.screen.bid) + " / " + fmt(q.screen.ask) : "no screen"),
        el("span", { class: "muted small" }, rp.length ? "" : "no prints")
      ]));
      rp.forEach(t => {
        const mine = t.venue === "player";
        const who = revealed ? (t.who === "analyst" ? "analyst" : "noise") : "trader";
        log.appendChild(el("div", { class: "log-row " + (mine ? t.side : ""), style: mine ? null : { opacity: 0.6 } }, [
          el("span", { class: "r" }, t.side === "buy" ? "↑" : "↓"),
          el("span", {}, (t.side === "buy" ? "Bought " : "Sold ") + t.size + " at " + fmt(t.price) + (mine ? "" : " from the screen")),
          el("span", { class: "chip " + (revealed ? (t.who === "analyst" ? "ask" : "bid") : "") }, who + (t.pressed ? " · pressed" : "") + (t.cut ? " · partial, line cut" : "")),
          revealed && mine ? el("span", { class: "pnl " + (t.pnl >= 0 ? "pos" : "neg") }, fmtPct(t.pnl)) : null
        ]));
      });
    });
    return log;
  }

  // Log-scale number line: screen band (grey), past quotes (faint), live quote, trade chips, truth.
  function drawLadder(ladder, quotes, trades, live, truth, screen) {
    clear(ladder);
    const pts = [];
    quotes.forEach(q => { pts.push(q.bid, q.ask); if (q.screen) pts.push(q.screen.bid, q.screen.ask); });
    if (live) pts.push(live.bid, live.ask);
    if (screen) pts.push(screen.bid, screen.ask);
    if (truth) pts.push(truth);
    if (!pts.length) { ladder.appendChild(el("div", { class: "axis" })); return; }
    let lo = Math.min(...pts) / 1.6, hi = Math.max(...pts) * 1.6;
    const Lg = Math.log(lo), H = Math.log(hi);
    const x = v => ((Math.log(Math.max(v, 1e-9)) - Lg) / (H - Lg) * 100);
    ladder.appendChild(el("div", { class: "axis" }));
    [lo * 1.1, Math.sqrt(lo * hi), hi / 1.1].forEach(v => {
      const r = sig2(v);
      if (truth && Math.abs(x(r) - x(truth)) < 12) return;
      ladder.appendChild(el("div", { class: "tick", style: { left: x(r) + "%" } }, fmt(r)));
    });
    if (screen) ladder.appendChild(el("div", { class: "band screen", style: { left: x(screen.bid) + "%", width: Math.max(0.5, x(screen.ask) - x(screen.bid)) + "%" } }));
    quotes.forEach(q => {
      if (live && q.bid === live.bid && q.ask === live.ask) return;
      ladder.appendChild(el("div", { class: "band ghost", style: { left: x(q.bid) + "%", width: Math.max(0.5, x(q.ask) - x(q.bid)) + "%" } }));
    });
    if (live) {
      ladder.appendChild(el("div", { class: "band", style: { left: x(live.bid) + "%", width: Math.max(0.5, x(live.ask) - x(live.bid)) + "%" } }));
      ladder.appendChild(el("div", { class: "handle bid", style: { left: x(live.bid) + "%" } }));
      ladder.appendChild(el("div", { class: "handle ask", style: { left: x(live.ask) + "%" } }));
    }
    // aggregate chips that would sit on top of each other (same side, within 3% of the width)
    const groups = [];
    trades.forEach(t => {
      const px = x(t.price);
      const g = groups.find(gr => gr.side === t.side && Math.abs(gr.px - px) < 3);
      if (g) { g.size += t.size; g.n += 1; } else groups.push({ side: t.side, px, size: t.size, n: 1 });
    });
    groups.forEach((g, i) => {
      ladder.appendChild(el("div", { class: "trade " + g.side, title: g.n + " fill" + (g.n > 1 ? "s" : ""), style: { left: g.px + "%", top: (g.side === "buy" ? 2 : 22) + "px" } }, (g.side === "buy" ? "▲" : "▼") + g.size));
    });
    if (truth) {
      ladder.appendChild(el("div", { class: "truth", style: { left: x(truth) + "%" } }, "★"));
      ladder.appendChild(el("div", { class: "truth-label", style: { left: x(truth) + "%" } }, fmt(truth)));
    }
  }

  return { createEngine, play, sigmaSchedule, intervalScore, drawLadder, refSd, P, REF_SD };
})();
