/* Dice Ladder.
   Five hidden dice. Quote the sum over four rounds. Before each quote you can pay to peek at one die.
   A counterparty privately knows two of the dice. Teaches the price of information. */

window.DiceLadder = (function () {
  const { el, fmt, haptic, confetti, shake, rng, gauss } = UI;
  const PEEK_FEE = 1.5;
  const FACES = ["⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];

  function createEngine(opts) {
    opts = opts || {};
    const rand = rng(opts.seed !== undefined ? opts.seed : (Math.random() * 2 ** 32) >>> 0);
    const dice = [];
    for (let i = 0; i < 5; i++) dice.push(1 + Math.floor(rand() * 6));
    const S = dice.reduce((a, b) => a + b, 0);
    const st = { dice, peeked: [], round: 0, rounds: 4, quotes: [], trades: [], fees: 0, done: false, S };
    const known = [3, 4]; // indices the counterparty privately knows

    function peek() {
      const hidden = [0, 1, 2, 3, 4].filter(i => st.peeked.indexOf(i) < 0);
      if (!hidden.length) return null;
      const i = hidden[Math.floor(rand() * hidden.length)];
      st.peeked.push(i);
      st.fees += PEEK_FEE;
      return i;
    }

    function submit(bid, ask) {
      if (st.done) throw new Error("settled");
      if (!(ask > bid)) throw new Error("bad quote");
      const r = st.round;
      st.quotes.push({ round: r, bid, ask });
      const events = [];
      let belief = 0;
      dice.forEach((d, i) => { belief += known.indexOf(i) >= 0 ? d : 3.5; });
      belief += gauss(rand) * 1.0;
      let tr = null;
      if (belief > ask + 0.3) tr = { round: r, side: "buy", price: ask, who: "informed" };
      else if (belief < bid - 0.3) tr = { round: r, side: "sell", price: bid, who: "informed" };
      if (tr) { st.trades.push(tr); events.push(tr); } else events.push({ round: r, side: "pass", who: "informed" });
      const pNoise = 0.85 * Math.exp(-0.2 * (ask - bid));
      if (rand() < pNoise) {
        const side = rand() < 0.5 ? "buy" : "sell";
        const nt = { round: r, side, price: side === "buy" ? ask : bid, who: "noise" };
        st.trades.push(nt); events.push(nt);
      }
      st.round += 1;
      if (st.round >= st.rounds) settle(bid, ask);
      return { events, done: st.done };
    }

    function settle(bid, ask) {
      st.done = true;
      st.containsFinal = bid <= S && S <= ask;
      let pnl = 0, noise = 0, picked = 0;
      st.trades.forEach(t => {
        t.pnl = t.side === "buy" ? t.price - S : S - t.price;
        pnl += t.pnl;
        if (t.who === "noise") noise += 1;
        if (t.who === "informed" && t.pnl < 0) picked += 1;
      });
      st.grossPnl = pnl;
      st.pnl = pnl - st.fees;
      st.noise = noise; st.pickedOff = picked;
      st.xp = 5 + (st.pnl > 0 ? 10 : 0) + Math.min(15, noise * 5) + (st.containsFinal ? 10 : 0) + (st.pnl > 4 ? 10 : 0);
      st.blownUp = st.pnl < -8;
    }

    return { state: st, submit, peek, S, PEEK_FEE };
  }

  function dieNode(v, peeked, fresh) {
    if (!peeked) return el("div", { class: "die hidden" }, "?");
    return el("div", { class: "die peeked" + (fresh ? "" : "") }, FACES[v - 1]);
  }

  function play(opts) {
    opts = opts || {};
    const eng = createEngine({ seed: opts.seed });
    const st = eng.state;
    const L = Lesson.open({ practice: opts.practice, confirmQuit: true, onClose: opts.onDone });
    let last = null;

    function expectation() {
      let e = 0; st.dice.forEach((d, i) => { e += st.peeked.indexOf(i) >= 0 ? d : 3.5; });
      const unknown = 5 - st.peeked.length;
      return { mean: e, sd: Math.sqrt(unknown * 35 / 12) };
    }

    function renderRound() {
      L.reset();
      L.setProgress(st.round / st.rounds);
      const r = st.round;
      const ex = expectation();
      const diceRow = el("div", { class: "hand" }, st.dice.map((d, i) => dieNode(d, st.peeked.indexOf(i) >= 0)));
      L.inner.append(
        el("div", { class: "row wrap" }, [el("span", { class: "chip brand" }, "Round " + (r + 1) + " of " + st.rounds), el("span", { class: "chip gold" }, "fees paid " + st.fees.toFixed(1))]),
        el("h2", { class: "question" }, "What is the sum of these five dice?"),
        el("p", { class: "muted small" }, "Nothing flips on its own. Pay " + PEEK_FEE + " points to peek at one die, or quote blind. Your counterparty already knows two of them."),
        diceRow
      );
      const peekBtn = el("button", { class: "btn gold sm auto", onclick: () => {
        const i = eng.peek();
        if (i === null) return;
        haptic("tap");
        diceRow.replaceChild(dieNode(st.dice[i], true, true), diceRow.children[i]);
        peekBtn.textContent = "Peek another (−" + PEEK_FEE + ")";
        if (st.peeked.length >= 5) peekBtn.disabled = true;
        hint.textContent = hintText();
      } }, "Peek a die (−" + PEEK_FEE + ")");
      const hint = el("p", { class: "muted small" }, hintText());
      function hintText() { const e = expectation(); return "Given what you can see, the sum averages " + e.mean.toFixed(1) + " with a standard deviation of " + e.sd.toFixed(1) + "."; }
      L.inner.append(el("div", { class: "row between wrap" }, [hint, peekBtn]));
      const ladder = el("div", { class: "ladder" });
      L.inner.appendChild(ladder);
      const q = Lesson.quoteInputs(last ? { bid: last.bid, ask: last.ask } : null, 1);
      L.inner.appendChild(q.node);
      if (st.trades.length) L.inner.appendChild(log(false));

      function update(v) {
        v = v || q.get();
        submitBtn.disabled = !v.ok;
        Lesson.linearLadder(ladder, [5, 30], st.quotes, st.trades, v.ok ? v : null, null);
      }
      q.onChange(update);
      const submitBtn = L.setFoot("", "", "", "Quote", () => {
        const v = q.get(); if (!v.ok) return;
        last = v;
        const res = eng.submit(v.bid, v.ask);
        q.setDisabled(true); peekBtn.disabled = true;
        Lesson.linearLadder(ladder, [5, 30], st.quotes, st.trades, v, null);
        const old = L.inner.querySelector(".log"); if (old) old.remove();
        L.inner.appendChild(log(false));
        const trades = res.events.filter(e => e.side !== "pass");
        if (trades.length) {
          haptic("hit");
          const t = trades[0];
          L.setFoot("neutral", (t.side === "buy" ? "Lifted at " : "Hit at ") + t.price + (trades.length > 1 ? " (and more)" : ""), "Information flowing the other way. Was it worth a peek?", res.done ? "Settle" : "Next round", () => res.done ? result() : renderRound());
        } else {
          L.setFoot("ok", "No trade.", "Your market held.", res.done ? "Settle" : "Next round", () => res.done ? result() : renderRound());
        }
        L.setProgress(st.round / st.rounds);
      });
      q.onEnter(() => { if (!submitBtn.disabled) submitBtn.click(); });
      update();
      if (!last) q.bidIn.focus();
    }

    function log(revealed) {
      const node = el("div", { class: "log" });
      st.quotes.forEach(qq => {
        const rt = st.trades.filter(t => t.round === qq.round);
        node.appendChild(el("div", { class: "log-row" }, [el("span", { class: "r" }, qq.round + 1), el("span", { class: "bid-text" }, qq.bid), el("span", { class: "muted" }, "/"), el("span", { class: "ask-text" }, qq.ask), el("span", { class: "muted small" }, rt.length ? "" : "no trade")]));
        rt.forEach(t => node.appendChild(el("div", { class: "log-row " + t.side }, [
          el("span", { class: "r" }, t.side === "buy" ? "↑" : "↓"),
          el("span", {}, (t.side === "buy" ? "Bought from you at " : "Sold to you at ") + t.price),
          el("span", { class: "chip " + (revealed ? (t.who === "informed" ? "ask" : "bid") : "") }, revealed ? (t.who === "informed" ? "knew 2 dice" : "noise") : "trader"),
          revealed ? el("span", { class: "pnl " + (t.pnl >= 0 ? "pos" : "neg") }, (t.pnl >= 0 ? "+" : "") + t.pnl) : null
        ])));
      });
      return node;
    }

    function result() {
      L.reset(); L.setProgress(1);
      const pos = st.pnl >= 0;
      if (!opts.practice && st.blownUp) { State.loseHeart(); L.refreshHearts(); }
      if (!opts.practice) State.addXP(st.xp);
      State.record("dice-ladder", Math.round(st.pnl * 10) / 10);
      L.inner.append(
        el("div", { class: "result-hero" }, [el("div", { class: "big " + (pos ? "pos" : "neg") }, (pos ? "+" : "") + st.pnl.toFixed(1) + " pts"), el("p", { class: "muted" }, "gross " + (st.grossPnl >= 0 ? "+" : "") + st.grossPnl.toFixed(1) + " minus " + st.fees.toFixed(1) + " in peek fees")]),
        el("div", { class: "hand" }, st.dice.map(d => dieNode(d, true))),
        el("div", { class: "card gold" }, [el("p", { class: "tiny" }, "THE SUM"), el("h2", {}, String(eng.S))])
      );
      const ladder = el("div", { class: "ladder" });
      L.inner.appendChild(ladder);
      Lesson.linearLadder(ladder, [5, 30], st.quotes, st.trades, last, eng.S);
      L.inner.append(
        el("div", { class: "result-row" }, [Lesson.box(String(st.peeked.length), "dice peeked"), Lesson.box(String(st.noise), "noise trades"), Lesson.box("+" + st.xp, "xp", "gold")]),
        log(true),
        el("div", { class: "lesson-note", html: note() })
      );
      if (pos && st.containsFinal) { confetti(); haptic("win"); } else if (st.blownUp) { shake(L.body); haptic("bad"); }
      L.setFoot(pos ? "ok" : "bad", st.blownUp ? "Blown up. Heart lost." : pos ? "Information paid for itself." : "You paid for information and still lost.", st.pickedOff ? "Picked off " + st.pickedOff + " time" + (st.pickedOff > 1 ? "s" : "") + "." : "Never picked off.", "Continue", () => L.close(false));
    }

    function note() {
      const parts = [];
      const inf = st.trades.filter(t => t.who === "informed" && t.pnl < 0);
      const lost = inf.reduce((a, t) => a + t.pnl, 0);
      parts.push("Each unpeeked die adds about <b>1.7 points</b> of standard deviation. A peek costs " + PEEK_FEE + ". Peeking is worth it when it saves more than that in adverse selection.");
      if (st.peeked.length === 0) parts.push("You never peeked. Against someone who knows two dice, you were quoting with roughly twice their uncertainty" + (lost < 0 ? ", and it cost you " + lost.toFixed(1) + " points." : "."));
      else if (st.peeked.length >= 4) parts.push("You bought nearly all the information. Fine for safety, but " + st.fees.toFixed(1) + " in fees is a lot of spread to earn back.");
      else parts.push("Two or three peeks usually balances it: enough to out-know the counterparty, cheap enough to keep.");
      return parts.join(" ");
    }

    renderRound();
  }

  return { createEngine, play, PEEK_FEE };
})();
