/* Player state in localStorage: XP, hearts, streak, lesson progress, best scores, daily results. */
window.State = (function () {
  const KEY = "quantest.v1";
  const MAX_HEARTS = 5;
  const HEART_REGEN_MS = 10 * 60 * 1000; // one heart every 10 minutes

  const defaults = () => ({
    xp: 0,
    hearts: MAX_HEARTS,
    heartsStamp: Date.now(),
    streak: 0,
    lastPlayDay: null,
    lessons: {},     // unitId -> number of lessons completed
    plays: 0,
    best: {},        // gameId -> best score
    history: [],     // last 50 results
    daily: {}        // dateKey -> { won, attempts, grid }
  });

  let s = load();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return defaults();
      const parsed = JSON.parse(raw);
      return Object.assign(defaults(), parsed);
    } catch (e) { return defaults(); }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* storage may be blocked */ }
  }

  function dayKey(d) {
    d = d || new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function regenHearts() {
    if (s.hearts >= MAX_HEARTS) { s.heartsStamp = Date.now(); return; }
    const elapsed = Date.now() - s.heartsStamp;
    const gained = Math.floor(elapsed / HEART_REGEN_MS);
    if (gained > 0) {
      s.hearts = Math.min(MAX_HEARTS, s.hearts + gained);
      s.heartsStamp = s.hearts >= MAX_HEARTS ? Date.now() : s.heartsStamp + gained * HEART_REGEN_MS;
      save();
    }
  }
  function heartsNextIn() {
    if (s.hearts >= MAX_HEARTS) return 0;
    return Math.max(0, HEART_REGEN_MS - (Date.now() - s.heartsStamp));
  }

  function loseHeart() {
    regenHearts();
    if (s.hearts > 0) {
      if (s.hearts === MAX_HEARTS) s.heartsStamp = Date.now();
      s.hearts -= 1;
      save();
    }
    return s.hearts;
  }

  function touchStreak() {
    const today = dayKey();
    if (s.lastPlayDay === today) return s.streak;
    const y = new Date(); y.setDate(y.getDate() - 1);
    if (s.lastPlayDay === dayKey(y)) s.streak += 1;
    else s.streak = 1;
    s.lastPlayDay = today;
    save();
    return s.streak;
  }

  function addXP(n) { s.xp += Math.max(0, Math.round(n)); s.plays += 1; touchStreak(); save(); return s.xp; }

  function record(gameId, score, extra) {
    if (s.best[gameId] === undefined || score > s.best[gameId]) s.best[gameId] = score;
    s.history.unshift(Object.assign({ game: gameId, score: score, at: Date.now() }, extra || {}));
    s.history = s.history.slice(0, 50);
    save();
  }

  function completeLesson(unitId) {
    s.lessons[unitId] = (s.lessons[unitId] || 0) + 1;
    save();
  }

  function reset() { s = defaults(); save(); }

  return {
    get: () => { regenHearts(); return s; },
    save, dayKey, MAX_HEARTS, HEART_REGEN_MS,
    regenHearts, heartsNextIn, loseHeart, addXP, record, completeLesson, touchStreak, reset
  };
})();
