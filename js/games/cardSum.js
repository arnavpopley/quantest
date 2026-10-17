/* Card Sum Markets.
   Five cards are dealt face down. Quote the sum. One flips each round. A "peeker" who privately
   knows the last two cards trades against you; noise traders show up when your market is tight. */

window.CardSum = (function () {
  const { el, clear, fmt, fmtPct, haptic, confetti, shake, rng, gauss } = UI;
  const SUITS = ["♠", "♥", "♦", "♣"];
  const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

  function createEngine(opts) {
    opts = opts || {};
    const rand = rng(opts.seed !== undefined ? opts.seed : (Math.random() * 2 ** 32) >>> 0);
    const n = opts.cards || 5;
    // build and shuffle deck
    const deck = [];
    for (let s = 0; s < 4; s++) for (let r = 1; r <= 13; r++) deck.push({ v: r, s });
    for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
    const hand = deck.slice(0, n);
    const S = hand.reduce((a, c) => a + c.v, 0);
    const st = { hand, shown: 0, round: 0, rounds: n, quotes: [], trades: [], done: false, S, pnl: 0 };
    // peeker privately knows the last two cards (the ones that flip last)
    const peekKnown = hand.slice(n - 2);

    function condExpectation(shownCount) {
      // player-view expectation of the sum given the first `shownCount` cards are visible
      const seen = hand.slice(0, shownCount);
      const seenSum = seen.reduce((a, c) => a + c.v, 0);
      const remainingDeck = 52 - shownCount;
      const remainingSum = 364 - seenSum; // 4 suits × (1..13) = 364
      const meanCard = remainingSum / remainingDeck;
      return seenSum + meanCard * (n - shownCount);
    }

    function submit(bid, ask) {
      if (st.done) throw new Error("settled");
      if (!(ask > bid)) throw new Error("bad quote");
      const r = st.round;
      st.quotes.push({ round: r, bid, ask });
      const events = [];
      // peeker belief: shown cards + privately known hidden cards + expectation for the rest
      const seen = hand.slice(0, st.shown);
      let known = seen.reduce((a, c) => a + c.v, 0);
      let knownCount = st.shown;
      peekKnown.forEach((c, i) => { const idx = n - 2 + i; if (idx >= st.shown) { known += c.v; knownCount += 1; } });
      const unknown = n - knownCount;
      let belief = known + 7 * unknown + gauss(rand) * Math.sqrt(unknown) * 1.2;
      let tr = null;
      if (belief > ask + 0.5) tr = { round: r, side: "buy", price: ask, who: "informed" };
      else if (belief < bid - 0.5) tr = { round: r, side: "sell", price: bid, who: "informed" };
      if (tr) { st.trades.push(tr); events.push(tr); } else events.push({ round: r, side: "pass", who: "informed" });
      const width = ask - bid;
      const pNoise = 0.85 * Math.exp(-0.12 * width);
      if (rand() < pNoise) {
        const side = rand() < 0.5 ? "buy" : "sell";
        const nt = { round: r, side, price: side === "buy" ? ask : bid, who: "noise" };
        st.trades.push(nt); events.push(nt);
      }
      st.round += 1;
      if (st.round < st.rounds) st.shown += 1; else settle(bid, ask);
      return { events, done: st.done };
    }

    function settle(bid, ask) {
      st.done = true;
      st.shown = n;
      st.containsFinal = bid <= S && S <= ask;
      let pnl = 0, noise = 0, picked = 0;
      st.trades.forEach(t => {
        t.pnl = t.side === "buy" ? t.price - S : S - t.price;
        pnl += t.pnl;
        if (t.who === "noise") noise += 1;
        if (t.who === "informed" && t.pnl < 0) picked += 1;
      });
      st.pnl = pnl; st.noise = noise; st.pickedOff = picked;
      let xp = 5 + (pnl > 0 ? 10 : 0) + Math.min(15, noise * 5) + (st.containsFinal ? 10 : 0) + (pnl > 6 ? 10 : 0);
      st.xp = xp;
      st.blownUp = pnl < -12;
    }

    return { state: st, submit, condExpectation, S };
  }

  function cardNode(c, faceUp, flipped) {
    if (!faceUp) return el("div", { class: "pcard back" }, "?");
    const red = c.s === 1 || c.s === 2;
    return el("div", { class: "pcard " + (red ? "red " : "") + (flipped ? "flipped" : "") }, [RANKS[c.v - 1], el("span", { class: "suit" }, SUITS[c.s])]);
  }

  function play(opts) {
    opts = opts || {};
    const eng = createEngine({ seed: opts.seed });
    const st = eng.state;
    const L = Lesson.open({ practice: opts.practice, confirmQuit: true, onClose: opts.onDone });
    let last = null;

    function renderRound() {
      L.reset();
      L.setProgress(st.round / st.rounds);
      const r = st.round;
      const ev = eng.condExpectation(st.shown);
      L.inner.append(
        el("div", { class: "row wrap" }, [el("span", { class: "chip brand" }, "Round " + (r + 1) + " of " + st.rounds), el("span", { class: "chip" }, st.shown + " of 5 shown")]),
        el("h2", { class: "question" }, "What is the sum of these five cards?"),
        el("p", { class: "muted small" }, "A = 1, J = 11, Q = 12, K = 13. One card flips each round. Someone at the table has seen two of the hidden ones."),
        el("div", { class: "hand" }, st.hand.map((c, i) => cardNode(c, i < st.shown, i === st.shown - 1)))
      );
      const ladder = el("div", { class: "ladder" });
      L.inner.appendChild(ladder);
      const q = Lesson.quoteInputs(last ? { bid: last.bid, ask: last.ask } : null, 1);
      L.inner.appendChild(q.node);
      const info = el("div", { class: "spreadline" });
      L.inner.appendChild(info);
      if (st.trades.length) L.inner.appendChild(log(false));

      function update(v) {
        v = v || q.get();
        submitBtn.disabled = !v.ok;
        info.innerHTML = v.ok ? "Mid <b>" + fmt((v.bid + v.ask) / 2) + "</b> · Width <b>" + fmt(v.ask - v.bid) + "</b> points" : "<span class='muted'>Ask must be above bid. A blind five-card sum averages 35 with a standard deviation of about 8.</span>";
        Lesson.linearLadder(ladder, [5, 65], st.quotes, st.trades, v.ok ? v : null, null);
      }
      q.onChange(update);
      const submitBtn = L.setFoot("", "", "", "Quote", () => {
        const v = q.get(); if (!v.ok) return;
        last = v;
        const res = eng.submit(v.bid, v.ask);
        q.setDisabled(true);
        haptic("tap");
        afterSubmit(res, ladder, v);
      });
      q.onEnter(() => { if (!submitBtn.disabled) submitBtn.click(); });
      update();
      if (!last) q.bidIn.focus();
    }

    function afterSubmit(res, ladder, v) {
      Lesson.linearLadder(ladder, [5, 65], st.quotes, st.trades, v, null);
      const trades = res.events.filter(e => e.side !== "pass");
      const old = L.inner.querySelector(".log"); if (old) old.remove();
      L.inner.appendChild(log(false));
      if (trades.length) {
        haptic("hit");
        const t = trades[0];
        L.setFoot("neutral", (t.side === "buy" ? "Someone lifted your offer at " : "Someone hit your bid at ") + t.price + (trades.length > 1 ? " (and more)" : ""),
          t.side === "buy" ? "A buyer thinks the sum is higher. Was it the peeker?" : "A seller thinks the sum is lower. Was it the peeker?",
          res.done ? "Settle" : "Flip next card", () => res.done ? result() : renderRound());
      } else {
        L.setFoot("ok", "No trade.", "Your market held this round.", res.done ? "Settle" : "Flip next card", () => res.done ? result() : renderRound());
      }
      L.setProgress(st.round / st.rounds);
    }

    function log(revealed) {
      const node = el("div", { class: "log" });
      st.quotes.forEach(qq => {
        const rt = st.trades.filter(t => t.round === qq.round);
        node.appendChild(el("div", { class: "log-row" }, [el("span", { class: "r" }, qq.round + 1), el("span", { class: "bid-text" }, qq.bid), el("span", { class: "muted" }, "/"), el("span", { class: "ask-text" }, qq.ask), el("span", { class: "muted small" }, rt.length ? "" : "no trade")]));
        rt.forEach(t => node.appendChild(el("div", { class: "log-row " + t.side }, [
          el("span", { class: "r" }, t.side === "buy" ? "↑" : "↓"),
          el("span", {}, (t.side === "buy" ? "Bought from you at " : "Sold to you at ") + t.price),
          el("span", { class: "chip " + (revealed ? (t.who === "informed" ? "ask" : "bid") : "") }, revealed ? (t.who === "informed" ? "peeker" : "noise") : "trader"),
          revealed ? el("span", { class: "pnl " + (t.pnl >= 0 ? "pos" : "neg") }, (t.pnl >= 0 ? "+" : "") + t.pnl) : null
        ])));
      });
      return node;
    }

    function result() {
      L.reset();
      L.setProgress(1);
      const pos = st.pnl >= 0;
      if (!opts.practice && st.blownUp) { State.loseHeart(); L.refreshHearts(); }
      if (!opts.practice) State.addXP(st.xp);
      State.record("card-sum", Math.round(st.pnl));
      L.inner.append(
        el("div", { class: "result-hero" }, [el("div", { class: "big " + (pos ? "pos" : "neg") }, (pos ? "+" : "") + st.pnl.toFixed(0) + " pts"), el("p", { class: "muted" }, "points of P&L across your fills")]),
        el("div", { class: "hand" }, st.hand.map(c => cardNode(c, true, true))),
        el("div", { class: "card gold" }, [el("p", { class: "tiny" }, "THE SUM"), el("h2", {}, String(eng.S))])
      );
      const ladder = el("div", { class: "ladder" });
      L.inner.appendChild(ladder);
      Lesson.linearLadder(ladder, [5, 65], st.quotes, st.trades, last, eng.S);
      L.inner.append(
        el("div", { class: "result-row" }, [Lesson.box(st.containsFinal ? "Yes" : "No", "final market contained it", st.containsFinal ? "gold" : ""), Lesson.box(String(st.noise), "noise trades captured"), Lesson.box("+" + st.xp, "xp", "gold")]),
        log(true),
        el("div", { class: "lesson-note", html: note() })
      );
      if (pos && st.containsFinal) { confetti(); haptic("win"); } else if (st.blownUp) { shake(L.body); haptic("bad"); }
      L.setFoot(pos ? "ok" : "bad", st.blownUp ? "Blown up. Heart lost." : pos ? "Profitable table." : "The peeker got you.", st.pickedOff ? "Picked off " + st.pickedOff + " time" + (st.pickedOff > 1 ? "s" : "") + " by the player who had seen two cards." : "No one with private information beat you.", "Continue", () => L.close(false));
    }

    function note() {
      const parts = [];
      const q0 = st.quotes[0];
      parts.push("Blind, the fair value of five cards is <b>35</b> with a standard deviation of about <b>8.4</b>. Your opening width was " + (q0.ask - q0.bid) + " points" + ((q0.ask - q0.bid) < 8 ? ", under one standard deviation: brave against someone who has seen two cards." : "."));
      const inf = st.trades.filter(t => t.who === "informed");
      if (inf.length) parts.push("The peeker traded " + inf.length + " time" + (inf.length > 1 ? "s" : "") + ". Every one of those trades told you which way the hidden cards leaned. The fix is to shift your whole market toward the trade, not just widen.");
      else parts.push("The peeker never traded, which means your market always sat around their private number. Either you read the flips well or you were too wide to be worth hitting.");
      return parts.join(" ");
    }

    renderRound();
  }

  return { createEngine, play };
})();
