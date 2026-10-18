/* Full-screen lesson scaffold: progress bar on top, scrolling body, verdict footer. */
window.Lesson = (function () {
  const { el, clear } = UI;

  function open(opts) {
    opts = opts || {};
    const overlay = el("div", { class: "lesson" });
    const top = el("div", { class: "lesson-top" });
    const body = el("div", { class: "lesson-body" });
    const inner = el("div", { class: "lesson-inner stack" });
    body.appendChild(inner);
    const foot = el("div", { class: "lesson-foot" });
    overlay.append(top, body, foot);
    document.body.appendChild(overlay);

    const progress = el("div", { class: "progress " + (opts.progressClass || "") }, el("div"));
    const right = opts.practice ? el("span", { class: "chip" }, "practice") : el("div", { class: "stat heart" }, "♥ " + State.get().hearts);
    top.append(
      el("button", { class: "close", "aria-label": "Quit", onclick: () => { if (!opts.confirmQuit || confirm("Quit? Progress on this game is lost.")) close(true); } }, "✕"),
      progress, right
    );

    let closed = false;
    function close(aborted) {
      if (closed) return; closed = true;
      overlay.remove();
      if (opts.onClose) opts.onClose(aborted);
    }
    function setProgress(frac) { progress.firstChild.style.width = Math.round(Math.max(0, Math.min(1, frac)) * 100) + "%"; }
    function setFoot(tone, title, sub, btnLabel, onClick, btnClass) {
      clear(foot);
      foot.className = "lesson-foot " + (tone || "");
      const btn = el("button", { class: "btn " + (btnClass || "primary") + " lg", onclick: onClick }, btnLabel);
      foot.appendChild(el("div", { class: "lesson-foot-inner" }, [
        el("div", { class: "verdict" }, [title ? el("h3", {}, title) : null, sub ? el("p", { class: "small" }, sub) : null]),
        btn
      ]));
      setTimeout(() => btn.focus(), 0);
      return btn;
    }
    function setFootNode(node) { clear(foot); foot.className = "lesson-foot"; foot.appendChild(el("div", { class: "lesson-foot-inner" }, node)); }
    function refreshHearts() { if (!opts.practice) right.textContent = "♥ " + State.get().hearts; }
    function reset() { clear(inner); }

    return { overlay, body, inner, foot, close, setProgress, setFoot, setFootNode, refreshHearts, reset };
  }

  function box(v, k, cls) {
    return el("div", { class: "box " + (cls || "") }, [el("div", { class: "v" }, v), el("div", { class: "k" }, k)]);
  }

  // Linear number line for small-range markets (card sums, dice sums).
  function linearLadder(ladder, range, quotes, trades, live, truth) {
    clear(ladder);
    const [lo, hi] = range;
    const x = v => ((v - lo) / (hi - lo) * 100);
    ladder.appendChild(el("div", { class: "axis" }));
    const step = Math.ceil((hi - lo) / 6);
    for (let v = lo; v <= hi; v += step) { if (truth !== null && truth !== undefined && Math.abs(x(v) - x(truth)) < 7) continue; ladder.appendChild(el("div", { class: "tick", style: { left: x(v) + "%" } }, v)); }
    quotes.forEach(q => {
      if (live && q.bid === live.bid && q.ask === live.ask) return;
      ladder.appendChild(el("div", { class: "band ghost", style: { left: x(q.bid) + "%", width: Math.max(0.5, x(q.ask) - x(q.bid)) + "%" } }));
    });
    if (live) {
      ladder.appendChild(el("div", { class: "band", style: { left: x(live.bid) + "%", width: Math.max(0.5, x(live.ask) - x(live.bid)) + "%" } }));
      ladder.appendChild(el("div", { class: "handle bid", style: { left: x(live.bid) + "%" } }));
      ladder.appendChild(el("div", { class: "handle ask", style: { left: x(live.ask) + "%" } }));
    }
    trades.forEach((t, i) => ladder.appendChild(el("div", { class: "trade " + t.side, style: { left: x(t.price) + "%", top: (i % 2 ? 22 : 2) + "px" } }, (t.side === "buy" ? "▲" : "▼") + (t.round + 1))));
    if (truth !== null && truth !== undefined) {
      ladder.appendChild(el("div", { class: "truth", style: { left: x(truth) + "%" } }, "★"));
      ladder.appendChild(el("div", { class: "truth-label", style: { left: x(truth) + "%" } }, truth));
    }
  }

  // Shared bid/ask input block for point-valued markets. Returns { node, get, setDisabled, onChange }.
  function quoteInputs(initial, step) {
    const { parseNum, fmt } = UI;
    step = step || 1;
    const bidIn = el("input", { class: "input bid num", inputmode: "decimal", placeholder: "bid" });
    const askIn = el("input", { class: "input ask num", inputmode: "decimal", placeholder: "ask" });
    if (initial) { bidIn.value = initial.bid; askIn.value = initial.ask; }
    let handler = null;
    function nudge(input, d) { const v = parseNum(input.value); if (isNaN(v)) return; input.value = Math.round((v + d) * 10) / 10; fire(); }
    function fire() { if (handler) handler(get()); }
    const node = el("div", {}, [
      el("div", { class: "quote-grid" }, [
        el("div", { class: "quote-box bid" }, [el("label", { class: "lab" }, "Your bid"), bidIn,
          el("div", { class: "nudge" }, [el("button", { class: "btn xs soft-bid", onclick: () => nudge(bidIn, -step) }, "−" + step), el("button", { class: "btn xs soft-bid", onclick: () => nudge(bidIn, step) }, "+" + step)])]),
        el("div", { class: "quote-box ask" }, [el("label", { class: "lab" }, "Your ask"), askIn,
          el("div", { class: "nudge" }, [el("button", { class: "btn xs soft-ask", onclick: () => nudge(askIn, -step) }, "−" + step), el("button", { class: "btn xs soft-ask", onclick: () => nudge(askIn, step) }, "+" + step)])])
      ]),
      el("div", { class: "widen" }, [
        el("button", { class: "btn xs", onclick: () => { nudge(bidIn, -step); nudge(askIn, step); } }, "Widen"),
        el("button", { class: "btn xs", onclick: () => { nudge(bidIn, step); nudge(askIn, -step); } }, "Tighten"),
        el("button", { class: "btn xs", onclick: () => { nudge(bidIn, step); nudge(askIn, step); } }, "Shift up"),
        el("button", { class: "btn xs", onclick: () => { nudge(bidIn, -step); nudge(askIn, -step); } }, "Shift down")
      ])
    ]);
    bidIn.addEventListener("input", fire); askIn.addEventListener("input", fire);
    bidIn.addEventListener("keydown", e => { if (e.key === "Enter") askIn.focus(); });
    function get() {
      const b = parseNum(bidIn.value), a = parseNum(askIn.value);
      const ok = !isNaN(b) && !isNaN(a) && a > b;
      bidIn.classList.toggle("invalid", bidIn.value !== "" && isNaN(b));
      askIn.classList.toggle("invalid", askIn.value !== "" && (isNaN(a) || a <= b));
      return { bid: b, ask: a, ok };
    }
    return {
      node, get, bidIn, askIn,
      onChange: f => { handler = f; },
      setDisabled: d => node.querySelectorAll("input,button").forEach(n => n.disabled = d),
      onEnter: f => askIn.addEventListener("keydown", e => { if (e.key === "Enter") f(); })
    };
  }

  return { open, box, linearLadder, quoteInputs };
})();
