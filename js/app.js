/* Quantest app shell: navigation, learning path, games grid, hosted rooms, profile. */
(function () {
  const { el, clear, fmt, fmtPct, parseNum, toast, mascot } = UI;
  const FACTS = window.QUANTEST_FACTS;
  const UNITS = window.QUANTEST_UNITS;
  const LESSON_SIZE = 3;

  const main = document.getElementById("main");
  const aside = document.getElementById("aside");
  let view = location.hash.replace("#", "") || "learn";

  // ---------- navigation ----------
  function go(v) { view = v; location.hash = v; render(); }
  window.addEventListener("hashchange", () => { const v = location.hash.replace("#", ""); if (v && v !== view) { view = v; render(); } });
  document.querySelectorAll("[data-nav]").forEach(b => b.addEventListener("click", () => go(b.dataset.nav)));

  function render() {
    document.querySelectorAll("[data-nav]").forEach(b => b.classList.toggle("active", b.dataset.nav === view));
    clear(main);
    main.appendChild(statbar());
    if (view === "learn") renderLearn();
    else if (view === "daily") { renderGames(); Daily.play({ onDone: () => render() }); view = "games"; location.hash = "games"; }
    else if (view === "games") renderGames();
    else if (view === "profile") renderProfile();
    else renderLearn();
    renderAside();
    window.scrollTo(0, 0);
  }

  function statbar() {
    const s = State.get();
    return el("div", { class: "statbar" }, [
      el("div", { class: "stat flame", title: "day streak" }, "🔥 " + s.streak),
      el("div", { class: "stat gold", title: "xp" }, "✦ " + s.xp),
      el("div", { class: "stat heart", title: "hearts" }, "♥ " + s.hearts)
    ]);
  }

  // ---------- hearts gate ----------
  function needHeart(then) {
    const s = State.get();
    if (s.hearts > 0) return then();
    const ms = State.heartsNextIn();
    const mins = Math.ceil(ms / 60000);
    const modal = el("div", { class: "lesson" });
    modal.append(
      el("div", { class: "lesson-top" }, el("button", { class: "close", onclick: () => modal.remove() }, "✕")),
      el("div", { class: "lesson-body" }, el("div", { class: "lesson-inner stack center" }, [
        el("div", { html: mascot("sad"), style: { margin: "20px auto 0" } }),
        el("h2", {}, "Out of hearts"),
        el("p", { class: "muted" }, "Every blow-up costs one. The next one comes back in " + mins + " minute" + (mins === 1 ? "" : "s") + "."),
        el("p", { class: "muted small" }, "Hosted rooms and the daily puzzle don't use hearts."),
        el("button", { class: "btn primary", onclick: () => { modal.remove(); go("games"); } }, "Go to games")
      ]))
    );
    document.body.appendChild(modal);
  }

  // ---------- learn: the path ----------
  function lessonFacts(unitId, lessonIdx, replay) {
    const pool = FACTS.filter(f => f.cat === unitId);
    if (replay) return shuffle(pool.slice()).slice(0, LESSON_SIZE);
    const out = [];
    for (let i = 0; i < LESSON_SIZE; i++) out.push(pool[(lessonIdx * LESSON_SIZE + i) % pool.length]);
    return out;
  }
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  function renderLearn() {
    const s = State.get();
    main.appendChild(el("div", { class: "card brand" }, [
      el("div", { class: "row", style: { gap: "14px" } }, [
        el("div", { class: "grow" }, [
          el("p", { class: "tiny", style: { color: "rgba(255,255,255,.8)" } }, "QUANTEST"),
          el("h1", { style: { color: "#fff", fontSize: "26px" } }, "Make markets on numbers."),
          el("p", { style: { color: "rgba(255,255,255,.9)", marginTop: "6px", fontSize: "15px" } }, "Estimate a real-world number, then make a market on it against a screen, an informed analyst, and a crowd. Knowing the number isn't the game; pricing what you don't know is.")
        ])
      ])
    ]));

    let unlocked = true;
    UNITS.forEach((u, ui) => {
      const done = s.lessons[u.id] || 0;
      const head = el("div", { class: "unit-head", style: { background: u.color, boxShadow: "0 4px 0 " + u.dark } }, [
        el("div", {}, [el("p", { class: "tiny", style: { color: "rgba(255,255,255,.85)" } }, "UNIT " + (ui + 1)), el("h2", {}, u.title), el("p", {}, u.blurb)]),
        el("div", { class: "chip", style: { background: "rgba(255,255,255,.2)", borderColor: "rgba(255,255,255,.3)", color: "#fff" } }, Math.min(done, u.lessons) + "/" + u.lessons)
      ]);
      main.appendChild(head);
      const path = el("div", { class: "path" });
      const offsets = ["", "off-l", "off-l", "", "off-r", "off-r"];
      for (let i = 0; i < u.lessons; i++) {
        const state = i < done ? "done" : (unlocked && i === done) ? "current" : "locked";
        const node = el("div", { class: "node " + state + " " + offsets[i % offsets.length] });
        const label = i === u.lessons - 1 ? "Unit test" : "Lesson " + (i + 1);
        const btn = el("button", { "aria-label": label, disabled: state === "locked", onclick: () => needHeart(() => startLesson(u, i, state === "done")) },
          state === "done" ? "✓" : state === "current" ? "★" : "🔒");
        node.append(btn, el("span", { class: "nl" }, label));
        path.appendChild(node);
      }
      main.appendChild(path);
      if (done < u.lessons) unlocked = false;
    });
    main.appendChild(el("p", { class: "tiny center", style: { marginTop: "10px" } }, "Hearts refill one every 10 minutes. Replaying a finished lesson gives new facts from the same unit."));
  }

  function startLesson(unit, idx, replay) {
    NumberMarket.play({
      facts: lessonFacts(unit.id, idx, replay),
      unitId: replay ? null : unit.id,
      onDone: () => render()
    });
  }

  // ---------- games ----------
  function renderGames() {
    const s = State.get();
    const info = Daily.todayInfo();
    const played = s.daily[info.key];
    main.appendChild(el("h1", {}, "Games"));
    main.appendChild(el("p", { class: "muted", style: { margin: "6px 0 16px" } }, "Every game is the same lesson from a different angle: price what you don't know, and let the flow tell you what you got wrong."));

    const grid = el("div", { class: "games" });
    grid.append(
      gameCard("🗓️", "Daily #" + info.n, played ? (played.won ? "Solved in " + played.attempts.length + ". Back tomorrow." : "Missed. Back tomorrow.") : "Six quotes. One number. Same for everyone.", () => Daily.play({ onDone: () => render() }), played ? "done" : "new"),
      gameCard("🎯", "Quick markets", "Three random facts. Estimate, then quote against the screen, in size.", () => needHeart(() => NumberMarket.play({ facts: shuffle(FACTS.filter(f => f.cat !== "warmup")).slice(0, 3), onDone: () => render() }))),
      gameCard("🗣️", "Flow drill", "\"Make me a market. I buy. Again.\" Read the counterparty, move the right amount.", () => needHeart(() => FlowDrill.play({ onDone: () => render() }))),
      gameCard("🃏", "Card sum", "Five cards, one flips per round, someone has seen two.", () => needHeart(() => CardSum.play({ onDone: () => render() }))),
      gameCard("🎲", "Dice ladder", "Pay to peek, or quote blind against someone who knows two dice.", () => needHeart(() => DiceLadder.play({ onDone: () => render() }))),
      gameCard("⚡", "Spread arena", "45 live seconds. Spread, skew, inventory, news jumps.", () => needHeart(() => Arena.play({ onDone: () => render() }))),
      gameCard("🏫", "Host a room", "Your own number, pass the phone, leaderboard. Countries in the classroom, anyone?", () => renderRoomForm(), "no hearts")
    );
    main.appendChild(grid);

    main.appendChild(el("h2", { style: { margin: "26px 0 10px" } }, "On the roadmap"));
    const soon = el("div", { class: "games" });
    [
      ["🔭", "Hunter mode", "Play the informed trader against a bot market maker."],
      ["🚇", "Live Tube markets", "Quote on real arrival times. Settles against TfL within minutes."],
      ["🏹", "Spot the pick-off", "Watch a tape, tap the moment the flow turned toxic."],
      ["🥊", "Winner's curse duel", "Two players quote at once. Tightest wins the flow. The flow is sometimes informed."],
      ["🌀", "Ball on a spring", "Fair value on a spring, news is a kick. Quote the tube around it."],
      ["📼", "Tape guessing", "Thirty seconds of real ticks. Quote what happens next."],
      ["🏝️", "Battle royale", "Fifty players, one book, shrinking capital limit."],
      ["🤖", "Idle algo", "Set spread, skew, and refresh. Your bot quotes while you sleep."]
    ].forEach(([i, t, d]) => soon.appendChild(gameCard(i, t, d, null, "soon")));
    main.appendChild(soon);
  }

  function gameCard(icon, title, desc, onClick, tag) {
    const c = el("button", { class: "game-card" + (onClick ? "" : " soon"), onclick: onClick || null }, [
      tag ? el("span", { class: "chip tag " + (tag === "new" ? "gold" : tag === "done" ? "bid" : "") }, tag) : null,
      el("div", { class: "big" }, icon), el("h3", {}, title), el("p", {}, desc)
    ]);
    if (!onClick) c.disabled = true;
    return c;
  }

  // ---------- hosted room (classroom mode) ----------
  function renderRoomForm() {
    clear(main);
    main.appendChild(statbar());
    main.appendChild(el("h1", {}, "Host a room"));
    main.appendChild(el("p", { class: "muted", style: { margin: "6px 0 16px" } }, "Pick any number only you know: countries represented in the room, coins in your pocket, steps to the station. Players quote in turn and the bot trades against them knowing your answer."));
    const q = el("input", { class: "input", placeholder: "How many different countries are the people in this room from?" });
    const a = el("input", { class: "input num", inputmode: "decimal", type: "password", placeholder: "secret answer, e.g. 14" });
    const showA = el("button", { class: "btn xs auto", onclick: () => { a.type = a.type === "password" ? "text" : "password"; } }, "show");
    const unit = el("input", { class: "input", placeholder: "unit (optional), e.g. countries" });
    const players = el("input", { class: "input", placeholder: "players, comma separated, e.g. Arnav, Priya, Tom" });
    const rounds = el("select", { class: "input" }, [3, 4, 5, 6].map(n => el("option", { value: n, selected: n === 4 }, n + " rounds")));
    const form = el("div", { class: "card stack" }, [
      el("div", {}, [el("label", { class: "lab" }, "Question"), q]),
      el("div", {}, [el("label", { class: "lab" }, "Answer (only you see this)"), el("div", { class: "row" }, [a, showA])]),
      el("div", { class: "quote-grid" }, [el("div", {}, [el("label", { class: "lab" }, "Unit"), unit]), el("div", {}, [el("label", { class: "lab" }, "Rounds"), rounds])]),
      el("div", {}, [el("label", { class: "lab" }, "Players"), players]),
      el("button", { class: "btn primary", onclick: () => {
        const ans = parseNum(a.value);
        if (!q.value.trim() || !(ans > 0)) { toast("Need a question and a positive answer"); return; }
        const names = players.value.split(",").map(x => x.trim()).filter(Boolean);
        if (!names.length) names.push("Player 1");
        const fact = { id: "custom", q: q.value.trim(), a: ans, unit: unit.value.trim(), cat: "room", tol: "exact", note: "Set by the host." };
        runRoom(fact, names, parseInt(rounds.value, 10));
      } }, "Start room"),
      el("button", { class: "btn ghost", onclick: () => go("games") }, "Back")
    ]);
    main.appendChild(form);
    q.focus();
  }

  function runRoom(fact, names, rounds) {
    const board = [];
    const seed = (Math.random() * 2 ** 32) >>> 0;
    let i = 0;
    function next() {
      if (i >= names.length) return leaderboard();
      const name = names[i];
      const hand = el("div", { class: "lesson" });
      hand.append(
        el("div", { class: "lesson-top" }, el("button", { class: "close", onclick: () => { hand.remove(); render(); } }, "✕")),
        el("div", { class: "lesson-body" }, el("div", { class: "lesson-inner stack center" }, [
          el("div", { html: mascot("happy"), style: { margin: "30px auto 0" } }),
          el("p", { class: "muted" }, "Pass the phone to"),
          el("h1", {}, name),
          el("p", { class: "muted small" }, "Everyone gets the same trader behaviour, so the leaderboard is skill, not luck."),
          el("button", { class: "btn primary", onclick: () => {
            hand.remove();
            NumberMarket.play({ facts: [fact], practice: true, rounds, seed, onDone: (r) => {
              if (!r.aborted && r.results.length) board.push({ name, pnl: r.results[0].pnl, contains: r.results[0].contains });
              i += 1; next();
            } });
          } }, "I'm " + name)
        ]))
      );
      document.body.appendChild(hand);
    }
    function leaderboard() {
      board.sort((x, y) => y.pnl - x.pnl);
      clear(main);
      main.appendChild(statbar());
      main.append(
        el("h1", {}, "Room results"),
        el("div", { class: "card gold", style: { marginTop: "12px" } }, [el("p", { class: "tiny" }, "THE NUMBER"), el("h2", {}, fmt(fact.a, { compact: false }) + (fact.unit ? " " + fact.unit : "")), el("p", { class: "small muted" }, fact.q)]),
        el("div", { class: "card" }, el("table", { class: "table" }, [
          el("thead", {}, el("tr", {}, [el("th", {}, "#"), el("th", {}, "Player"), el("th", {}, "P&L"), el("th", {}, "Final market held it")])),
          el("tbody", {}, board.map((b, k) => el("tr", {}, [el("td", {}, k === 0 ? "🏆" : String(k + 1)), el("td", {}, b.name), el("td", { class: "pnl " + (b.pnl >= 0 ? "pos" : "neg") }, fmtPct(b.pnl)), el("td", {}, b.contains ? "Yes" : "No")])))
        ])),
        el("button", { class: "btn primary", style: { marginTop: "14px" }, onclick: () => renderRoomForm() }, "Host another"),
        el("button", { class: "btn ghost", style: { marginTop: "10px" }, onclick: () => go("games") }, "Back to games")
      );
      if (board.length) UI.confetti();
    }
    next();
  }

  // ---------- profile ----------
  function renderProfile() {
    const s = State.get();
    main.appendChild(el("h1", {}, "You"));
    main.appendChild(el("div", { class: "result-row", style: { marginTop: "14px" } }, [
      Lesson.box(String(s.xp), "total xp", "gold"), Lesson.box(String(s.streak), "day streak"), Lesson.box(String(s.plays), "games played")
    ]));
    const best = [["number-markets", "Number markets (P&L %)"], ["flow-drill", "Flow drill (score)"], ["card-sum", "Card sum (pts)"], ["dice-ladder", "Dice ladder (pts)"], ["arena", "Spread arena (P&L)"], ["daily", "Daily (best score)"]];
    main.appendChild(el("div", { class: "card" }, [
      el("h3", {}, "Personal bests"),
      el("table", { class: "table", style: { marginTop: "8px" } }, el("tbody", {}, best.map(([k, label]) => el("tr", {}, [el("td", {}, label), el("td", { class: "num" }, s.best[k] === undefined ? "–" : String(s.best[k]))]))))
    ]));
    if (s.history.length) {
      main.appendChild(el("div", { class: "card" }, [
        el("h3", {}, "Recent"),
        el("table", { class: "table", style: { marginTop: "8px" } }, el("tbody", {}, s.history.slice(0, 10).map(h => el("tr", {}, [el("td", {}, h.game), el("td", { class: "num" }, String(h.score)), el("td", { class: "muted small" }, new Date(h.at).toLocaleDateString("en-GB"))]))))
      ]));
    }
    main.appendChild(el("div", { class: "card grape" }, [
      el("h3", {}, "Leagues"),
      el("p", { class: "small", style: { marginTop: "6px" } }, "Weekly ladders and friend leaderboards need accounts and a server. This build keeps everything on your device. The hosted-room leaderboard works offline today.")
    ]));
    main.appendChild(el("button", { class: "btn ghost", style: { marginTop: "14px" }, onclick: () => { if (confirm("Reset all progress on this device?")) { State.reset(); render(); } } }, "Reset progress"));
  }

  // ---------- right column ----------
  function renderAside() {
    clear(aside);
    const s = State.get();
    const info = Daily.todayInfo();
    const played = s.daily[info.key];
    aside.append(
      el("div", { class: "row", style: { gap: "12px", alignItems: "flex-start" } }, [
        el("div", { html: mascot("happy") }),
        el("div", { class: "speech grow" }, s.plays === 0 ? "I'm Tick. I have a hand on every side of the book. Open wide, tighten as the trades come in." : s.streak > 1 ? s.streak + " days running. Width is uncertainty; spend it wisely." : "Every trade is information. Shift toward the flow.")
      ]),
      el("div", { class: "card gold" }, [
        el("div", { class: "row between" }, [el("h3", {}, "Daily #" + info.n), el("span", { class: "chip " + (played ? "bid" : "gold") }, played ? (played.won ? "solved" : "missed") : "open")]),
        el("p", { class: "small", style: { margin: "6px 0 10px" } }, played ? "New number at midnight." : "Six quotes, one number, same for everyone."),
        el("button", { class: "btn gold sm", onclick: () => Daily.play({ onDone: () => render() }) }, played ? "See result" : "Play")
      ]),
      el("div", { class: "card" }, [
        el("h3", {}, "How scoring works"),
        el("p", { class: "small muted", style: { marginTop: "6px" } }, "Three scores per market: your estimate, your market quality against the screen (50 means you matched it), and flow P&L as a share of the true number. XP comes from the market quality, not from knowing the answer. Blow-ups below −30% cost a heart.")
      ])
    );
  }

  render();
})();
