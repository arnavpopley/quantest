/* Spread Arena.
   45 seconds of live quoting. The fair value drifts and jumps on news. You only see a lagging
   indicator and the prints. Noise traders hit you more when you're tight; the informed trader
   hits you when you're stale. Manage spread, skew, and inventory. Graded against a baseline bot
   on the same price path. */

window.Arena = (function () {
  const { el, clear, fmt, haptic, confetti, shake, rng, gauss } = UI;
  const DURATION_TICKS = 450; // 100 ms per tick
  const TICK_MS = 100;
  // model constants, shared by the live game and the replayed baseline
  const P = { vol: 0.055, jumpP: 0.012, lag: 0.08, infP: 0.2, infTh: 0.05, noiseA: 0.11, noiseK: 1.6, hedgeFee: 0.3, skewPull: 0.8, invCost: 0.0025 };

  function simulate(params) {
    // Pure simulator so the baseline bot can be replayed on the same path.
    // params: { seed, decide(state) -> {spread, skew, hedge}, pathSeed }
    const path = rng(params.pathSeed);
    const flow = rng(params.seed);
    let F = 100;
    let ind = 100;
    const st = { t: 0, F, ind, cash: 0, inv: 0, trades: [], pickedOff: 0, noise: 0, hedges: 0, maxInv: 0, jumps: [], pnlSeries: [] };
    const out = [];
    for (let t = 0; t < DURATION_TICKS; t++) {
      // price path (shared)
      F += P.vol * gauss(path);
      if (path() < P.jumpP) { const j = (0.5 + 1.0 * path()) * (path() < 0.5 ? -1 : 1); F += j; st.jumps.push({ t, j }); }
      ind += P.lag * (F - ind);
      st.t = t; st.F = F; st.ind = ind;
      const d = params.decide(st);
      const mid = ind + d.skew;
      const bid = mid - d.spread / 2, ask = mid + d.spread / 2;
      st.bid = bid; st.ask = ask;
      // hedge request: flatten at a cost of 0.3 per unit
      if (d.hedge && st.inv !== 0) {
        const units = Math.abs(st.inv);
        st.cash += st.inv * F - units * P.hedgeFee;
        st.trades.push({ t, kind: "hedge", units, price: F });
        st.inv = 0; st.hedges += 1;
      }
      // informed trader: reacts when your quote is stale against the true fair value,
      // once per stale episode (they take the free money, then wait for you to move)
      let ev = null;
      if (F >= bid && F <= ask) st.staleHit = false;
      if (!st.staleHit && F > ask + P.infTh && flow() < P.infP) { st.cash += ask; st.inv -= 1; ev = { t, kind: "informed", side: "buy", price: ask, edge: F - ask }; st.pickedOff += 1; st.staleHit = true; }
      else if (!st.staleHit && F < bid - P.infTh && flow() < P.infP) { st.cash -= bid; st.inv += 1; ev = { t, kind: "informed", side: "sell", price: bid, edge: bid - F }; st.pickedOff += 1; st.staleHit = true; }
      // noise trader: arrives more when you're tight; inventory skew steers which side they take
      const lam = P.noiseA * Math.exp(-P.noiseK * d.spread);
      if (flow() < lam) {
        // a lower skew makes your ask the better price in the market, so more of the random flow buys from you
        const pBuy = Math.min(0.9, Math.max(0.1, 0.5 - P.skewPull * d.skew));
        const side = flow() < pBuy ? "buy" : "sell";
        if (side === "buy") { st.cash += ask; st.inv -= 1; } else { st.cash -= bid; st.inv += 1; }
        const e2 = { t, kind: "noise", side, price: side === "buy" ? ask : bid, edge: side === "buy" ? ask - F : F - bid };
        st.noise += 1;
        if (ev) st.trades.push(ev);
        ev = e2;
      }
      if (ev) st.trades.push(ev);
      st.cash -= P.invCost * Math.abs(st.inv);
      st.invCostPaid = (st.invCostPaid || 0) + P.invCost * Math.abs(st.inv);
      st.maxInv = Math.max(st.maxInv, Math.abs(st.inv));
      const pnl = st.cash + st.inv * F;
      st.pnl = pnl;
      st.pnlSeries.push(pnl);
      out.push({ t, F, ind, bid, ask, ev, inv: st.inv, pnl });
    }
    st.finalPnl = st.cash + st.inv * F;
    return { st, frames: out };
  }

  function baseline(pathSeed, seed) {
    return simulate({ pathSeed, seed, decide: () => ({ spread: 0.8, skew: 0, hedge: false }) });
  }

  function play(opts) {
    opts = opts || {};
    const pathSeed = opts.seed !== undefined ? opts.seed : (Math.random() * 2 ** 32) >>> 0;
    const flowSeed = (pathSeed * 7 + 13) >>> 0;
    const L = Lesson.open({ practice: opts.practice, confirmQuit: true, progressClass: "brand", onClose: (ab) => { stop(); if (opts.onDone) opts.onDone(ab); } });
    const ctl = { spread: 0.6, skew: 0, hedge: false };
    let timer = null;

    // live simulation driven by the same engine, one tick per interval
    const live = { gen: null, frames: [], st: null };
    const path = rng(pathSeed);
    const flow = rng(flowSeed);
    let F = 100, ind = 100;
    const st = { t: 0, cash: 0, inv: 0, trades: [], pickedOff: 0, noise: 0, hedges: 0, maxInv: 0, jumps: [], pnl: 0 };

    L.inner.append(
      el("div", { class: "row wrap between" }, [el("span", { class: "chip brand" }, "Spread Arena"), el("span", { class: "chip", id: "ar-clock" }, "45.0s")]),
      el("h2", { class: "question" }, "Keep a market. Don't get run over."),
      el("p", { class: "muted small" }, "Gold line is a lagging indicator of fair value. Blue dots are noise fills, red dots are the informed trader picking off a stale quote. Tight spread attracts flow. Inventory costs carry every tick, so skew your market when you are long or short.")
    );
    const wrap = el("div", { class: "arena-wrap" });
    const lad = el("div", { class: "arena-ladder" });
    const fairLine = el("div", { class: "fair" }, el("span", {}, "indicator"));
    const bidLine = el("div", { class: "q bid" }, el("span", {}, "bid"));
    const askLine = el("div", { class: "q ask" }, el("span", {}, "ask"));
    lad.append(el("div", { class: "mid" }), fairLine, bidLine, askLine);
    const stats = el("div", { class: "arena-stats" });
    const sPnl = stat("0.00", "p&l"), sInv = stat("0", "inventory"), sSpread = stat("0.60", "spread"), sSkew = stat("+0.00", "skew");
    stats.append(sPnl.node, sInv.node, sSpread.node, sSkew.node);
    const ctls = el("div", { class: "arena-ctl" }, [
      el("div", { class: "grp" }, [el("label", { class: "lab" }, "Spread"), el("div", { class: "pair" }, [
        el("button", { class: "btn xs", onclick: () => setSpread(ctl.spread - 0.2) }, "Tighten"),
        el("button", { class: "btn xs", onclick: () => setSpread(ctl.spread + 0.2) }, "Widen")])]),
      el("div", { class: "grp" }, [el("label", { class: "lab" }, "Skew"), el("div", { class: "pair" }, [
        el("button", { class: "btn xs soft-ask", onclick: () => setSkew(ctl.skew - 0.2) }, "▼ lower"),
        el("button", { class: "btn xs soft-bid", onclick: () => setSkew(ctl.skew + 0.2) }, "▲ higher")])]),
      el("div", { class: "grp", style: { gridColumn: "1 / -1" } }, [el("label", { class: "lab" }, "Inventory"), el("button", { class: "btn gold sm", onclick: () => { ctl.hedge = true; haptic("tap"); } }, "Hedge to flat (costs 0.30 per unit)")])
    ]);
    wrap.append(lad, stats, ctls);
    L.inner.appendChild(wrap);
    const startBtn = L.setFoot("neutral", "Ready?", "45 seconds. Keyboard: ← → spread, ↑ ↓ skew, H hedge.", "Start", start);

    function stat(v, k) { const vv = el("div", { class: "v" }, v); return { node: el("div", { class: "s" }, [vv, el("div", { class: "k" }, k)]), set: x => vv.textContent = x }; }
    function setSpread(v) { ctl.spread = Math.max(0.2, Math.min(3, Math.round(v * 10) / 10)); sSpread.set(ctl.spread.toFixed(2)); haptic("tap"); }
    function setSkew(v) { ctl.skew = Math.max(-1.5, Math.min(1.5, Math.round(v * 10) / 10)); sSkew.set((ctl.skew >= 0 ? "+" : "") + ctl.skew.toFixed(2)); haptic("tap"); }
    function onKey(e) {
      if (e.key === "ArrowLeft") { setSpread(ctl.spread - 0.2); e.preventDefault(); }
      else if (e.key === "ArrowRight") { setSpread(ctl.spread + 0.2); e.preventDefault(); }
      else if (e.key === "ArrowUp") { setSkew(ctl.skew + 0.2); e.preventDefault(); }
      else if (e.key === "ArrowDown") { setSkew(ctl.skew - 0.2); e.preventDefault(); }
      else if (e.key === "h" || e.key === "H") ctl.hedge = true;
    }

    const view = { lo: 98.4, hi: 101.6 };
    const gridEls = [0, 1, 2, 3, 4, 5, 6, 7].map(() => { const g = el("div", { class: "grid" }, el("span")); lad.appendChild(g); return g; });
    function drawGrid() {
      const step = 0.5;
      const first = Math.ceil(view.lo / step) * step;
      gridEls.forEach((g, i) => {
        const p = first + i * step;
        if (p > view.hi) { g.style.display = "none"; return; }
        g.style.display = "block"; g.style.top = y(p) + "%"; g.firstChild.textContent = p.toFixed(1);
      });
    }
    function y(p) { return (1 - (p - view.lo) / (view.hi - view.lo)) * 100; }

    function tick() {
      const t = st.t;
      F += P.vol * gauss(path);
      if (path() < P.jumpP) { const j = (0.5 + 1.0 * path()) * (path() < 0.5 ? -1 : 1); F += j; st.jumps.push({ t, j }); }
      ind += P.lag * (F - ind);
      const mid = ind + ctl.skew;
      const bid = mid - ctl.spread / 2, ask = mid + ctl.spread / 2;
      if (ctl.hedge) {
        ctl.hedge = false;
        if (st.inv !== 0) { const u = Math.abs(st.inv); st.cash += st.inv * F - u * P.hedgeFee; st.trades.push({ t, kind: "hedge", units: u, price: F }); st.inv = 0; st.hedges += 1; }
      }
      const evs = [];
      if (F >= bid && F <= ask) st.staleHit = false;
      if (!st.staleHit && F > ask + P.infTh && flow() < P.infP) { st.cash += ask; st.inv -= 1; evs.push({ t, kind: "informed", side: "buy", price: ask }); st.pickedOff += 1; st.staleHit = true; }
      else if (!st.staleHit && F < bid - P.infTh && flow() < P.infP) { st.cash -= bid; st.inv += 1; evs.push({ t, kind: "informed", side: "sell", price: bid }); st.pickedOff += 1; st.staleHit = true; }
      const lam = P.noiseA * Math.exp(-P.noiseK * ctl.spread);
      if (flow() < lam) {
        const pBuy = Math.min(0.9, Math.max(0.1, 0.5 - P.skewPull * ctl.skew));
        const side = flow() < pBuy ? "buy" : "sell";
        if (side === "buy") { st.cash += ask; st.inv -= 1; } else { st.cash -= bid; st.inv += 1; }
        evs.push({ t, kind: "noise", side, price: side === "buy" ? ask : bid }); st.noise += 1;
      }
      evs.forEach(e => st.trades.push(e));
      st.cash -= P.invCost * Math.abs(st.inv);
      st.invCostPaid = (st.invCostPaid || 0) + P.invCost * Math.abs(st.inv);
      st.maxInv = Math.max(st.maxInv, Math.abs(st.inv));
      st.pnl = st.cash + st.inv * F;
      st.t += 1;

      // view follows the indicator
      const c = (view.lo + view.hi) / 2;
      if (Math.abs(ind - c) > 0.45) { const shift = (ind - c) * 0.35; view.lo += shift; view.hi += shift; }
      drawGrid();
      fairLine.style.top = y(ind) + "%";
      bidLine.style.top = y(bid) + "%";
      askLine.style.top = y(ask) + "%";
      evs.forEach(e => {
        const dot = el("div", { class: "print " + e.kind, style: { left: (12 + 76 * (t / DURATION_TICKS)) + "%", top: y(e.price) + "%" } });
        lad.appendChild(dot);
        setTimeout(() => { dot.style.transition = "opacity 2s"; dot.style.opacity = "0.25"; }, 50);
        if (e.kind === "informed") { shake(wrap); lad.classList.remove("flash-red"); void lad.offsetWidth; lad.classList.add("flash-red"); haptic("bad"); }
        else haptic("hit");
      });
      sPnl.set((st.pnl >= 0 ? "+" : "") + st.pnl.toFixed(2));
      sPnl.node.firstChild.style.color = st.pnl >= 0 ? "var(--bid-dark)" : "var(--ask-dark)";
      sInv.set((st.inv > 0 ? "+" : "") + st.inv);
      sInv.node.firstChild.style.color = Math.abs(st.inv) >= 5 ? "var(--ask-dark)" : "var(--ink)";
      const clock = document.getElementById("ar-clock");
      if (clock) clock.textContent = ((DURATION_TICKS - st.t) * TICK_MS / 1000).toFixed(1) + "s";
      L.setProgress(st.t / DURATION_TICKS);
      if (st.t >= DURATION_TICKS) { stop(); result(); }
    }

    function start() {
      L.setFootNode(el("div", { class: "verdict" }, [el("h3", {}, "Live"), el("p", { class: "small" }, "Quote. Watch the dots. Skew against your inventory.")]));
      document.addEventListener("keydown", onKey);
      timer = setInterval(tick, TICK_MS);
    }
    function stop() { if (timer) clearInterval(timer); timer = null; document.removeEventListener("keydown", onKey); }

    function result() {
      const base = baseline(pathSeed, (flowSeed * 3 + 1) >>> 0).st;
      const edge = st.pnl - base.finalPnl;
      const pos = st.pnl >= 0;
      const xp = 5 + (pos ? 10 : 0) + (edge > 0 ? 10 : 0) + (st.pnl > 2 ? 10 : 0) + Math.min(10, st.noise);
      const blown = st.pnl < -6;
      if (!opts.practice && blown) { State.loseHeart(); L.refreshHearts(); }
      if (!opts.practice) State.addXP(xp);
      State.record("arena", Math.round(st.pnl * 100) / 100);
      L.reset();
      L.inner.append(
        el("div", { class: "result-hero" }, [el("div", { class: "big " + (pos ? "pos" : "neg") }, (pos ? "+" : "") + st.pnl.toFixed(2)), el("p", { class: "muted" }, "marked to the true fair value at the close")]),
        el("div", { class: "result-row" }, [
          Lesson.box((base.finalPnl >= 0 ? "+" : "") + base.finalPnl.toFixed(2), "baseline bot, same path"),
          Lesson.box((edge >= 0 ? "+" : "") + edge.toFixed(2), "your edge vs bot", edge > 0 ? "gold" : ""),
          Lesson.box("+" + xp, "xp", "gold")
        ]),
        el("div", { class: "result-row" }, [Lesson.box(String(st.noise), "noise fills"), Lesson.box(String(st.pickedOff), "picked off"), Lesson.box("−" + (st.invCostPaid || 0).toFixed(2), "inventory carry (max " + st.maxInv + ")")]),
        el("div", { class: "lesson-note", html: note(base) })
      );
      if (pos && edge > 0) { confetti(); haptic("win"); } else if (blown) { shake(L.body); haptic("bad"); }
      L.setFoot(pos ? "ok" : "bad", blown ? "Blown up. Heart lost." : edge > 0 ? "You beat the bot." : "The bot did better.", st.jumps.length + " news jump" + (st.jumps.length === 1 ? "" : "s") + " on this path.", "Continue", () => L.close(false));
    }

    function note(base) {
      const parts = [];
      const pickCost = st.trades.filter(e => e.kind === "informed").length;
      parts.push("Noise fills paid you roughly half your spread each; informed fills cost you the whole distance to the true value. " + (st.noise > 0 ? "You collected " + st.noise + " noise fills" : "You collected no noise fills") + " and were picked off " + pickCost + " time" + (pickCost === 1 ? "" : "s") + ".");
      if (st.maxInv >= 5) parts.push("Inventory reached " + st.maxInv + " and carrying it cost " + (st.invCostPaid || 0).toFixed(2) + ". When long, skew your market <b>lower</b> so buyers lift you and sellers stay away; the reverse when short. Hedging works too, but it costs 0.30 a unit.");
      if (st.jumps.length && pickCost >= 3) parts.push("Most of the damage came right after news jumps, while the indicator was still catching up. The defence is a wider spread the moment prints go one way.");
      if (base.finalPnl > st.pnl) parts.push("A dumb bot with a fixed 0.80 spread and no skew made " + base.finalPnl.toFixed(2) + " on this path. Beat it by being tighter in calm stretches and wider around jumps.");
      return parts.join(" ");
    }
  }

  return { play, simulate, baseline, P };
})();
