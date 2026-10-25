/* Chart Journal — local trading-practice journal backed by Supabase. */
(function () {
  "use strict";

  const CFG = window.TJ_CONFIG || {};
  const SEED = window.TJ_SEED;
  const S = window.TJ_STATS;   // pure practice-trade stats and rules (stats.js)
  const app = document.getElementById("app");

  // ---------- helpers ----------
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = (v) =>
    String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pad = (n) => String(n).padStart(2, "0");
  const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseDay = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parseDay(s); d.setDate(d.getDate() + n); return localDate(d); };
  const daysBetween = (a, b) => Math.round((parseDay(b) - parseDay(a)) / 86400000);
  const fmtDate = (s, opts) => parseDay(s).toLocaleDateString(undefined, opts || { weekday: "short", month: "short", day: "numeric" });
  const fmtTime = (sec) => `${pad(Math.floor(sec / 60))}:${pad(sec % 60)}`;
  const fmtNum = (n) => (n == null ? "—" : Number(n).toLocaleString(undefined, { maximumFractionDigits: 6 }));
  const fmtMoney = (n) => (n == null || isNaN(n) ? "—" : (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const fmtPct = (n) => (n == null || isNaN(n) ? "—" : (n > 0 ? "+" : "") + n.toFixed(2) + "%");
  const sign = (n) => (n > 0 ? "pos" : n < 0 ? "neg" : "");
  const lsGet = (k) => { try { return localStorage.getItem("tj:" + k); } catch { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem("tj:" + k, v); } catch { /* ignore */ } };
  const CAT_LABEL = Object.fromEntries(SEED.CATEGORIES);
  const GOAL_SECONDS = 300;
  const GRADE_AFTER_DAYS = 7;
  const BUCKET = "trading-screenshots";
  const SOURCES = [["tradingview", "TradingView"], ["yahoo", "Yahoo Finance"], ["moneycontrol", "Moneycontrol"], ["coinglass", "Coinglass"], ["other", "Other"]];
  // Timeframe chips (becomes editable in Settings). Order here = order of the tiles in the "All timeframes" grid.
  const TIMEFRAMES = ["15m", "30m", "1h", "4h", "8h", "12h", "1D", "1W", "1M", "1Y"];   // the default list; Settings → "Edit timeframe chips" overrides it (trading_settings.timeframe_chips)
  const tfChips = () => (state.settings.timeframe_chips && state.settings.timeframe_chips.length ? state.settings.timeframe_chips : TIMEFRAMES);
  // What the free TradingView widget can show, tested 24 Oct 2026: 15, 30, 60, 240, D, W, M work. 480 (8h) and 720 (12h) are
  // silently replaced by 1D, so we show 4h instead. A "range" overrides the interval, so 1Y = daily candles over 12 months.
  // Anything else in a custom chip list (e.g. "2h", "5m", "3D") is mapped by tvSpec() below.
  const TV_TF = {
    "15m": { iv: "15" }, "30m": { iv: "30" }, "1h": { iv: "60" }, "4h": { iv: "240" },
    "1D": { iv: "D" }, "1W": { iv: "W" }, "1M": { iv: "M" },
    "1Y": { iv: "D", range: "12M", label: "1Y · daily candles over 12 months" },
    "8h": { sub: "4h" }, "12h": { sub: "4h" },
  };
  const SOURCE_LABEL = Object.fromEntries(SOURCES);

  // ---------- theme (index.html sets data-theme from localStorage before first paint; this keeps it in sync) ----------
  const themePref = () => { const v = lsGet("theme"); return v === "light" || v === "dark" ? v : "system"; };
  const resolveTheme = (pref) => (pref === "dark" || (pref !== "light" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light");
  function applyTheme(pref) {
    lsSet("theme", pref);
    const r = resolveTheme(pref);
    if (document.documentElement.getAttribute("data-theme") !== r) { document.documentElement.setAttribute("data-theme", r); return true; }
    return false;
  }
  const EMOTIONS = ["Calm", "Confident", "Unsure", "FOMO", "Scared", "Greedy", "Impatient", "Revenge"];

  async function must(q) { const { data, error } = await q; if (error) throw error; return data; }
  function friendly(e) {
    const m = (e && e.message) || String(e);
    const code = e && e.code;
    // Postgres / PostgREST codes: 42P01 (undefined table), PGRST205 (table not in schema cache), 42703 (undefined column)
    if (code === "42P01" || code === "PGRST205") return "Tables are missing or out of date. Run supabase/trading_schema.sql in the Supabase SQL Editor (shared PersonalOS project), then reload.";
    if (code === "PGRST204") { const c = /Could not find the '([^']+)' column of '([^']+)'/i.exec(m); return `Column ${c ? c[2] + "." + c[1] : "(unknown)"} is missing. Run supabase/trading_schema.sql in the Supabase SQL Editor, then reload.`; }
    if (code === "42703") { const c = /column ([\w.]+)/i.exec(m); return `Column ${c ? c[1] : "(unknown)"} is missing.`; }
    if (/Bucket not found/i.test(m)) return "The trading-screenshots storage bucket isn't set up. Run supabase/trading_schema.sql again in the Supabase SQL Editor.";
    if (code === "23505") return "That already exists (symbols, concept titles and words must be unique).";
    if (/Failed to fetch|NetworkError/i.test(m)) return "Can't reach Supabase. Check your internet connection.";
    if (/exceeded the maximum allowed size|Payload too large/i.test(m)) return "That image is too big (max 5 MB).";
    return m;
  }
  function toast(msg, kind = "ok") {
    let t = $("#toast");
    if (!t) { t = document.createElement("div"); t.id = "toast"; document.body.appendChild(t); }
    t.textContent = msg; t.className = "toast show " + kind;
    clearTimeout(toast._h); toast._h = setTimeout(() => (t.className = "toast " + kind), 3200);
  }
  function fail(e) { console.error(e); toast(friendly(e), "err"); }

  // ---------- state ----------
  // Tab names changed in round 2; map old saved values so nobody lands on a blank page
  const OLD_TABS = { concepts: ["learn"], journal: ["progress", "journal"], history: ["progress", "history"] };
  const state = {
    user: null,
    assets: [], obs: [], concepts: [], journal: [], trades: [], glossary: [],
    settings: { paper_balance: 10000 },
    tab: lsGet("tab") || "today",
    tfGrid: false, tfList: ["1D"], tfTiles: [],   // "All timeframes" grid on Today
    sub: lsGet("sub") || "overview",   // Progress page section: overview | journal | history
    selected: null,
    pendingShots: [],          // [{blob, url}] waiting to be uploaded with the current observation
    historyFilter: "all",      // History only: "all" or "grade" (only guesses ready to grade)
    assetFilter: "all",        // shared by the Progress calendar and all three sub-tabs: "all" or an asset id
    dayFilter: null,           // shared: a YYYY-MM-DD picked on the calendar, or null
    editingJournal: null,
    editingAsset: null,
    journalQuery: "",
    exp: { from: "", to: "" },   // Settings → export date range ("" = open ended)
    fx: {},                      // currency -> last fetched USD rate (practice trade form)
    sel: new Set(),              // Watchlist tick boxes (asset ids) for "Export selected"
    resetCounts: null, resetCountsBusy: false,   // "what will be deleted" numbers, fetched when Settings opens
    reset: null,                 // {removed: {step: n}, done: [steps], failed: {step, msg}} while a reset is resumable
    live: { at: 0, res: new Map(), fx: {} },   // phase 5b: latest live price per open trade id, and currency rates (never saved)
    typed: new Map(),            // trade id -> {price, at} typed in "Price now" for assets with no price source (memory only, never saved)
    alertItems: [], fired: new Set(),   // stop/target/liquidation alerts currently shown, and the levels already announced
    stats: { asset: "all", tag: "all", from: "", to: "" },
    eqPts: [],
  };
  { const m = OLD_TABS[state.tab]; if (m) { state.tab = m[0]; if (m[1]) state.sub = m[1]; } }
  const assetById = (id) => state.assets.find((a) => a.id === id);
  // Group order everywhere: follows SEED.CATEGORIES (US → Resources → Crypto → India → Other); within a group, your own sort order
  const catRank = (a) => { const i = SEED.CATEGORIES.findIndex(([k]) => k === a.category); return i < 0 ? SEED.CATEGORIES.length : i; };
  const byGroup = (list) => list.map((a, i) => [a, i]).sort((x, y) => catRank(x[0]) - catRank(y[0]) || x[1] - y[1]).map(([a]) => a);
  const activeAssets = () => byGroup(state.assets.filter((a) => a.active));
  const doneToday = () => { const t = localDate(); return new Set(state.obs.filter((o) => o.observed_on === t).map((o) => o.asset_id)); };
  const chartOn = () => lsGet("chart") === "1";
  const readyToGrade = (o) => o.prediction && !o.outcome && daysBetween(o.observed_on, localDate()) >= GRADE_AFTER_DAYS;

  // ---------- chart links ----------
  // An empty tv_symbol / yahoo_symbol means "no such chart": the button is hidden. Neither set = not listed yet (e.g. pre-IPO).
  const isListed = (a) => !!(a.tv_symbol || a.yahoo_symbol);
  const isCrypto = (a) => a.category === "crypto";
  const tvUrl = (a) => `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(a.tv_symbol)}`;
  const yahooUrl = (a) => `https://finance.yahoo.com/quote/${encodeURIComponent(a.yahoo_symbol)}/`;
  const coinBase = (a) => a.symbol.split(".")[0].toUpperCase();   // BTC, ETH, SOL, HYPE; BTC.D → BTC
  const coinglassUrl = (a) => a.coinglass_url || "https://www.coinglass.com/pro/futures/LiquidationMap";
  const heatmapUrl = (a) => `https://www.coinglass.com/pro/futures/LiquidationHeatMap?coin=${encodeURIComponent(coinBase(a))}`;
  const mcUrl = (a) => a.mc_url || `https://www.google.com/search?q=${encodeURIComponent("moneycontrol " + a.name + " share price")}`;

  // ---------- timer ----------
  const timer = { running: false, startedAt: 0, acc: 0, handle: null };
  const timerSeconds = () => Math.floor((timer.acc + (timer.running ? Date.now() - timer.startedAt : 0)) / 1000);
  function startTimer() {
    if (timer.running) return;
    timer.running = true; timer.startedAt = Date.now();
    if (!timer.handle) timer.handle = setInterval(updateTimerUI, 500);
  }
  function pauseTimer() { if (!timer.running) return; timer.acc += Date.now() - timer.startedAt; timer.running = false; }
  function resetTimer() { timer.running = false; timer.acc = 0; }
  function updateTimerUI() {
    const d = $("#timerDisplay"); if (!d) return;
    const s = timerSeconds();
    d.textContent = fmtTime(s);
    const ring = $("#timerRing");
    ring.style.setProperty("--p", Math.min(1, s / GOAL_SECONDS));
    ring.classList.toggle("done", s >= GOAL_SECONDS);
    const b = $("#timerBtn"); if (b) b.textContent = timer.running ? "Pause" : s ? "Resume" : "Start";
    const h = $("#timerHint"); if (h) h.textContent = s >= GOAL_SECONDS ? "5 minutes done ✓" : `${fmtTime(GOAL_SECONDS - s)} to go`;
  }

  // ---------- boot ----------
  const configured =
    typeof CFG.SUPABASE_URL === "string" && /^https:\/\//.test(CFG.SUPABASE_URL) && !/YOUR-PROJECT/.test(CFG.SUPABASE_URL) &&
    typeof CFG.SUPABASE_ANON_KEY === "string" && CFG.SUPABASE_ANON_KEY.length > 20 && !/YOUR-/.test(CFG.SUPABASE_ANON_KEY);

  if (!configured) { renderSetup(); return; }
  if (!window.supabase) { renderFatal("Couldn't load the Supabase library. Check your internet connection and reload."); return; }

  const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  sb.auth.onAuthStateChange((event, session) => {
    const u = (session && session.user) || null;
    const same = (u && u.id) === (state.user && state.user.id);
    if (same && event !== "INITIAL_SESSION") return;
    state.user = u;
    setTimeout(() => (u ? boot() : renderAuth()), 0);
  });

  async function loadAll() {
    const [a, o, c, j, t, s, g] = await Promise.all([
      must(sb.from("trading_assets").select("*").order("sort").order("created_at")),
      must(sb.from("trading_observations").select("*").order("created_at", { ascending: false }).limit(1000)),
      must(sb.from("trading_concepts").select("*").order("phase").order("sort")),
      must(sb.from("trading_journal_entries").select("*").order("entry_on", { ascending: false }).order("created_at", { ascending: false })),
      must(sb.from("trading_paper_trades").select("*").order("opened_on", { ascending: false }).order("created_at", { ascending: false })),
      must(sb.from("trading_settings").select("*")),
      must(sb.from("trading_glossary").select("*").order("created_at", { ascending: false })),
    ]);
    Object.assign(state, {
      assets: a || [], obs: o || [], concepts: c || [], journal: j || [], trades: t || [], glossary: g || [],
      settings: (s && s[0]) || { paper_balance: 10000 },
    });
    if (state.settings.theme && state.settings.theme !== themePref()) applyTheme(state.settings.theme);
  }

  // Add default assets this account hasn't been offered yet. Matched by symbol, so nothing you edited or already have is touched,
  // and an asset you deleted is never put back (each account remembers the version it has seen: trading_settings.seed_assets_v).
  async function syncSeedAssets() {
    const have = new Set(state.assets.map((a) => a.symbol.toUpperCase()));
    const seen = state.settings.seed_assets_v != null ? state.settings.seed_assets_v : (state.assets.length ? 1 : 0);
    if (seen >= SEED.ASSETS_VERSION) return false;
    let sort = state.assets.reduce((m, a) => Math.max(m, a.sort), -1) + 1;
    const rows = SEED.ASSETS.filter((a) => (a.since || 1) > seen && !have.has(a.symbol.toUpperCase()))
      .map(({ since, ...a }) => ({ ...a, user_id: state.user.id, sort: sort++ }));
    if (rows.length) await must(sb.from("trading_assets").upsert(rows, { onConflict: "user_id,symbol", ignoreDuplicates: true }));
    await must(sb.from("trading_settings").upsert({ user_id: state.user.id, seed_assets_v: SEED.ASSETS_VERSION, updated_at: new Date().toISOString() }));
    return true;
  }

  // Same "offered once" idea for the concept list (trading_settings.seed_concepts_v):
  //  - concepts newer than the account's version are inserted if the title is missing, so one you delete is never put back;
  //  - `moved` concepts (already in your list from before) are moved to their new phase by title; notes, ticks and details are untouched.
  async function syncSeedConcepts() {
    const seen = state.settings.seed_concepts_v != null ? state.settings.seed_concepts_v : (state.concepts.length || state.assets.length ? 1 : 0);
    if (seen >= SEED.CONCEPTS_VERSION) return false;
    const have = new Map(state.concepts.map((c) => [c.title.toLowerCase(), c]));
    for (const c of SEED.CONCEPTS) {
      const row = c.moved > seen && have.get(c.title.toLowerCase());
      if (row && row.phase !== c.phase) await must(sb.from("trading_concepts").update({ phase: c.phase, sort: c.sort }).eq("id", row.id));
    }
    const rows = SEED.CONCEPTS.map((c, i) => ({ c, i })).filter(({ c }) => (c.since || 1) > seen && !have.has(c.title.toLowerCase()))
      .map(({ c, i }) => ({ user_id: state.user.id, phase: c.phase, title: c.title, detail: c.detail, sort: c.sort != null ? c.sort : i }));
    if (rows.length) await must(sb.from("trading_concepts").upsert(rows, { onConflict: "user_id,title", ignoreDuplicates: true }));
    await must(sb.from("trading_settings").upsert({ user_id: state.user.id, seed_concepts_v: SEED.CONCEPTS_VERSION, updated_at: new Date().toISOString() }));
    return true;
  }

  async function boot() {
    app.innerHTML = `<div class="center muted">Loading your journal…</div>`;
    try {
      await loadAll();
      const seededAssets = await syncSeedAssets();
      const seededConcepts = await syncSeedConcepts();
      if (seededAssets || seededConcepts) await loadAll();
      state.live = { at: 0, res: new Map(), fx: {} }; state.typed.clear(); state.alertItems = []; state.fired.clear();
      render(); renderBanner(); applyPracticeSwitch();   // the 60 s timer starts when a poll has finished, so the 60 s price cache has always expired by then
    } catch (e) {
      console.error(e);
      renderFatal(friendly(e), true);
    }
  }

  // ---------- shell ----------
  const TABS = [
    ["progress", "Progress"], ["watchlist", "Watchlist"], ["today", "Today"], ["learn", "Learn"], ["practice", "Practice trades"],
  ];
  // Focus mode: practice trades are frozen and hidden unless Settings → "Show practice trades" is on (trading_settings.show_practice, default off)
  const practiceOn = () => state.settings.show_practice === true;
  const visibleTabs = () => TABS.filter(([k]) => k !== "practice" || practiceOn());
  const VIEWS = {
    progress: viewProgress, watchlist: viewWatchlist, today: viewToday, learn: viewConcepts, practice: viewPractice,
    settings: viewSettings,
  };
  const SUBS = [["overview", "Overview"], ["journal", "Journal"], ["history", "History"]];

  // Keep whatever is typed in the observation form when the page re-renders
  function snapshotObsForm() {
    const f = $("#obsForm"); if (!f) return null;
    return { asset: state.selected, vals: Array.from(f.elements).map((e) => ({ v: e.value, c: e.checked })) };
  }
  function restoreObsForm(snap) {
    const f = $("#obsForm");
    if (!f || !snap || snap.asset !== state.selected) return;
    Array.from(f.elements).forEach((e, i) => {
      const s = snap.vals[i]; if (!s) return;
      if (e.type === "checkbox" || e.type === "radio") e.checked = s.c;
      else if (e.type !== "file" && e.tagName !== "BUTTON") e.value = s.v;
    });
    const r = f.querySelector("[name=confidence]"); if (r && $("#confOut")) $("#confOut").textContent = r.value + "/5";
  }

  function render(keepScroll) {
    const y = window.scrollY;
    const snap = snapshotObsForm();
    if (!VIEWS[state.tab] || (state.tab === "practice" && !practiceOn())) { state.tab = "today"; lsSet("tab", "today"); }
    if (!SUBS.some(([k]) => k === state.sub)) state.sub = "overview";
    const due = state.obs.filter(readyToGrade).length;
    app.innerHTML = `
      <header class="top">
        <div class="brand"><span class="logo">▲</span>Chart Journal</div>
        <nav class="tabs">${visibleTabs().map(([k, l]) =>
          `<button class="tab ${state.tab === k ? "on" : ""}" data-action="tab" data-tab="${k}">${l}${k === "progress" && due ? ` <span class="badge" title="Guesses ready to grade">${due}</span>` : ""}</button>`).join("")}</nav>
        <button class="tab gear addword" data-action="word-modal" title="Add a word I don't understand">＋ <span class="gear-l">Word</span></button>
        <button class="tab gear ${state.tab === "settings" ? "on" : ""}" data-action="tab" data-tab="settings" title="Settings" aria-label="Settings">⚙ <span class="gear-l">Settings</span></button>
      </header>
      <main class="main">${VIEWS[state.tab]()}</main>`;
    restoreObsForm(snap);
    if (keepScroll) window.scrollTo(0, y);
    if (state.tab === "today" && state.selected && chartOn()) { const a = assetById(state.selected); if (a && a.tv_symbol) mountChart(a); }
    if (state.tab === "today" && state.selected && state.tfGrid) { const a = assetById(state.selected); if (a) mountGrid(a); }
    if (state.tab === "practice") practiceAfterRender();
    updateTimerUI();
    renderPendingShots();
    hydrateShots();
  }

  // ---------- screenshots ----------
  const shotUrlCache = new Map(); // path -> {url, at}

  async function hydrateShots() {
    const imgs = $$("img[data-shot]");
    if (!imgs.length) return;
    const fresh = (p) => { const c = shotUrlCache.get(p); return c && Date.now() - c.at < 50 * 60 * 1000; };
    const need = [...new Set(imgs.map((i) => i.dataset.shot).filter((p) => !fresh(p)))];
    if (need.length) {
      try {
        const data = await must(sb.storage.from(BUCKET).createSignedUrls(need, 3600));
        (data || []).forEach((d) => { if (d.signedUrl) shotUrlCache.set(d.path, { url: d.signedUrl, at: Date.now() }); });
      } catch (e) { console.error(e); }
    }
    $$("img[data-shot]").forEach((i) => { const c = shotUrlCache.get(i.dataset.shot); if (c && i.src !== c.url) i.src = c.url; });
  }

  const shotStrip = (paths, kind, id) => `
    <div class="shots">
      ${(paths || []).map((p) => `<button type="button" class="shot" data-action="view-shot" data-path="${esc(p)}"><img data-shot="${esc(p)}" alt="Chart screenshot"></button>`).join("")}
      ${kind ? `<label class="shot add" title="Add screenshot"><input type="file" accept="image/*" multiple hidden data-shotfile="${kind}:${id}">＋</label>` : ""}
    </div>`;

  // Shrink big Retina screenshots before uploading (keeps storage small, still sharp enough to read)
  async function compress(file) {
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, 1800 / bmp.width);
      if (scale === 1 && file.size < 900 * 1024) return file;
      const c = document.createElement("canvas");
      c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
      c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
      const toBlob = (type) => new Promise((r) => c.toBlob(r, type, 0.85));
      let b = await toBlob("image/webp");
      if (!b || b.type !== "image/webp") b = await toBlob("image/jpeg");
      return b || file;
    } catch { return file; }
  }
  async function uploadShot(file) {
    const blob = await compress(file);
    const ext = blob.type === "image/webp" ? "webp" : blob.type === "image/png" ? "png" : "jpg";
    const path = `${state.user.id}/${localDate()}/${crypto.randomUUID()}.${ext}`;
    await must(sb.storage.from(BUCKET).upload(path, blob, { contentType: blob.type || "image/png", upsert: false }));
    return path;
  }
  async function removeShots(paths) {
    if (paths && paths.length) { try { await must(sb.storage.from(BUCKET).remove(paths)); } catch (e) { console.error(e); } }
  }

  function addPending(files) {
    const imgs = Array.from(files || []).filter((f) => /^image\//.test(f.type));
    if (!imgs.length) return false;
    imgs.forEach((f) => state.pendingShots.push({ blob: f, url: URL.createObjectURL(f) }));
    renderPendingShots();
    toast(`${imgs.length} screenshot${imgs.length > 1 ? "s" : ""} added. They upload when you save.`);
    return true;
  }
  function clearPending() { state.pendingShots.forEach((p) => URL.revokeObjectURL(p.url)); state.pendingShots = []; }
  function renderPendingShots() {
    const box = $("#shotPreview"); if (!box) return;
    box.innerHTML = state.pendingShots.map((p, i) => `
      <div class="shot pending"><img src="${p.url}" alt="Screenshot to upload"><button type="button" class="shot-x" data-action="rm-pending" data-i="${i}" title="Remove">×</button></div>`).join("");
  }

  // Add screenshots to something already saved (an observation or a trade)
  async function attachShots(target, files) {
    const [kind, id] = target.split(":");
    const table = kind === "trade" ? "trading_paper_trades" : "trading_observations";
    const list = kind === "trade" ? state.trades : state.obs;
    const row = list.find((r) => r.id === id); if (!row) return;
    const imgs = Array.from(files || []).filter((f) => /^image\//.test(f.type)); if (!imgs.length) return;
    toast("Uploading…");
    try {
      const paths = [];
      for (const f of imgs) paths.push(await uploadShot(f));
      const next = [...(row.screenshots || []), ...paths];
      await must(sb.from(table).update({ screenshots: next }).eq("id", id));
      row.screenshots = next;
      render(true); toast("Screenshot saved");
    } catch (e) { fail(e); }
  }

  function openLightbox(path) {
    const c = shotUrlCache.get(path);
    const lb = document.createElement("div");
    lb.className = "lightbox"; lb.dataset.action = "close-lightbox";
    lb.innerHTML = `<img alt="Chart screenshot" src="${c ? esc(c.url) : ""}"><button class="lb-x" data-action="close-lightbox" aria-label="Close">×</button>`;
    document.body.appendChild(lb);
    lb.addEventListener("click", (e) => { if (e.target.dataset.action === "close-lightbox" || e.target === lb) lb.remove(); });
  }

  // ---------- TODAY ----------
  function groupAssets(list) {
    return SEED.CATEGORIES.map(([k, l]) => [l, list.filter((a) => a.category === k)]).filter(([, xs]) => xs.length);
  }

  function viewToday() {
    const active = activeAssets();
    const done = doneToday();
    const n = active.filter((a) => done.has(a.id)).length;
    const pct = active.length ? Math.round((n / active.length) * 100) : 0;
    const counts = {};
    const t = localDate();
    state.obs.forEach((o) => { if (o.observed_on === t) counts[o.asset_id] = (counts[o.asset_id] || 0) + 1; });
    if (state.selected && !assetById(state.selected)) state.selected = null;
    const sel = state.selected && assetById(state.selected);
    const allDone = n === active.length && n > 0;

    return `
      <section>
        <div class="sec-head">
          <div><h2>Today · ${fmtDate(t, { weekday: "long", month: "long", day: "numeric" })}</h2>
            <p class="muted">Pick an asset, study its chart on TradingView, Yahoo Finance or Moneycontrol for at least 5 minutes, then write down what you see.</p></div>
          <div class="pill big ${allDone ? "good" : ""}">${n}/${active.length} charts</div>
        </div>
        <div class="bar"><span style="width:${pct}%"></span></div>
        <div class="today-grid">
          <aside class="card checklist">
            ${active.length ? groupAssets(active).map(([label, xs]) => `
              <div class="group-label">${esc(label)}</div>
              ${xs.map((a) => `
                <button class="check-row ${state.selected === a.id ? "sel" : ""} ${done.has(a.id) ? "done" : ""}" data-action="select" data-id="${a.id}">
                  <span class="box">${done.has(a.id) ? "✓" : ""}</span>
                  <span class="sym">${esc(a.symbol)}</span>
                  <span class="nm">${esc(a.name)}</span>
                  ${counts[a.id] > 1 ? `<span class="count">×${counts[a.id]}</span>` : ""}
                </button>`).join("")}`).join("")
            : `<p class="muted small pad">No active assets. Turn some on in the Watchlist tab.</p>`}
          </aside>
          <div class="observe" id="observe">
            ${sel ? viewObserve(sel) : `
              <div class="card empty">
                <div class="empty-icon">◎</div>
                <h3>${allDone ? "Every chart done for today 🎉" : "Choose a chart from the list"}</h3>
                <p class="muted">${allDone
                  ? "Good work. Write a journal entry about what you noticed, or tick off a concept you studied."
                  : "A 5-minute timer starts when you open one. Look first, then fill in the notes."}</p>
                ${allDone ? `<button class="btn primary" data-action="tab" data-tab="progress" data-sub="journal">Write today's journal</button>` : ""}
              </div>`}
          </div>
        </div>
      </section>`;
  }

  const chip = (type, name, value, label, checked) =>
    `<label class="chip"><input type="${type}" name="${name}" value="${esc(value)}" ${checked ? "checked" : ""}><span>${esc(label)}</span></label>`;

  function viewObserve(a) {
    const prev = state.obs.filter((o) => o.asset_id === a.id).slice(0, 3);
    const sources = SOURCES.filter(([k]) => k !== "coinglass" || isCrypto(a));
    const lastSource = sources.some(([k]) => k === lsGet("source")) ? lsGet("source") : "tradingview";
    return `
      <div class="card obs-card">
        <div class="obs-head">
          <div class="obs-title">
            <div class="eyebrow">${esc(CAT_LABEL[a.category] || "Other")}</div>
            <h3>${esc(a.symbol)} <span class="muted">· ${esc(a.name)}</span></h3>
            ${a.why ? `<p class="muted small">${esc(a.why)}</p>` : ""}
            <button type="button" class="btn ghost xs" data-action="csv" data-scope="today" title="Export ${esc(a.symbol)} metrics (CSV)">⬇ CSV</button>
          </div>
          <div class="timer">
            <div class="ring" id="timerRing"><span id="timerDisplay">00:00</span></div>
            <div class="timer-side">
              <div class="small muted" id="timerHint">5:00 to go</div>
              <div class="timer-btns">
                <button class="btn sm" type="button" data-action="timer-toggle" id="timerBtn">Start</button>
                <button class="btn ghost sm" type="button" data-action="timer-reset">Reset</button>
              </div>
            </div>
          </div>
        </div>

        <div class="open-in">
          ${isListed(a) ? `
          <span class="small muted">Open the chart in</span>
          ${a.tv_symbol ? `<a class="btn sm src-btn" data-src="tradingview" href="${tvUrl(a)}" target="_blank" rel="noopener">TradingView ↗</a>` : ""}
          ${a.yahoo_symbol ? `<a class="btn sm src-btn" data-src="yahoo" href="${yahooUrl(a)}" target="_blank" rel="noopener">Yahoo Finance ↗</a>` : ""}
          <a class="btn sm src-btn" data-src="moneycontrol" href="${mcUrl(a)}" target="_blank" rel="noopener" ${a.mc_url ? "" : `title="Opens a search. Paste the exact Moneycontrol page into Watchlist → Edit for one click next time."`}>Moneycontrol ↗</a>
          ${isCrypto(a) ? `
          <a class="btn sm src-btn" data-src="coinglass" href="${esc(coinglassUrl(a))}" target="_blank" rel="noopener" title="Liquidation map">Coinglass ↗</a>
          <a class="btn sm src-btn" data-src="coinglass" href="${esc(heatmapUrl(a))}" target="_blank" rel="noopener" title="Liquidation heatmap for ${esc(coinBase(a))}">Heatmap ↗</a>` : ""}
          ${a.tv_symbol ? `
          <button class="btn ghost sm" data-action="toggle-chart">${chartOn() ? "Hide quick chart" : "Quick chart here"}</button>
          <button class="btn ghost sm" data-action="toggle-grid">${state.tfGrid ? "Hide all timeframes" : "All timeframes"}</button>` : ""}`
          : `<span class="tag warn">Not listed yet</span>
          <span class="small muted">No chart symbols yet. Add them in Watchlist → Edit when it lists.</span>`}
        </div>
        ${chartOn() && a.tv_symbol ? `<div id="tvchart" class="tvchart"><div class="center muted">Loading chart…</div></div>` : ""}
        ${state.tfGrid && a.tv_symbol ? `<div id="tfgridBox">${tfGridHtml(a)}</div>` : ""}

        <form id="obsForm" class="form" autocomplete="off">
          <fieldset><legend>Where did you look?</legend>
            <div class="chips">${sources.map(([k, l]) => chip("radio", "source", k, l, k === lastSource)).join("")}</div>
          </fieldset>

          <fieldset><legend>Timeframes I checked</legend>
            <div class="chips">${tfChips().map((t) => chip("checkbox", "timeframes", t, t, t === "1D" || (t === tfChips()[0] && !tfChips().includes("1D")))).join("")}</div>
            <p class="xs muted">Higher timeframes matter more than lower ones.</p>
          </fieldset>

          <div class="row2">
            <div class="pricefield">
              <label>Current price<input name="price" type="number" step="any" inputmode="decimal" placeholder="e.g. 245.30"></label>
              <div class="live-row"><button type="button" class="btn ghost xs" data-action="live-obs" ${TJ_PRICES.sourceFor(a).kind === "none" ? `disabled title="${esc(TJ_PRICES.sourceFor(a).reason)}"` : ""}>Use live price</button><span class="xs muted" id="liveObsNote"></span></div>
            </div>
            <label>Volume
              <select name="volume"><option value="">—</option><option value="normal">Normal</option><option value="rising">Rising</option><option value="falling">Falling</option><option value="spike">Big spike</option></select>
            </label>
          </div>

          <fieldset><legend>Trend</legend>
            <div class="chips">${chip("radio", "trend", "up", "↗ Up")}${chip("radio", "trend", "down", "↘ Down")}${chip("radio", "trend", "sideways", "→ Sideways")}</div>
          </fieldset>

          <div class="row2">
            <label>Support (floor price)<input name="support" type="number" step="any" inputmode="decimal"></label>
            <label>Resistance (ceiling price)<input name="resistance" type="number" step="any" inputmode="decimal"></label>
          </div>

          ${liqFields(a)}

          <label>Notes: what did you notice?
            <textarea name="notes" rows="4" placeholder="Where did price start and end? Any big candles? Where did it stall? How does it compare with others in its group?"></textarea>
          </label>
          <label>News or events that might explain it
            <textarea name="news" rows="2" placeholder="Earnings, Fed decision, CPI, war headlines, ETF flows…"></textarea>
          </label>

          <fieldset><legend>Screenshots <span class="muted small">optional</span></legend>
            <div class="shot-drop" id="shotDrop">
              <div id="shotPreview" class="shots"></div>
              <div class="shot-actions">
                <label class="btn sm"><input type="file" accept="image/*" multiple hidden data-shotfile="new">Add screenshot</label>
                <span class="small muted">or paste with ⌘V, or drag an image here. Tip: ⌘⇧⌃4 copies a screenshot of part of your screen.</span>
              </div>
            </div>
          </fieldset>

          <div class="row2">
            <fieldset><legend>My guess for the next week</legend>
              <div class="chips">${chip("radio", "prediction", "up", "Up")}${chip("radio", "prediction", "down", "Down")}${chip("radio", "prediction", "flat", "Flat")}</div>
            </fieldset>
            <label><span class="lbl">Confidence <span class="muted" id="confOut">3/5</span></span><input type="range" name="confidence" min="1" max="5" value="3" data-input="conf">
            </label>
          </div>

          <div class="form-foot">
            <span class="small muted">Saving checks ${esc(a.symbol)} off today's list. Fill in the price if you guess, so the app can grade it in a week.</span>
            <button class="btn primary" type="submit">Save observation</button>
          </div>
        </form>

        ${prev.length ? `
          <div class="prev">
            <h4>Your last notes on ${esc(a.symbol)}</h4>
            ${prev.map((o) => obsCard(o, false)).join("")}
          </div>` : ""}
      </div>`;
  }

  let tvPromise = null;
  function loadTV() {
    if (window.TradingView) return Promise.resolve();
    if (!tvPromise) {
      tvPromise = new Promise((res, rej) => {
        const s = document.createElement("script");
        s.src = "https://s3.tradingview.com/tv.js";
        s.onload = res;
        s.onerror = () => { tvPromise = null; rej(new Error("tv.js failed")); };
        document.head.appendChild(s);
      });
    }
    return tvPromise;
  }
  // ---------- liquidation fields (Anikait: record these on every crypto chart) ----------
  function liqFields(a) {
    const body = `
      <div class="row2">
        <label>Liquidation cluster above (price)<input name="liq_above" type="number" step="any" inputmode="decimal"></label>
        <label>Liquidation cluster below (price)<input name="liq_below" type="number" step="any" inputmode="decimal"></label>
      </div>
      <label>Where do stop losses likely sit?<input name="stops_note" maxlength="300" placeholder="e.g. just under the last swing low, around 61,200"></label>
      <label class="toggle small"><input type="checkbox" name="liq_map_checked"> I checked the liquidation map (Coinglass)</label>`;
    return isCrypto(a)
      ? `<fieldset class="liq"><legend>Liquidations <span class="muted small">for crypto</span></legend>${body}</fieldset>`
      : `<details class="liq-opt"><summary>Liquidation levels <span class="muted small">optional</span></summary><div class="form">${body}</div></details>`;
  }

  // ---------- all-timeframes grid (small TradingView widgets, loaded only when opened) ----------
  const chosenTimeframes = () => {
    const picked = $$("#obsForm input[name=timeframes]:checked").map((i) => i.value);
    return picked.length ? picked : [tfChips().includes("1D") ? "1D" : tfChips()[0]];
  };
  // Maps any chip ("15m", "2h", "3D"…) to a free-widget interval; unsupported ones borrow the nearest supported tile ({sub}).
  function tvSpec(tf) {
    if (TV_TF[tf]) return TV_TF[tf];
    const m = /^(\d+)(m|h|D|W|M|Y)$/.exec(tf); if (!m) return null;
    const n = Number(m[1]), u = m[2];
    if (u === "m") return [1, 3, 5, 15, 30].includes(n) ? { iv: String(n) } : { sub: n < 15 ? "15m" : "30m" };
    if (u === "h") return n >= 1 && n <= 4 ? { iv: String(n * 60) } : { sub: "4h" };
    if (u === "D") return n === 1 ? { iv: "D" } : { sub: "1D" };
    if (u === "W") return n === 1 ? { iv: "W" } : { sub: "1W" };
    if (u === "M") return n === 1 ? { iv: "M" } : { sub: "1M" };
    return { sub: "1Y" };
  }
  // One tile per chosen timeframe; unsupported ones (8h, 12h) borrow the nearest supported tile and say so.
  function buildTiles(chosen) {
    const tiles = [];
    const byKey = new Map();
    tfChips().filter((t) => chosen.includes(t)).forEach((tf) => {
      const spec = tvSpec(tf); if (!spec) return;
      const shown = spec.sub || tf;
      const real = tvSpec(shown); if (!real || real.sub) return;
      const key = real.iv + (real.range || "");
      let tile = byKey.get(key);
      if (!tile) { tile = { label: real.label || shown, shown, iv: real.iv, range: real.range, missing: [] }; byKey.set(key, tile); tiles.push(tile); }
      if (spec.sub) tile.missing.push(tf);
    });
    return tiles;
  }
  const tvTheme = () => document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  function tfGridHtml() {
    state.tfTiles = buildTiles(state.tfList || ["1D"]);
    return `<div class="tfgrid">${state.tfTiles.map((t, i) => `
      <div class="tf-tile">
        <div class="tf-head"><b>${esc(t.label)}</b>
          ${t.missing.length ? `<span class="xs muted">(${esc(t.shown)} shown, ${esc(t.missing.join(" and "))} not available in the free widget)</span>` : ""}
          <button class="icon-btn tf-big" type="button" data-action="enlarge-tf" data-i="${i}" title="Enlarge" aria-label="Enlarge ${esc(t.label)}">⤢</button></div>
        <div class="tf-chart" id="tf-${i}"><div class="center muted small">Loading…</div></div>
      </div>`).join("")}</div>`;
  }
  function tvOptions(a, tile, containerId, small) {
    return {
      container_id: containerId, symbol: a.tv_symbol, interval: tile.iv, ...(tile.range ? { range: tile.range } : {}), autosize: true,
      theme: tvTheme(), style: "1", locale: "en", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Etc/UTC",
      allow_symbol_change: false, withdateranges: !small, hide_side_toolbar: small, details: false,
      studies: small ? [] : ["Volume@tv-basicstudies"],
    };
  }
  function mountGrid(a) {
    if (!state.tfGrid || !a.tv_symbol) return;
    loadTV().then(() => {
      if (!state.tfGrid || state.selected !== a.id || !window.TradingView) return;
      state.tfTiles.forEach((t, i) => { const box = $("#tf-" + i); if (box) { box.innerHTML = ""; new window.TradingView.widget(tvOptions(a, t, "tf-" + i, true)); } });
    }).catch(() => { const b = $("#tfgridBox"); if (b) b.innerHTML = `<div class="center muted small">Couldn't load TradingView. Check your connection.</div>`; });
  }
  function refreshGrid() {
    const a = state.selected && assetById(state.selected); const box = $("#tfgridBox");
    if (!a || !box) return;
    box.innerHTML = tfGridHtml(a); mountGrid(a);
  }
  function enlargeTile(i) {
    const a = state.selected && assetById(state.selected); const t = state.tfTiles && state.tfTiles[i];
    if (!a || !t) return;
    const lb = document.createElement("div");
    lb.className = "lightbox tv-modal";
    lb.innerHTML = `<div class="tv-big-wrap"><div class="tf-head"><b>${esc(a.symbol)} · ${esc(t.label)}</b>${t.missing.length ? `<span class="xs"> (${esc(t.shown)} shown, ${esc(t.missing.join(" and "))} not available in the free widget)</span>` : ""}</div><div class="tv-big" id="tvBig"></div></div><button class="lb-x" data-action="close-lightbox" aria-label="Close">×</button>`;
    document.body.appendChild(lb);
    lb.addEventListener("click", (e) => { if (e.target === lb || (e.target.dataset && e.target.dataset.action === "close-lightbox")) lb.remove(); });
    loadTV().then(() => { if (document.body.contains(lb) && window.TradingView) new window.TradingView.widget(tvOptions(a, t, "tvBig", false)); }).catch(() => {});
  }

  function mountChart(a) {
    const el = $("#tvchart"); if (!el) return;
    if (!a.tv_symbol) { el.innerHTML = `<div class="center muted small">No TradingView symbol set. Add one in the Watchlist tab.</div>`; return; }
    loadTV().then(() => {
      const box = $("#tvchart");
      if (!box || state.selected !== a.id || !window.TradingView) return;
      box.innerHTML = "";
      new window.TradingView.widget({
        container_id: "tvchart", symbol: a.tv_symbol, interval: "D", autosize: true,
        theme: tvTheme(), style: "1", locale: "en",
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Etc/UTC",
        allow_symbol_change: true, withdateranges: true, hide_side_toolbar: false, details: false,
        studies: ["Volume@tv-basicstudies"],
      });
    }).catch(() => {
      const box = $("#tvchart");
      if (box) box.innerHTML = `<div class="center muted small">Couldn't load the quick chart. Use the TradingView button instead.</div>`;
    });
  }

  function nextUnchecked(afterId) {
    const list = activeAssets();
    const done = doneToday();
    const i = list.findIndex((a) => a.id === afterId);
    const order = list.slice(i + 1).concat(list.slice(0, i + 1));
    return order.find((a) => !done.has(a.id)) || null;
  }

  async function saveObservation(form) {
    const a = assetById(state.selected); if (!a) return;
    const fd = new FormData(form);
    const num = (k) => { const v = fd.get(k); return v === "" || v == null ? null : Number(v); };
    const str = (k) => { const v = (fd.get(k) || "").toString().trim(); return v || null; };
    const tfs = fd.getAll("timeframes");
    const row = {
      asset_id: a.id, observed_on: localDate(), source: str("source"),
      timeframe: tfs[0] || "1D", timeframes: tfs,      // "timeframe" keeps the first one for old views
      liq_above: num("liq_above"), liq_below: num("liq_below"), stops_note: str("stops_note"),
      liq_map_checked: fd.get("liq_map_checked") ? true : (isCrypto(a) ? false : null),
      seconds_spent: timerSeconds(), price: num("price"), trend: str("trend"),
      support: num("support"), resistance: num("resistance"), volume: str("volume"),
      patterns: [], notes: str("notes"), news: str("news"),
      prediction: str("prediction"), confidence: str("prediction") ? num("confidence") : null, screenshots: [],
    };
    if (!row.notes && !row.trend) { toast("Add at least a trend or a note.", "err"); return; }
    const btn = form.querySelector("[type=submit]");
    btn.disabled = true; btn.textContent = state.pendingShots.length ? "Uploading screenshots…" : "Saving…";
    const uploaded = [];
    try {
      for (const p of state.pendingShots) uploaded.push(await uploadShot(p.blob));
      row.screenshots = uploaded;
      btn.textContent = "Saving…";
      const saved = await must(sb.from("trading_observations").insert(row).select().single());
      state.obs.unshift(saved);
      if (row.source) lsSet("source", row.source);
      clearPending();
      resetTimer();
      const next = nextUnchecked(a.id);
      state.selected = next ? next.id : null;
      if (next) startTimer();
      render();
      toast(next ? `Saved ${a.symbol}. Next up: ${next.symbol}` : `Saved ${a.symbol}. That's every chart for today 🎉`);
    } catch (e) {
      await removeShots(uploaded);
      fail(e); btn.disabled = false; btn.textContent = "Save observation";
    }
  }

  // ---------- grading guesses ----------
  function autoOutcome(prediction, pct) {
    if (prediction === "up") return pct >= 1 ? "right" : pct <= -1 ? "wrong" : "mixed";
    if (prediction === "down") return pct <= -1 ? "right" : pct >= 1 ? "wrong" : "mixed";
    const m = Math.abs(pct); return m < 1 ? "right" : m > 3 ? "wrong" : "mixed";
  }
  const movePct = (o) => (o.price && o.check_price != null ? ((o.check_price - o.price) / o.price) * 100 : null);

  function gradeBlock(o) {
    if (!o.prediction) return "";
    const pct = movePct(o);
    const head = `Guess: <b>${esc(o.prediction)}</b>${o.confidence ? ` (${o.confidence}/5 sure)` : ""}`;
    const manual = ["right", "mixed", "wrong"].map((v) =>
      `<button class="btn xs ${o.outcome === v ? "on " + v : ""}" data-action="outcome" data-id="${o.id}" data-v="${v}">${v}</button>`).join("");
    if (o.check_price != null) {
      return `<div class="grade small">
        <div>${head} · ${fmtNum(o.price)} → ${fmtNum(o.check_price)} <b class="${sign(pct)}">${fmtPct(pct)}</b>
          <span class="muted">in ${daysBetween(o.observed_on, o.checked_on || localDate())} days</span></div>
        <div class="outcome">Result: ${manual}<button class="btn ghost xs" data-action="ungrade" data-id="${o.id}">redo</button></div></div>`;
    }
    const age = daysBetween(o.observed_on, localDate());
    const due = age >= GRADE_AFTER_DAYS;
    return `<div class="grade small ${due && !o.outcome ? "due" : ""}">
      <div>${head} · ${due ? (o.outcome ? "" : `<b>Ready to grade</b>`) : `<span class="muted">grade on ${fmtDate(addDays(o.observed_on, GRADE_AFTER_DAYS))}</span>`}</div>
      ${o.price ? `
        <div class="grade-row">
          <input type="number" step="any" inputmode="decimal" placeholder="Price now" data-checkprice="${o.id}" aria-label="Price now">
          <button class="btn sm" data-action="grade" data-id="${o.id}">Check guess</button>
          <span class="live-wrap"><button type="button" class="btn ghost xs" data-action="live-grade" data-id="${o.id}" ${TJ_PRICES.sourceFor(assetById(o.asset_id)).kind === "none" ? `disabled title="${esc(TJ_PRICES.sourceFor(assetById(o.asset_id)).reason)}"` : ""}>Use live price</button><span class="xs muted live-note"></span></span>
          <span class="muted">or</span> ${manual}
        </div>`
      : `<div class="outcome"><span class="muted">No starting price saved, so grade it yourself:</span> ${manual}</div>`}
    </div>`;
  }

  async function gradeWithPrice(id) {
    const o = state.obs.find((x) => x.id === id); if (!o) return;
    const input = $(`[data-checkprice="${id}"]`);
    const v = input && Number(input.value);
    if (!v || v <= 0) { toast("Type the price now first.", "err"); return; }
    const pct = ((v - o.price) / o.price) * 100;
    const patch = { check_price: v, checked_on: localDate(), outcome: autoOutcome(o.prediction, pct) };
    try {
      await must(sb.from("trading_observations").update(patch).eq("id", id));
      Object.assign(o, patch); render(true);
      toast(`${fmtPct(pct)} → your guess was ${patch.outcome}`);
    } catch (e) { fail(e); }
  }

  // ---------- observation card ----------
  function obsCard(o, full = true) {
    const a = assetById(o.asset_id);
    const trendTxt = { up: "↗ Up", down: "↘ Down", sideways: "→ Sideways" }[o.trend];
    return `
      <article class="obs">
        <div class="obs-top">
          ${full ? `<span class="sym">${esc(a ? a.symbol : "?")}</span>` : `<span class="small muted">${fmtDate(o.observed_on)}</span>`}
          ${(o.timeframes && o.timeframes.length ? o.timeframes : [o.timeframe]).map((t) => `<span class="tag">${esc(t)}</span>`).join("")}
          ${trendTxt ? `<span class="tag trend-${o.trend}">${trendTxt}</span>` : ""}
          ${o.volume ? `<span class="tag">Vol: ${esc(o.volume)}</span>` : ""}
          ${o.source ? `<span class="tag soft">${esc(SOURCE_LABEL[o.source] || o.source)}</span>` : ""}
          <span class="meta-right"><span class="small muted">${Math.round((o.seconds_spent || 0) / 60)} min${o.price != null ? ` · @ ${fmtNum(o.price)}` : ""}</span>
          ${full ? `<button class="icon-btn" data-action="dl-item" data-kind="obs" data-id="${o.id}" title="Download this chart (zip)" aria-label="Download">⬇</button><button class="icon-btn" data-action="del-obs" data-id="${o.id}" title="Delete">×</button>` : ""}</span>
        </div>
        ${o.support != null || o.resistance != null ? `<div class="small">Support <b>${fmtNum(o.support)}</b> · Resistance <b>${fmtNum(o.resistance)}</b></div>` : ""}
        ${o.liq_above != null || o.liq_below != null || o.stops_note || o.liq_map_checked != null ? `<div class="small liq-line">
          💥 Liquidation clusters: ${o.liq_above != null ? `above <b>${fmtNum(o.liq_above)}</b>` : ""}${o.liq_above != null && o.liq_below != null ? " · " : ""}${o.liq_below != null ? `below <b>${fmtNum(o.liq_below)}</b>` : ""}${o.liq_above == null && o.liq_below == null ? "—" : ""}
          ${o.liq_map_checked === true ? ` · <span class="ok">map checked ✓</span>` : o.liq_map_checked === false ? ` · <span class="muted">map not checked</span>` : ""}
          ${o.stops_note ? `<div class="muted">Stops likely: ${esc(o.stops_note)}</div>` : ""}</div>` : ""}
        ${o.patterns && o.patterns.length ? `<div class="tags">${o.patterns.map((p) => `<span class="tag soft">${esc(p)}</span>`).join("")}</div>` : ""}
        ${o.notes ? `<p class="note">${esc(o.notes)}</p>` : ""}
        ${o.news ? `<p class="small muted">📰 ${esc(o.news)}</p>` : ""}
        ${(o.screenshots && o.screenshots.length) || full ? shotStrip(o.screenshots, full ? "obs" : null, o.id) : ""}
        ${full ? gradeBlock(o)
          : o.prediction ? `<div class="small">Guess: <b>${esc(o.prediction)}</b>${o.outcome ? ` <span class="tag ${o.outcome}">${esc(o.outcome)}</span>` : ""}</div>` : ""}
      </article>`;
  }

  // ---------- HISTORY ----------
  function viewHistory() {
    const f = state.historyFilter;
    const list = filteredObs().filter((o) => f !== "grade" || readyToGrade(o));
    const due = assetObs().filter(readyToGrade).length;
    const days = [];
    list.forEach((o) => { const last = days[days.length - 1]; if (last && last[0] === o.observed_on) last[1].push(o); else days.push([o.observed_on, [o]]); });
    return `
      <section>
        <div class="sec-head">
          <div><h2>History</h2><p class="muted">Every chart you've studied. A week after a guess, type the price now and the app grades it.</p></div>
          <div class="sec-actions">
            <label class="toggle small"><input type="checkbox" data-change="grade-only" ${f === "grade" ? "checked" : ""}> Only ready to grade (${due})</label>
            <select data-change="asset-filter" class="select" aria-label="Asset">
              <option value="all">All assets</option>
              ${byGroup(state.assets).map((a) => `<option value="${a.id}" ${state.assetFilter === a.id ? "selected" : ""}>${esc(a.symbol)} · ${esc(a.name)}</option>`).join("")}
            </select>
          </div>
        </div>
        ${days.length ? days.map(([d, xs]) => `
          <div class="day">
            <h3 class="day-head">${fmtDate(d, { weekday: "long", month: "short", day: "numeric", year: "numeric" })} <span class="muted small">· ${xs.length} chart${xs.length > 1 ? "s" : ""}</span></h3>
            <div class="obs-list">${xs.map((o) => obsCard(o, true)).join("")}</div>
          </div>`).join("")
        : `<div class="card empty"><p class="muted">${f === "grade" ? "Nothing to grade right now. Guesses become gradable 7 days after you make them." : (state.dayFilter || state.assetFilter !== "all" ? "No observations for this filter." : "Nothing here yet. Your saved observations will show up here.")}</p></div>`}
      </section>`;
  }

  // ---------- PRACTICE TRADES ----------
  // ---------- practice-trade maths: pure functions live in trade.js (window.TJ_TRADE) so node can test them; TJ_MATH is kept for the old tests ----------
  const T = window.TJ_TRADE, X = window.TJ_EXPORT;
  const { tradePnl, liqPrice, positionSize, floorTo, isFutures, tradeMargin, tradeFees, tradeRisk, fundingEstimate, tradeNetLocal, tradeNetUsd, tradeR, tradeProblems: tradeProblemsRaw, MAINT_PCT } = T;
  window.TJ_MATH = { liqPrice, positionSize, floorTo, tradeNetLocal, tradeNetUsd, fundingEstimate, tradeFees, MAINT_PCT };

  const fmtCur = (n, cur) => {
    if (n == null || isNaN(n)) return "—";
    if (!cur || cur === "USD") return fmtMoney(n);
    try { return new Intl.NumberFormat(undefined, { style: "currency", currency: cur }).format(n); } catch { return `${fmtNum(n)} ${cur}`; }
  };
  const defaultCurrency = (a) => (a && a.category === "india" ? "INR" : "USD");

  // Problems with a trade's values (wrong-side stop/target, futures stop beyond liquidation, and, for an open trade with a fresh live price, an entry more
  // than 50% from it). Used to block saving and to flag old trades (never edits them). A flagged trade never gets a one-click close.
  const liveFresh = (t) => { const r = t.exit_price == null ? state.live.res.get(t.id) : null; return r && r.price != null ? r.price : null; };
  const tradeProblems = (t) => tradeProblemsRaw(t, liveFresh(t));

  function practiceStats() {
    const closed = state.trades.filter((t) => t.exit_price != null);
    const start = Number(state.settings.paper_balance) || 10000;
    const acc = T.account(start, state.trades, (c) => fxRate(c));   // balance = cash after closed trades; available = balance − what open trades tie up
    const realized = acc.realized;
    const wins = closed.filter((t) => tradeNetUsd(t) > 0).length;
    const rs = closed.map(tradeR).filter((r) => r != null);
    return {
      start, realized, balance: acc.balance, inTrades: acc.inTrades, available: acc.available, uncounted: acc.uncounted, closed, wins,
      open: state.trades.filter((t) => t.exit_price == null),
      winRate: closed.length ? (wins / closed.length) * 100 : null,
      avgR: rs.length ? rs.reduce((s, r) => s + r, 0) / rs.length : null,
      noStop: state.trades.filter((t) => t.stop_loss == null).length,
    };
  }

  function viewPractice() {
    const st = practiceStats();
    const active = activeAssets();
    const first = active[0];
    const setNum = (k) => esc(setting(k));
    const stat = (v, l, sub = "", cls = "") => `<div class="card stat"><div class="stat-v ${cls}">${v}</div><div class="stat-l">${l}</div>${sub ? `<div class="xs muted">${sub}</div>` : ""}</div>`;
    return `
      <section>
        <div class="sec-head">
          <div><h2>Practice trades</h2>
            <p class="muted">Fake money only. Use it once you reach phase 4: decide your stop before you enter, and risk no more than 1–2% of the balance per trade.</p></div>
          <button type="button" class="btn ghost sm" data-action="trades-csv">⬇ Export trades</button>
        </div>
        <div class="prac-top">
          <div class="stats">
            ${stat(fmtMoney(st.balance), "balance", `cash after closed trades · started at ${fmtMoney(st.start)}`)}
            <div class="card stat" id="inTradesCard">${inTradesInner()}</div>
            <div class="card stat" id="availCard">${availInner()}</div>
            ${stat(fmtMoney(st.realized), "profit / loss", `${fmtPct((st.realized / st.start) * 100)} overall, net in USD`, sign(st.realized))}
            ${stat(st.closed.length ? Math.round(st.winRate) + "%" : "—", "win rate", `${st.wins} of ${st.closed.length} closed trades`)}
            ${stat(st.avgR == null ? "—" : (st.avgR > 0 ? "+" : "") + st.avgR.toFixed(2) + "R", "average result in R", "R = what you risked. +2R means you made twice your risk.", st.avgR == null ? "" : sign(st.avgR))}
            ${stat(st.open.length, "open trades", st.noStop ? `${st.noStop} without a stop loss ⚠` : "all have stop losses")}
            <div class="card stat" id="equityCard">${equityInner()}</div>
          </div>
          <aside class="card conv" aria-label="Currency converter">
            <h3>Currency converter</h3>
            <p class="xs muted">How much of the selected asset your money buys. Rates are fetched when you press Convert.</p>
            <div class="row2">
              <label>Amount<input id="convAmt" type="number" step="any" min="0" inputmode="decimal" value="500"></label>
              <label>Currency<input id="convCur" maxlength="3" list="curList" value="${esc(setting("home_currency"))}" style="text-transform:uppercase"><datalist id="curList"></datalist></label>
            </div>
            <div class="row-btns"><button type="button" class="btn sm" data-action="conv-run">Convert</button></div>
            <div id="convOut" class="small conv-out muted">Pick an asset in the trade form, then press Convert.</div>
          </aside>
        </div>

        <form id="tradeForm" class="card form">
          <div class="form-title"><h3>Open a practice trade</h3><button type="button" class="btn ghost xs" data-action="clear-form">Clear form</button></div>
          <div class="row3">
            <label>Asset
              <select name="asset_id" data-input="trade-asset">
                ${groupAssets(active).map(([label, xs]) => `<optgroup label="${esc(label)}">${xs.map((a) => `<option value="${a.id}">${esc(a.symbol)} · ${esc(a.name)}</option>`).join("")}</optgroup>`).join("")}
                <option value="">Other (type symbol)…</option>
              </select>
            </label>
            <label class="trade-other" hidden>Symbol<input name="symbol" maxlength="20" placeholder="e.g. AMZN"></label>
            <label>Date<input type="date" name="opened_on" value="${localDate()}" required></label>
          </div>
          <div id="liveLine" class="small muted live-line"></div>
          <div class="row2">
            <fieldset><legend>Direction</legend>
              <div class="chips">${chip("radio", "side", "long", "Long (betting it goes up)", true)}${chip("radio", "side", "short", "Short (betting it goes down)")}</div>
            </fieldset>
            <fieldset><legend>Mode</legend>
              <div class="chips">${chip("radio", "mode", "spot", "Spot (own it)", true)}${chip("radio", "mode", "futures", "Futures (leverage)")}</div>
            </fieldset>
          </div>
          <div class="row3">
            <label class="lev-row" hidden><span class="lbl">Leverage <span class="muted small">1–50×, isolated margin</span></span><input name="leverage" type="number" min="1" max="50" step="1" value="5" inputmode="numeric" data-input="trade-calc"></label>
            <label><span class="lbl">Currency <span class="muted small">prices below are in this</span></span><input name="currency" maxlength="3" list="curList" value="${esc(defaultCurrency(first))}" data-input="trade-cur" style="text-transform:uppercase"></label>
            <label class="fx-row" hidden><span class="lbl">USD per 1 <span id="fxCur"></span> <span class="muted small" id="fxNote"></span></span><input name="fx_est" type="number" min="0" step="any" inputmode="decimal" data-input="trade-calc"></label>
          </div>
          <div class="row2">
            <label>Entry price<input name="entry_price" type="number" step="any" min="0" inputmode="decimal" required data-input="trade-calc"></label>
            <label><span class="lbl">Quantity <span class="muted small">shares or coins</span></span><input name="quantity" type="number" step="any" min="0" inputmode="decimal" required data-input="trade-calc"></label>
          </div>
          <div class="row2">
            <label><span class="lbl">Stop loss <span class="muted small">exit here if wrong</span></span><input name="stop_loss" type="number" step="any" min="0" inputmode="decimal" data-input="trade-calc"></label>
            <label><span class="lbl">Target <span class="muted small">take profit here</span></span><input name="take_profit" type="number" step="any" min="0" inputmode="decimal" data-input="trade-calc"></label>
          </div>
          <div class="row2">
            <label><span class="lbl">Risk % of balance <span class="muted small">for the size helper, not saved</span></span><input name="risk_pct" type="number" step="any" min="0" value="${setNum("risk_pct")}" inputmode="decimal" data-input="trade-calc"></label>
            <div class="small muted fee-note">Fees ${setNum("fee_pct")}% each side · funding ${setNum("funding_pct_8h")}% per 8 h (futures). Change in <a href="#" data-action="tab" data-tab="settings">Settings</a>.</div>
          </div>
          <div id="tradeCalc" class="calc small muted">Fill in entry, quantity and stop to see your risk.</div>
          <div id="ladder" class="ladder-box"></div>
          <div class="row2">
            <label>Setup
              <select name="setup_tag" data-input="tag-help"><option value="">— none —</option>${setupTags().map((g) => `<option value="${esc(g)}">${esc(g)}</option>`).join("")}</select>
              <span class="xs muted tag-help" id="tagHelp"></span>
            </label>
            <label><span class="lbl">From an observation <span class="muted small">optional, recent ones for this asset</span></span>
              <select name="observation_id"><option value="">— none —</option></select>
            </label>
          </div>
          <label>Why are you taking this trade?
            <textarea name="reason" rows="2" data-input="trade-calc" placeholder="e.g. Bounced off support at 100k on rising volume, weekly trend still up"></textarea>
          </label>
          <fieldset class="precheck"><legend>Pre-trade checklist <span class="muted small">only the stop is required; the rest warn</span></legend>
            <ul id="preCheck">
              <li data-ck="stop_set"><span class="tk">○</span><span class="ck-l">Stop loss is set <span class="muted xs">(required)</span><span class="ck-help xs muted"></span></span></li>
              <li data-ck="risk_ok"><span class="tk">○</span><span class="ck-l">Risk is within your ${esc(setting("risk_pct"))}% limit <span class="ck-n muted xs"></span><span class="ck-help xs muted"></span></span></li>
              <li data-ck="rr_ok"><span class="tk">○</span><span class="ck-l">Reward/risk is at least ${S.MIN_RR} <span class="ck-n muted xs"></span><span class="ck-help xs muted"></span></span></li>
              <li data-ck="htf_checked"><label class="ckbox"><input type="checkbox" name="ck_htf"><span class="ck-l">I checked the higher timeframe<span class="ck-help xs muted"></span></span></label></li>
              <li data-ck="liq_map_checked" hidden><label class="ckbox"><input type="checkbox" name="ck_liq"><span class="ck-l">I checked the liquidation map <span class="muted xs">(crypto)</span><span class="ck-help xs muted"></span></span></label></li>
              <li data-ck="reason_written"><span class="tk">○</span><span class="ck-l">I wrote a reason<span class="ck-help xs muted"></span></span></li>
            </ul>
          </fieldset>
          <div class="form-foot"><span></span><button class="btn primary" type="submit">Open trade</button></div>
        </form>

        <h3 class="list-head">Open trades <span class="muted small">(${st.open.length})</span> <span id="notifBox" class="small">${notifHtml()}</span></h3>
        ${st.open.length ? st.open.map(openTradeCard).join("") : `<div class="card empty slim"><p class="muted">No open trades.</p></div>`}

        <h3 class="list-head">Stats <span class="muted small">(closed trades, net USD)</span></h3>
        <div class="card" id="statsCard">${statsInner()}</div>
        <div class="card" id="eqCard">${eqInner()}</div>

        <h3 class="list-head">Closed trades <span class="muted small">(${st.closed.length})</span></h3>
        ${st.closed.length ? st.closed.map(closedTradeCard).join("") : `<div class="card empty slim"><p class="muted">Closed trades and their results show up here.</p></div>`}

        <p class="small muted">Starting practice balance: <b>${fmtMoney(st.start)}</b>. Change it in <a href="#" data-action="tab" data-tab="settings">Settings</a>.</p>
      </section>`;
  }

  const tradeHead = (t, topExtra = "") => {
    const cur = t.currency || "USD", probs = tradeProblems(t);
    return `
    <div class="obs-top">
      <span class="sym">${esc(t.symbol)}</span>
      <span class="tag ${t.side === "long" ? "trend-up" : "trend-down"}">${t.side === "long" ? "Long ↗" : "Short ↘"}</span>
      <span class="small">${fmtNum(t.quantity)} @ ${fmtNum(t.entry_price)}${cur !== "USD" ? " " + esc(cur) : ""}</span>
      ${t.setup_tag ? `<span class="tag soft" title="Setup">${esc(t.setup_tag)}</span>` : ""}
      ${isFutures(t) ? `<span class="tag">${fmtNum(t.leverage)}× futures</span><span class="tag soft" title="Estimate: entry × (1 − 1/leverage + ${MAINT_PCT}% maintenance) for a long, mirrored for a short">liq ≈ ${fmtNum(Math.round(liqPrice(t.side, t.entry_price, t.leverage, t.maintenance_pct != null ? Number(t.maintenance_pct) : MAINT_PCT) * 1e6) / 1e6)}</span>` : ""}
      ${probs.length ? `<span class="tag warn" title="${esc(probs.map((p) => p.msg).join(" "))}">check values</span>` : ""}
      ${topExtra}
      <span class="meta-right"><span class="small muted">${fmtDate(t.opened_on)}${t.closed_on ? ` → ${fmtDate(t.closed_on)}` : ""}</span>
      <button class="icon-btn" data-action="edit-trade" data-id="${t.id}" title="${t.exit_price == null ? "Edit this trade" : "Edit the review"}" aria-label="Edit">✎</button>
      <button class="icon-btn" data-action="dl-item" data-kind="trade" data-id="${t.id}" title="Download this trade (zip)" aria-label="Download">⬇</button>
      <button class="icon-btn" data-action="del-trade" data-id="${t.id}" title="Delete">×</button></span>
    </div>
    <div class="small">Stop <b>${fmtNum(t.stop_loss)}</b> · Target <b>${fmtNum(t.take_profit)}</b>${tradeRisk(t) != null ? ` · Risk ${fmtCur(tradeRisk(t), cur)}` : ` · <span class="neg">no stop loss</span>`}</div>
    ${probs.length ? `<ul class="prob-list small">${probs.map((p) => `<li>${esc(p.msg)}</li>`).join("")}</ul><div class="xs"><button type="button" class="btn xs" data-action="edit-trade" data-id="${t.id}">${t.exit_price == null ? "Fix values" : "Edit review"}</button></div>` : ""}
    ${obsLinkHtml(t)}
    <div data-range="${t.id}">${rangeNote(t)}</div>
    ${t.reason ? `<p class="note">${esc(t.reason)}</p>` : ""}`;
  };
  // lowest / highest live price the app saw while the trade was open
  const rangeNote = (t) => {
    if (t.mae_price == null && t.mfe_price == null) return "";
    const e = T.excursions(t), cur = t.currency || "USD";
    return `<div class="xs muted" title="The app only sees prices while it is open and the page is visible.">Price range seen: worst ${fmtCur(e.mae_price, cur)} (${fmtPct(e.mae_pct)}) · best ${fmtCur(e.mfe_price, cur)} (${fmtPct(e.mfe_pct)}) · only covers time the app was open</div>`;
  };

  function openTradeCard(t) {
    const cur = t.currency || "USD";
    return `
      <article class="card trade ${alertItemsFor(t.id).length ? "alerting" : ""}" data-trade="${t.id}">
        <div class="trade-alert" data-alertline="${t.id}">${alertLineHtml(t.id)}</div>
        ${tradeHead(t, `<label class="pxnow top" data-pxbox="${t.id}" hidden><span class="pxl">Price now (${esc(cur)})</span>
          <input type="number" step="any" min="0" inputmode="decimal" data-input="px-now" data-id="${t.id}" placeholder="type the current price from TradingView to see your P&amp;L" aria-label="Price now, typed from TradingView" value="${state.typed.has(t.id) ? esc(state.typed.get(t.id).price) : ""}">
          <span class="xs muted">for P&amp;L and equity only: never used for alerts, never saved</span></label>`)}
        <div class="live" data-live="${t.id}">${liveHtml(t)}</div>
        ${shotStrip(t.screenshots, "trade", t.id)}
        <details class="close-trade">
          <summary class="small">Close this trade</summary>
          <form class="form closeTradeForm" data-id="${t.id}">
            <div class="row3">
              <label>Exit price${cur !== "USD" ? ` (${esc(cur)})` : ""}<input name="exit_price" type="number" step="any" min="0" inputmode="decimal" required data-input="close-calc"></label>
              <label>Date<input type="date" name="closed_on" value="${localDate()}" required data-input="close-calc"></label>
              <label>Why did you exit?
                <select name="exit_reason"><option value="target">Hit my target</option><option value="stop">Hit my stop loss</option><option value="manual">Changed my mind</option><option value="time">Ran out of time</option></select>
              </label>
            </div>
            <label class="fxrow" hidden><span class="lbl">USD per 1 ${esc(cur)} <span class="muted small">the rate couldn't be fetched, type it</span></span><input name="fx_to_usd" type="number" step="any" min="0" inputmode="decimal"></label>
            <div class="calc small muted closeCalc">Type the exit price to see fees and the net result.</div>
            <fieldset><legend>How did you feel?</legend>
              <div class="chips">${EMOTIONS.map((e) => chip("radio", "emotion", e, e)).join("")}</div>
            </fieldset>
            ${reviewFields(null)}
            <label>What did you learn?<textarea name="lessons" rows="2"></textarea></label>
            <div class="form-foot"><span></span><button class="btn primary" type="submit">Close trade</button></div>
          </form>
        </details>
      </article>`;
  }

  function closedTradeCard(t) {
    const cur = t.currency || "USD", netL = tradeNetLocal(t), netU = tradeNetUsd(t), r = tradeR(t), gross = tradePnl(t);
    const pct = ((t.side === "short" ? t.entry_price - t.exit_price : t.exit_price - t.entry_price) / t.entry_price) * 100;
    const why = { target: "hit target", stop: "hit stop", manual: "closed early", time: "ran out of time" }[t.exit_reason] || "";
    const fees = tradeFees(t), fund = t.funding_est != null ? Number(t.funding_est) : fundingEstimate(t), m = tradeMargin(t);
    const showBreak = t.fee_pct != null || isFutures(t);
    return `
      <article class="card trade closed">
        ${tradeHead(t)}
        <div class="result">
          <span class="big ${sign(netU)}">${fmtMoney(netU)}</span>
          ${cur !== "USD" ? `<span class="small">${fmtCur(netL, cur)} ≈ ${fmtMoney(netU)}</span>` : ""}
          <span class="${sign(pct)}" title="price move, before fees">${fmtPct(pct)}</span>
          ${r != null ? `<span class="tag ${sign(r) === "pos" ? "right" : sign(r) === "neg" ? "wrong" : ""}">${r > 0 ? "+" : ""}${r.toFixed(2)}R</span>` : ""}
          <span class="small muted">exit ${fmtNum(t.exit_price)}${why ? ` · ${why}` : ""}${t.emotion ? ` · felt ${esc(t.emotion)}` : ""}</span>
        </div>
        ${showBreak ? `<div class="xs muted">Gross ${fmtCur(gross, cur)}${m != null && gross < -m ? ` (loss capped at the ${fmtCur(m, cur)} margin)` : ""} · fees −${fmtCur(fees, cur)} · ${isFutures(t) ? `funding −${fmtCur(fund, cur)} (estimate, assumes you pay)` : "no funding (spot)"} · <b>net ${fmtCur(netL, cur)}</b>${cur !== "USD" && t.fx_to_usd != null ? ` · rate ${fmtNum(t.fx_to_usd)} USD per ${esc(cur)}` : ""}</div>` : (cur !== "USD" ? `<div class="xs muted">rate ${fmtNum(t.fx_to_usd)} USD per ${esc(cur)}</div>` : "")}
        ${reviewLine(t)}
        ${t.lessons ? `<p class="note small">💡 ${esc(t.lessons)}</p>` : ""}
        ${shotStrip(t.screenshots, "trade", t.id)}
      </article>`;
  }

  // ---------- trade form: live helper text, size calculator, fees, liquidation ----------
  const fxUsd = (f, cur) => {   // USD per 1 unit of the trade currency: 1 for USD, else the (fetched or typed) rate in the form, or null
    if (!cur || cur === "USD") return 1;
    const v = f.elements.fx_est && f.elements.fx_est.value; const n = v === "" || v == null ? null : Number(v);
    return n > 0 ? n : null;
  };
  function updateTradeCalc() {
    const f = $("#tradeForm"); const out = $("#tradeCalc"); if (!f || !out) return;
    const n = (k) => { const v = f.elements[k] && f.elements[k].value; return v === "" || v == null ? null : Number(v); };
    const entry = n("entry_price"), qty = n("quantity"), stop = n("stop_loss"), tgt = n("take_profit");
    const side = (f.querySelector("[name=side]:checked") || {}).value || "long";
    const mode = (f.querySelector("[name=mode]:checked") || {}).value || "spot";
    const lev = mode === "futures" ? n("leverage") : null;
    const cur = (f.elements.currency.value || "USD").toUpperCase();
    const fee = Number(setting("fee_pct")) || 0, fund = Number(setting("funding_pct_8h")) || 0, riskPct = n("risk_pct");
    const fx = fxUsd(f, cur);
    const bal = practiceStats().balance;
    const C = (v) => fmtCur(v, cur);
    const parts = []; let warn = false;
    updateLadder(f); updateChecklist(f); updateTagHelp(f);
    const m0 = formMetrics(f);
    const riskLimit = Number(setting("risk_pct"));
    const sideOk = stop != null && entry > 0 && (side === "long" ? stop < entry : stop > entry);
    // position-size helper: needs entry + a stop on the right side
    if (entry > 0 && sideOk && riskPct > 0) {
      if (fx == null) parts.push(`<span class="muted">Size helper needs the ${esc(cur)}→USD rate (couldn't fetch it: type it in the rate box).</span>`);
      else {
        // risk-based size, never more than the available cash can buy (entry fee included)
        const sg = T.suggestQty({ balance: bal / fx, riskPct, entry, stop, feePct: fee, available: practiceStats().available / fx, lev });   // balance and cash in the trade currency
        if (sg) {
          const dp = m0.asset && isCrypto(m0.asset) ? 6 : 4, q = sg.qty == null ? null : floorTo(sg.qty, dp), rq = floorTo(sg.riskQty, dp);
          if (q == null) parts.push(`<b>Size helper:</b> no available cash (balance ${fmtMoney(bal)}, available ${fmtMoney(practiceStats().available)}). Risk alone would suggest ${fmtNum(rq)}, but you can't buy any. Close a trade first.`);
          else parts.push(`<b>Size helper:</b> risking ${riskPct}% of ${fmtMoney(bal)} = ${C(sg.riskAmt)} (stop distance + round-trip fees) → quantity <b>${fmtNum(q)}</b>${sg.capped ? ` <b class="neg">capped by available cash</b> <span class="muted">(risk alone would be ${fmtNum(rq)}; available ${fmtMoney(practiceStats().available)})</span>` : ""} <button type="button" class="btn xs" data-action="use-qty" data-qty="${q}">Use this quantity</button>`);
        }
      }
    }
    // futures: the liquidation estimate needs only entry and leverage (margin per unit until a quantity is typed)
    if (lev >= 1 && entry > 0) {
      const liq = liqPrice(side, entry, lev);
      const beyond = stop != null && (side === "long" ? stop <= liq : stop >= liq);
      parts.push(`Liquidation ≈ <b class="${beyond ? "neg" : ""}">${fmtNum(Math.round(liq * 1e6) / 1e6)}</b> <span class="muted">(estimate: ${MAINT_PCT}% maintenance margin, isolated)</span>${qty > 0 ? "" : ` · margin per 1 unit <b>${C(entry / lev)}</b> <span class="muted">(entry ÷ leverage; type a quantity for the total)</span>`}${beyond ? `<br><b class="neg">Your stop is beyond the liquidation price: you'd be liquidated before your stop.</b>` : ""}`);
      if (beyond) warn = true;
    }
    if (entry > 0 && qty > 0) {
      const notional = entry * qty, margin = lev ? notional / lev : null;
      const need = margin != null ? margin : notional;      // what has to fit in the balance: margin for futures, full value for spot
      parts.push(`Position value <b>${C(notional)}</b>${margin != null ? ` · margin at ${fmtNum(lev)}× <b>${C(margin)}</b>` : ""}${fx != null && cur !== "USD" ? ` ≈ ${fmtMoney(need * fx)}` : ""}${fx != null ? ` (${((need * fx / bal) * 100).toFixed(1)}% of balance${margin != null ? " as margin" : ""})` : ""}`);
      const f1 = (fee / 100) * notional;
      parts.push(`Fees ${fee}%: entry ≈ ${C(f1)}, round trip ≈ ${C(f1 * 2)}${mode === "futures" ? ` · funding ≈ ${C((fund / 100) * notional * 3)} per day <span class="muted">(estimate, assumes you pay)</span>` : ""}`);
      if (stop != null) {
        if (!sideOk) { parts.push(`<b class="neg">Stop is on the wrong side of entry for a ${side}</b>`); warn = true; }
        else {
          const per = Math.abs(entry - stop) + (fee / 100) * (entry + stop), risk = per * qty;
          const riskUsdPct = fx != null ? ((risk * fx) / bal) * 100 : null;
          parts.push(`Risk <b>${C(risk)}</b> incl. fees${riskUsdPct != null ? ` = <b class="${riskUsdPct > riskLimit ? "neg" : ""}">${riskUsdPct.toFixed(2)}%</b> of balance${riskUsdPct > riskLimit ? ` (over your ${riskLimit}% limit)` : ""}` : ""}`);
          if (riskUsdPct != null && riskUsdPct > riskLimit) warn = true;
          if (tgt != null) {
            const reward = Math.abs(tgt - entry) * qty, rr = reward / (Math.abs(entry - stop) * qty);
            parts.push(`Reward ${C(reward)} · reward/risk <b class="${rr < S.MIN_RR ? "neg" : "pos"}">${rr.toFixed(2)} : 1</b>${rr < S.MIN_RR ? ` (aim for ${S.MIN_RR} or more)` : ""}`);
          }
        }
      } else { parts.push(`<b class="neg">No stop loss yet</b>`); warn = true; }
    }
    if (!parts.length) { out.className = "calc small muted"; out.innerHTML = "Fill in entry, quantity and stop to see your risk."; return; }
    out.className = "calc small " + (warn ? "warn" : "okbox");
    out.innerHTML = parts.join("<br>");
  }

  // ---------- phase 5b: setup tags, checklist, price ladder, observation link ----------
  const DEFAULT_TAGS = ["breakout", "pullback", "range", "reversal", "news", "other"];
  const setupTags = () => (state.settings.setup_tags && state.settings.setup_tags.length ? state.settings.setup_tags : DEFAULT_TAGS);
  const r6 = (v) => Math.round(v * 1e6) / 1e6;

  // Everything the trade form currently says, worked out once (used by the ladder, the checklist and Open trade)
  function formMetrics(f) {
    const n = (k) => { const v = f.elements[k] && f.elements[k].value; return v === "" || v == null ? null : Number(v); };
    const entry = n("entry_price"), qty = n("quantity"), stop = n("stop_loss"), tgt = n("take_profit");
    const side = (f.querySelector("[name=side]:checked") || {}).value || "long";
    const mode = (f.querySelector("[name=mode]:checked") || {}).value || "spot";
    const lev = mode === "futures" ? n("leverage") : null;
    const cur = (f.elements.currency.value || "USD").toUpperCase();
    const fx = fxUsd(f, cur), bal = practiceStats().balance, fee = Number(setting("fee_pct")) || 0;
    const asset = assetById(f.elements.asset_id.value);
    const stopSide = stop != null && entry > 0 && (side === "long" ? stop < entry : stop > entry);
    const tgtSide = tgt != null && entry > 0 && (side === "long" ? tgt > entry : tgt < entry);
    let risk = null, riskPct = null, rr = null;
    if (stopSide && qty > 0) { risk = (Math.abs(entry - stop) + (fee / 100) * (entry + stop)) * qty; if (fx != null) riskPct = ((risk * fx) / bal) * 100; }
    if (stopSide && tgtSide) rr = Math.abs(tgt - entry) / Math.abs(entry - stop);
    return { entry, qty, stop, tgt, side, mode, lev, cur, fx, bal, asset, crypto: !!asset && isCrypto(asset), liq: lev >= 1 && entry > 0 ? liqPrice(side, entry, lev) : null, risk, riskPct, rr };
  }
  const checkInput = (f, m) => ({ stop: m.stop, riskPct: m.riskPct, riskLimit: Number(setting("risk_pct")), rr: m.rr, htf: f.elements.ck_htf.checked, liqMap: m.crypto ? f.elements.ck_liq.checked : null, reason: f.elements.reason.value });

  const ckPrice = (v, up) => (v >= 1 ? (up ? Math.ceil(v * 100 - 1e-9) : Math.floor(v * 100 + 1e-9)) / 100 : (up ? Math.ceil(v * 1e6 - 1e-9) : Math.floor(v * 1e6 + 1e-9)) / 1e6);   // round the way that still satisfies the rule
  function updateChecklist(f) {
    const ul = $("#preCheck"); if (!ul) return;
    const m = formMetrics(f);
    ul.querySelector("[data-ck=liq_map_checked]").hidden = !m.crypto;
    const c = S.checklist(checkInput(f, m));
    const long = m.side !== "short", limit = Number(setting("risk_pct")), fee = Number(setting("fee_pct")) || 0;
    const sideOk = m.stop != null && m.entry > 0 && (long ? m.stop < m.entry : m.stop > m.entry);
    // short "how to satisfy it" lines, shown only for items that aren't ticked yet
    const help = {
      stop_set: "Type the price where you'd admit you're wrong into Stop loss (below your entry for a long, above it for a short).",
      risk_ok: !(m.entry > 0 && m.qty > 0) || !sideOk ? "Fill in entry, quantity and a stop on the correct side, then I can work out your risk."
        : m.riskPct == null ? "Needs the currency rate (type it in the rate box)."
        : (() => { const ps = positionSize(m.bal / m.fx, limit, m.entry, m.stop, fee); const dp = m.asset && isCrypto(m.asset) ? 6 : 4; return `You are risking ${m.riskPct.toFixed(2)}% of your balance and your limit is ${limit}%. Lower the quantity to ${ps ? fmtNum(floorTo(ps.qty, dp)) : "less"} or tighten your stop.`; })(),
      rr_ok: !sideOk ? "Set a stop on the correct side of your entry first; then I can show the target you need."
        : `${m.rr != null ? `Reward/risk is ${m.rr.toFixed(2)} now. ` : ""}Set target ${long ? "≥" : "≤"} ${fmtNum(ckPrice(T.targetForRR(m.side, m.entry, m.stop, S.MIN_RR), long))} to make it ${S.MIN_RR}.`,
      htf_checked: "Open the daily or weekly chart. Is the bigger trend up, down or sideways? Tick this once you've looked.",
      liq_map_checked: m.asset ? `<a href="${esc(coinglassUrl(m.asset))}" target="_blank" rel="noopener">Open ${esc(m.asset.symbol)} on Coinglass ↗</a> and look for big clusters of liquidations near your entry and stop. Tick once you've looked.` : "",
      reason_written: "Write one sentence: what do you see, and why now?",
    };
    for (const it of c.items) {
      const li = ul.querySelector(`[data-ck=${it.key}]`); if (!li) continue;
      li.classList.toggle("ok", it.ok); li.classList.toggle("bad", !it.ok && !!it.required);
      const tk = li.querySelector(".tk"); if (tk) tk.textContent = it.ok ? "✓" : "○";
      const h = li.querySelector(".ck-help"); if (h) h.innerHTML = it.ok ? "" : help[it.key] || "";
    }
    const note = (key, txt) => { const e = ul.querySelector(`[data-ck=${key}] .ck-n`); if (e) e.textContent = txt; };
    note("risk_ok", m.riskPct != null ? `now ${m.riskPct.toFixed(2)}%` : "");
    note("rr_ok", m.rr != null ? `now ${m.rr.toFixed(2)} : 1` : "");
  }
  function updateTagHelp(f) { const h = $("#tagHelp"); if (h && f.elements.setup_tag) h.textContent = tagNote(f.elements.setup_tag.value); }

  function updateLadder(f) {
    const el = $("#ladder"); if (!el) return;
    const m = formMetrics(f);
    const L = S.ladder(m.side, m.entry, m.liq, m.stop, m.tgt);
    if (!L) { el.innerHTML = `<p class="muted xs">Type an entry price to see the price ladder (liquidation, stop, entry, target).</p>`; return; }
    const names = { liq: "Liquidation (est.)", stop: "Stop", entry: "Entry", target: "Target" };
    const msg = L.state === "bad" ? `Your stop is beyond the liquidation price: you'd be liquidated before your stop.` : L.state === "warn" ? `Your stop is within 1% of the liquidation price.` : "";
    el.innerHTML = `<div class="ladder ${L.state}" role="img" aria-label="Price ladder, highest price first: ${L.rungs.map((r) => names[r.key] + " " + r6(r.price)).join(", ")}">
        ${L.rungs.map((r) => `<div class="rung rg-${r.key}"><span class="rn">${names[r.key]}</span><span class="rp">${fmtNum(r6(r.price))}</span><span class="rd">${r.key === "entry" ? "entry" : fmtPct(r.pct)}</span></div>`).join("")}
      </div>${msg ? `<p class="xs ladder-msg ${L.state}">${msg}</p>` : ""}`;
  }

  // The last 10 observations of the chosen asset (newest first)
  function fillObsPicker(f) {
    const sel = f && f.elements.observation_id; if (!sel) return;
    const aid = f.elements.asset_id.value, keep = sel.value || sel.dataset.want || ""; delete sel.dataset.want;
    const list = aid ? state.obs.filter((o) => o.asset_id === aid).sort((a, b) => (a.observed_on < b.observed_on ? 1 : a.observed_on > b.observed_on ? -1 : 0)).slice(0, 10) : [];
    sel.innerHTML = `<option value="">— none —</option>` + list.map((o) => `<option value="${o.id}">${esc(fmtDate(o.observed_on))}${o.trend ? " · " + esc(o.trend) : ""}${o.price != null ? " · " + fmtNum(o.price) : ""}${o.prediction ? " · guess " + esc(o.prediction) : ""}</option>`).join("");
    sel.disabled = !aid; if (!aid) sel.options[0].textContent = "— pick a watchlist asset —";
    if (list.some((o) => o.id === keep)) sel.value = keep;
  }

  const CK_KEYS = ["stop_set", "risk_ok", "rr_ok", "htf_checked", "liq_map_checked", "reason_written"];
  const CK_NAMES = { stop_set: "stop set", risk_ok: "risk within limit", rr_ok: "reward/risk", htf_checked: "higher timeframe", liq_map_checked: "liquidation map", reason_written: "reason" };
  function obsLinkHtml(t) {
    const bits = [];
    if (t.observation_id) {
      const o = state.obs.find((x) => x.id === t.observation_id);
      bits.push(o ? `<a href="#" data-action="goto-obs" data-id="${o.id}" title="Show this observation in Progress → History">📎 Observation ${esc(fmtDate(o.observed_on))}</a>` : `<span class="muted">📎 linked observation</span>`);
    }
    if (t.checklist && typeof t.checklist === "object") {
      const ks = CK_KEYS.filter((k) => t.checklist[k] != null), ok = ks.filter((k) => t.checklist[k]);
      const miss = ks.filter((k) => !t.checklist[k]).map((k) => CK_NAMES[k]);
      bits.push(`<span class="${miss.length ? "" : "pos"}" title="${esc(miss.length ? "Not ticked at open: " + miss.join(", ") : "All ticked at open")}">Checklist ${ok.length}/${ks.length}${miss.length ? " ⚠" : " ✓"}</span>`);
    }
    const en = editsNote(t); if (en) bits.push(en);
    return bits.length ? `<div class="xs trade-meta">${bits.join(" · ")}</div>` : "";
  }

  // ---------- phase 5b: live unrealised P&L ----------
  const fxRate = (cur) => { if (cur === "USD") return 1; const f = state.live.fx[cur]; return f && f.rate != null && !f.stale ? f.rate : null; };   // USD per 1 unit of cur, or null
  function unrealisedOf(t, px) {   // the same maths as closing at `px` today: fees both sides (exit fee estimated), funding so far, futures loss capped at margin
    const tmp = { ...t, exit_price: px, closed_on: localDate(), funding_est: null };
    return { gross: tradePnl(tmp), net: tradeNetLocal(tmp), fees: tradeFees(tmp), funding: fundingEstimate(tmp), margin: tradeMargin(tmp) };
  }
  // The price used for unrealised P&L: a fresh live price, else (only where there is no price source at all) the one typed on the card
  function livePrice(t) {
    const r = state.live.res.get(t.id), ty = state.typed.get(t.id);
    if (r && r.price != null) return { px: r.price, src: `${r.source}, ${TJ_PRICES.fmtAt(r.at)}`, typed: false };
    if (ty && r && r.none) return { px: ty.price, src: `typed ${TJ_PRICES.fmtAt(ty.at)}`, typed: true };
    return null;
  }
  function liveHtml(t) {
    const cur = t.currency || "USD", r = state.live.res.get(t.id);
    if (!r) return `<span class="muted xs">Checking the live price…</span>`;
    const lp = livePrice(t);
    if (!lp) return `<span class="neg">price unavailable</span> <span class="muted xs">· ${esc(r.reason || "")}</span>`;
    const u = unrealisedOf(t, lp.px), fxr = fxRate(cur);
    const C = (v) => fmtCur(v, cur);
    return `Now <b>${fmtNum(Math.round(lp.px * 1e4) / 1e4)}</b>${cur !== "USD" ? " " + esc(cur) : ""} <span class="muted xs">· ${esc(lp.src)}</span> · unrealised <b class="${sign(u.net)}">${C(u.net)}</b>${cur !== "USD" ? ` <span class="muted">≈ ${fxr != null ? fmtMoney(u.net * fxr) : "$ unavailable (no " + esc(cur) + " rate)"}</span>` : ""}
      <div class="xs muted">gross ${C(u.gross)}${u.margin != null && u.gross < -u.margin ? ` (loss capped at the ${C(u.margin)} margin)` : ""} · ${u.fees > 0 ? `fees −${C(u.fees)} (includes an estimated exit fee)` : "no fees"} ${isFutures(t) ? `· funding so far −${C(u.funding)} (estimate, assumes you pay)` : ""}</div>`;
  }
  function equityInner() {
    const st = practiceStats(), open = st.open;
    const head = (v, sub, cls = "") => `<div class="stat-v ${cls}">${v}</div><div class="stat-l">equity (balance + unrealised)</div><div class="xs ${cls === "warnc" ? "" : "muted"}">${sub}</div>`;
    if (!open.length) return head(fmtMoney(st.balance), "no open trades, so equity = balance", sign(st.balance - st.start));
    let sum = 0, priced = 0, typed = 0, missing = 0;
    for (const t of open) {
      const lp = livePrice(t), fxr = fxRate(t.currency || "USD");
      if (lp && fxr != null) { sum += unrealisedOf(t, lp.px).net * fxr; priced++; if (lp.typed) typed++; } else missing++;
    }
    if (!state.live.at && !priced) return head(fmtMoney(st.balance), "checking prices…", sign(st.balance - st.start));
    if (!priced) return head("—", `no open trade has a price, so equity can't be worked out. Balance is ${fmtMoney(st.balance)}.`);
    // coloured by equity against the starting balance, not by the sign of the unrealised part
    return head(fmtMoney(st.balance + sum), `balance ${fmtMoney(st.balance)} + unrealised ${fmtMoney(sum)} · ${priced} of ${open.length} open trades priced${typed ? ` (${typed} typed by you)` : ""}${missing ? ` · ${missing} without a price, not included` : ""}`, sign(st.balance + sum - st.start));
  }
  // Update the cards in place (never re-render: that would wipe a half-typed form)
  function applyLive() {
    if (state.tab !== "practice") return;
    for (const el of $$("[data-live]")) {
      const t = state.trades.find((x) => x.id === el.dataset.live); if (!t || t.exit_price != null) continue;
      el.innerHTML = liveHtml(t);
      const r = state.live.res.get(t.id), box = $(`[data-pxbox="${t.id}"]`); if (box) box.hidden = !(r && r.none);
    }
    for (const el of $$("[data-range]")) { const t = state.trades.find((x) => x.id === el.dataset.range); if (t && t.exit_price == null) el.innerHTML = rangeNote(t); }
    for (const el of $$("article[data-trade]")) el.classList.toggle("alerting", alertItemsFor(el.dataset.trade).length > 0);
    for (const el of $$("[data-alertline]")) el.innerHTML = alertLineHtml(el.dataset.alertline);
    const eq = $("#equityCard"); if (eq) eq.innerHTML = equityInner();
    const c1 = $("#inTradesCard"); if (c1) c1.innerHTML = inTradesInner();
    const c2 = $("#availCard"); if (c2) c2.innerHTML = availInner();
  }

  let livePoll = null, liveAgain = false, liveTimer = null;
  function pollLive() {
    if (!state.user || !practiceOn()) return Promise.resolve();   // focus mode: no price requests at all
    if (livePoll) { liveAgain = true; return livePoll; }
    livePoll = (async () => {
      const open = state.trades.filter((t) => t.exit_price == null);
      state.live.res.clear();
      if (open.length) {
        const assets = [...new Set(open.map((t) => t.asset_id).filter(Boolean))].map(assetById).filter(Boolean);
        const curs = [...new Set(open.map((t) => t.currency || "USD").filter((c) => c !== "USD"))];
        const [prices, rates] = await Promise.all([TJ_PRICES.getPrices(assets), Promise.all(curs.map(async (c) => [c, await TJ_PRICES.fiatRate(c, "USD")]))]);
        state.live.fx = Object.fromEntries(rates);
        for (const t of open) {
          const a = t.asset_id ? assetById(t.asset_id) : null, p = a ? prices.get(a.id) : null, cur = t.currency || "USD";
          if (!a) { state.live.res.set(t.id, { none: true, reason: "This trade isn't linked to a watchlist asset, so there is no price source." }); continue; }
          if (!p || p.price == null) { state.live.res.set(t.id, { none: !!(p && p.none), reason: p ? p.reason : "No price." }); continue; }
          if (p.stale) { state.live.res.set(t.id, { reason: `${p.reason} Last known ${fmtNum(p.price)} at ${TJ_PRICES.fmtAt(p.at)}.` }); continue; }
          let px = p.price;   // live prices are in USD; a trade in another currency compares in that currency
          if (cur !== "USD") {
            const f = state.live.fx[cur];
            if (!f || f.rate == null || f.stale) { state.live.res.set(t.id, { reason: `No fresh ${cur}→USD rate (${(f && f.reason) || "unavailable"}), so the USD price can't be compared with your ${cur} prices.` }); continue; }
            px = p.price / f.rate;
          }
          state.live.res.set(t.id, { price: px, at: p.at, source: p.source });
          // lowest / highest live price seen while the trade is open (only while the app runs); saved only when a new extreme appears
          const ex = T.updateExcursions(t, px);
          if (ex) {
            Object.assign(t, ex);
            sb.from("trading_paper_trades").update(ex).eq("id", t.id).then(({ error }) => {
              if (error) { console.warn("price range not saved", error); if (!state.exWarned) { state.exWarned = true; toast("Couldn't save the price range seen on an open trade: " + friendly(error), "err"); } }
            });
          }
        }
      }
      state.live.at = Date.now();
      checkAlerts(); applyLive();
    })().catch((e) => console.error(e)).finally(() => { livePoll = null; if (liveAgain) { liveAgain = false; pollLive(); } });
    return livePoll;
  }
  // The next poll is 60 s after the last one finished, on any tab, while the page is visible and there are open trades.
  function liveLoop() {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(async () => {
      if (!practiceOn()) return;   // switched off while waiting: the loop ends
      if (state.user && document.visibilityState === "visible" && state.trades.some((t) => t.exit_price == null)) await pollLive();
      liveLoop();
    }, 60000);
  }

  // Start or stop everything that runs for practice trades (price poller, 60 s loop, alerts, banner). Called after load and when the setting changes.
  function applyPracticeSwitch() {
    clearTimeout(liveTimer);
    if (practiceOn()) { pollLive().then(() => { if (practiceOn()) liveLoop(); }); return; }
    state.alertItems = []; state.fired.clear(); state.live = { at: 0, res: new Map(), fx: {} }; renderBanner();
  }

  // ---------- phase 5b: stop / target / liquidation alerts ----------
  const tradeLevels = (t) => ({ stop: t.stop_loss, target: t.take_profit, liq: isFutures(t) ? liqPrice(t.side, t.entry_price, t.leverage, t.maintenance_pct != null ? Number(t.maintenance_pct) : MAINT_PCT) : null });
  const alertItemsFor = (tradeId) => state.alertItems.filter((x) => x.tradeId === tradeId);
  function alertText(item) {
    const t = state.trades.find((x) => x.id === item.tradeId); if (!t) return "";
    const cur = t.currency || "USD", lv = item.levelValue != null ? item.levelValue : tradeLevels(t)[item.level];   // the level as it was when the alert fired
    const what = { stop: `crossed your stop (${fmtNum(lv)})`, target: `reached your target (${fmtNum(lv)})`, liq: `reached the estimated liquidation price (${fmtNum(r6(lv))})` }[item.level];
    return `${t.symbol} ${t.side}: price ${fmtCur(item.price, cur)} ${what} · ${item.source}, ${TJ_PRICES.fmtAt(item.at)}`;
  }
  const alertLineHtml = (tradeId) => alertItemsFor(tradeId).map((x) => `<div class="alert-line ${x.level}">⚠ ${esc(alertText(x))}</div>`).join("");
  function checkAlerts() {
    if (!practiceOn()) return;
    const open = state.trades.filter((t) => t.exit_price == null), ids = new Set(open.map((t) => t.id));
    state.alertItems = state.alertItems.filter((x) => ids.has(x.tradeId));
    for (const k of [...state.fired]) if (!ids.has(k.split(":")[0])) state.fired.delete(k);
    for (const t of open) {
      const r = state.live.res.get(t.id); if (!r || r.price == null) continue;   // only a fresh live price counts, never a typed one
      const hits = S.levelsHit(t.side, tradeLevels(t), r.price);
      for (const lvl of ["stop", "target", "liq"]) {
        const key = `${t.id}:${lvl}`;
        if (hits.includes(lvl)) {
          if (!state.fired.has(key)) {
            state.fired.add(key);
            const item = { key, tradeId: t.id, level: lvl, levelValue: tradeLevels(t)[lvl], price: r.price, at: r.at, source: r.source };
            state.alertItems.push(item); notifyAlert(item);
          } else { const it = state.alertItems.find((x) => x.key === key); if (it) { it.price = r.price; it.at = r.at; it.source = r.source; } }
        } else state.fired.delete(key);   // price is back on the safe side: arm it again
      }
    }
    renderBanner();
  }
  function dropAlerts(tradeId) { state.alertItems = state.alertItems.filter((x) => x.tradeId !== tradeId); for (const k of [...state.fired]) if (k.startsWith(tradeId + ":")) state.fired.delete(k); renderBanner(); }
  function renderBanner() {
    let host = $("#alertHost");
    if (!host) { host = document.createElement("div"); host.id = "alertHost"; document.body.insertBefore(host, document.body.firstChild); }
    host.innerHTML = state.alertItems.map((x) => {
      const t = state.trades.find((y) => y.id === x.tradeId), flagged = !!t && tradeProblems(t).length > 0;
      return `<div class="alert-item ${x.level}" role="alert"><span>⚠ ${esc(alertText(x))}${flagged ? ` <b>· this trade's values look wrong (see its card), so it can't be closed from here</b>` : ""}</span>
      <span class="alert-btns">${flagged ? `<button type="button" class="btn xs primary" data-akey="${esc(x.key)}" data-aact="fix">Fix values first</button>` : `<button type="button" class="btn xs primary" data-akey="${esc(x.key)}" data-aact="close">Close at this price</button>`}<button type="button" class="btn xs ghost" data-akey="${esc(x.key)}" data-aact="dismiss">Dismiss</button></span></div>`;
    }).join("");
  }
  function notifyAlert(item) {
    if (!practiceOn()) return;
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    try { const t = state.trades.find((x) => x.id === item.tradeId); new Notification(`Chart Journal: ${t.symbol} ${item.level === "liq" ? "liquidation level" : item.level}`, { body: alertText(item), tag: item.key }); } catch { /* some browsers refuse; the banner still shows */ }
  }
  function notifHtml() {
    if (!("Notification" in window)) return `<span class="muted">Browser alerts aren't available here; the in-app banner still works.</span>`;
    const p = Notification.permission;
    if (p === "granted") return `<span class="muted">🔔 Browser alerts on</span>`;
    if (p === "denied") return `<span class="muted">Browser alerts are blocked in your browser settings; the in-app banner still works.</span>`;
    return `<button type="button" class="btn xs" data-action="notif-enable">Enable browser alerts</button>`;
  }
  async function alertClose(key) {
    const item = state.alertItems.find((x) => x.key === key);
    const t = item && state.trades.find((x) => x.id === item.tradeId && x.exit_price == null);
    if (!t) { state.alertItems = state.alertItems.filter((x) => x.key !== key); renderBanner(); return; }
    if (tradeProblems(t).length) { openEditTrade(t.id); return; }   // a flagged trade never gets a one-click close
    const cur = t.currency || "USD", today = localDate();
    const net = tradeNetLocal({ ...t, exit_price: item.price, closed_on: today, funding_est: null });
    const go = await appDialog({ title: `Close ${t.symbol} at this price?`,
      body: `<p>Close the ${esc(t.side)} at <b>${fmtCur(item.price, cur)}</b> (${esc(item.source)}, ${TJ_PRICES.fmtAt(item.at)}). Net result ≈ <b>${fmtCur(net, cur)}</b> after fees${isFutures(t) ? " and estimated funding" : ""}.</p><p class="muted">It closes as of today. Nothing closes unless you press the button.</p>`,
      buttons: [{ label: "Go back", value: false }, { label: "Close trade", primary: true, value: true }] });
    if (!go) return;
    const rf = await resolveCloseFx(cur, today, 0);
    if (rf.error) { await appDialog({ title: "Can't close from here", body: `<p>${esc(rf.error)}</p><p class="muted">Close it from the trade card instead, where you can type the rate.</p>`, buttons: [{ label: "OK", primary: true, value: true }] }); return; }
    try { await commitClose(t, { exit_price: item.price, closed_on: today, exit_reason: item.level === "stop" ? "stop" : item.level === "target" ? "target" : "manual", emotion: null, lessons: null, followed_plan: null, mistakes: [], rating: null }, rf.fx); }
    catch (e) { fail(e); }
  }

  // ---------- phase 5b: stats panel and equity curve ----------
  const tradeMatchesAsset = (t, id) => { const a = assetById(id); return !!a && tradeMatches(t, a); };
  const statRows = (trades) => X.netRows(trades);   // net USD rows (shared with the exports so the numbers always agree)
  function statsFiltered() {
    const f = state.stats;
    return state.trades.filter((t) => t.exit_price != null)
      .filter((t) => f.asset === "all" || tradeMatchesAsset(t, f.asset))
      .filter((t) => f.tag === "all" || (f.tag === "__none" ? !t.setup_tag : t.setup_tag === f.tag))
      .filter((t) => (!f.from || (t.closed_on || "") >= f.from) && (!f.to || (t.closed_on || "") <= f.to));
  }
  function statsInner() {
    const f = state.stats, closedAll = state.trades.filter((t) => t.exit_price != null);
    const symbols = [...new Set(closedAll.map((t) => (t.asset_id && assetById(t.asset_id) ? t.asset_id : null)).filter(Boolean))];
    const tags = [...new Set([...setupTags(), ...closedAll.map((t) => t.setup_tag).filter(Boolean)])];
    const filters = `<div class="stat-filters">
      <label>Asset<select data-change="stats-filter" data-k="asset"><option value="all">All assets</option>${symbols.map((id) => `<option value="${id}" ${f.asset === id ? "selected" : ""}>${esc(assetById(id).symbol)}</option>`).join("")}</select></label>
      <label>Setup<select data-change="stats-filter" data-k="tag"><option value="all">All setups</option>${tags.map((g) => `<option value="${esc(g)}" ${f.tag === g ? "selected" : ""}>${esc(g)}</option>`).join("")}<option value="__none" ${f.tag === "__none" ? "selected" : ""}>(no setup)</option></select></label>
      <label>Closed from<input type="date" data-change="stats-filter" data-k="from" value="${esc(f.from)}"></label>
      <label>to<input type="date" data-change="stats-filter" data-k="to" value="${esc(f.to)}"></label>
      <button type="button" class="btn xs ghost" data-action="stats-clear">Clear filters</button></div>`;
    const rows = statRows(statsFiltered());
    if (!rows.length) return `${filters}<p class="muted small">${closedAll.length ? "No closed trades match these filters." : "Stats appear after your first closed trade."}</p>`;
    const s = S.computeStats(rows);
    const m = (v, l, sub = "", cls = "") => `<div class="mini"><div class="mv ${cls}">${v}</div><div class="ml">${l}</div>${sub ? `<div class="xs muted">${sub}</div>` : ""}</div>`;
    const pf = s.profitFactor == null ? (s.wins ? "no losses" : "—") : s.profitFactor.toFixed(2);
    return `${filters}
      <div class="mini-grid">
        ${m(s.n, "closed trades", s.breakeven ? `${s.breakeven} breakeven` : "")}
        ${m(Math.round(s.winRate) + "%", "win rate", `${s.wins} wins · ${s.losses} losses`)}
        ${m(s.avgWin == null ? "—" : fmtMoney(s.avgWin), "average win", "", s.avgWin == null ? "" : "pos")}
        ${m(s.avgLoss == null ? "—" : fmtMoney(s.avgLoss), "average loss", "", s.avgLoss == null ? "" : "neg")}
        ${m(fmtMoney(s.expectancy), "expectancy", "average net per trade", sign(s.expectancy))}
        ${m(s.avgR == null ? "—" : (s.avgR > 0 ? "+" : "") + s.avgR.toFixed(2) + "R", "average R", "", s.avgR == null ? "" : sign(s.avgR))}
        ${m(pf, "profit factor", "total wins ÷ total losses")}
        ${m(fmtMoney(s.best.net), "best trade", esc(s.best.label), "pos")}
        ${m(fmtMoney(s.worst.net), "worst trade", esc(s.worst.label), s.worst.net < 0 ? "neg" : "")}
        ${m(s.maxLosingStreak, "largest losing streak", "trades in a row")}
        ${m(fmtMoney(s.fees), "total fees paid", "both sides, in USD")}
        ${m(fmtMoney(s.funding), "total funding (est.)", "estimate, futures only")}
      </div>
      <h4>Win rate by plan followed</h4>
      <table class="tagtbl"><thead><tr><th>Plan</th><th>Trades</th><th>Win rate</th><th>Net</th></tr></thead><tbody>
        ${s.byPlan.filter((g) => g.n).map((g) => `<tr><td>${g.label}</td><td>${g.n}</td><td>${Math.round(g.winRate)}% <span class="muted xs">(${g.wins} of ${g.n})</span></td><td class="${sign(g.net)}">${fmtMoney(g.net)}</td></tr>`).join("") || `<tr><td colspan="4" class="muted">Tick "Did you follow your plan?" when you close a trade to fill this in.</td></tr>`}
      </tbody></table>
      <h4>Win rate by setup</h4>
      <table class="tagtbl"><thead><tr><th>Setup</th><th>Trades</th><th>Win rate</th><th>Net</th></tr></thead><tbody>
        ${s.byTag.map((g) => `<tr><td>${g.tag ? esc(g.tag) : "<span class='muted'>(no setup)</span>"}</td><td>${g.n}</td><td>${Math.round(g.winRate)}% <span class="muted xs">(${g.wins} of ${g.n})</span></td><td class="${sign(g.net)}">${fmtMoney(g.net)}</td></tr>`).join("")}
      </tbody></table>`;
  }

  const EQ = { W: 640, H: 240, L: 62, R: 14, T: 14, B: 28 };
  function eqInner() {
    const st = practiceStats(), E = S.equitySeries(st.start, statRows(st.closed));
    state.eqPts = [];
    if (E.points.length < 2) return `<h3>Equity curve</h3><p class="muted small">The balance after each closed trade shows up here, with your starting balance (${fmtMoney(st.start)}) as a dashed line.</p>`;
    const vals = E.points.map((p) => p.balance).concat(st.start);
    const dataLo = Math.min(...vals), dataHi = Math.max(...vals);
    let lo = dataLo, hi = dataHi; if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
    const padY = (hi - lo) * 0.08; lo -= padY; hi += padY;
    const X = (i) => EQ.L + (E.points.length === 1 ? 0 : (i / (E.points.length - 1)) * (EQ.W - EQ.L - EQ.R)), Y = (v) => EQ.T + (1 - (v - lo) / (hi - lo)) * (EQ.H - EQ.T - EQ.B);
    state.eqPts = E.points.map((p) => ({ ...p, x: X(p.i), y: Y(p.balance) }));
    const path = state.eqPts.map((p, k) => `${k ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
    const dd = E.drawdown, first = E.points[1].date, last = E.points[E.points.length - 1].date;
    return `<h3>Equity curve <span class="muted small">balance after each closed trade, whole account (ignores the filters above)</span></h3>
      <div class="eq-wrap"><svg class="eqsvg" viewBox="0 0 ${EQ.W} ${EQ.H}" role="img" aria-label="Equity curve: starts at ${fmtMoney(st.start)}, ends at ${fmtMoney(E.final)} after ${E.points.length - 1} closed trades">
          <line class="eq-start" x1="${EQ.L}" x2="${EQ.W - EQ.R}" y1="${Y(st.start).toFixed(1)}" y2="${Y(st.start).toFixed(1)}"/>
          <text class="eq-t" x="${EQ.L - 6}" y="${(Y(st.start) + 4).toFixed(1)}" text-anchor="end">${esc(fmtMoney(st.start))}</text>
          <text class="eq-t" x="${EQ.W - EQ.R}" y="${(Y(st.start) - 5).toFixed(1)}" text-anchor="end">start balance</text>
          ${dataHi - st.start > 1e-9 ? `<text class="eq-t" x="${EQ.L - 6}" y="${(Y(dataHi) + 4).toFixed(1)}" text-anchor="end">${esc(fmtMoney(dataHi))}</text>` : ""}
          ${st.start - dataLo > 1e-9 ? `<text class="eq-t" x="${EQ.L - 6}" y="${(Y(dataLo) + 4).toFixed(1)}" text-anchor="end">${esc(fmtMoney(dataLo))}</text>` : ""}
          <text class="eq-t" x="${EQ.L}" y="${EQ.H - 8}">${esc(first ? fmtDate(first, { month: "short", day: "numeric" }) : "")}</text>
          <text class="eq-t" x="${EQ.W - EQ.R}" y="${EQ.H - 8}" text-anchor="end">${esc(last ? fmtDate(last, { month: "short", day: "numeric" }) : "")}</text>
          <path class="eq-line" d="${path}" fill="none"/>
          ${state.eqPts.map((p) => `<circle class="eq-pt ${p.net > 0 ? "up" : p.net < 0 ? "down" : ""}" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3"/>`).join("")}
          <line id="eqLine" class="eq-hover" y1="${EQ.T}" y2="${EQ.H - EQ.B}" x1="0" x2="0" style="display:none"/>
          <circle id="eqDot" class="eq-dot" r="5" style="display:none"/>
        </svg><div id="eqTip" class="eq-tip" hidden></div></div>
      <p class="small">${dd.abs > 0 ? `Max drawdown <b class="neg">${fmtMoney(dd.abs)}</b> (${dd.pct.toFixed(2)}% of the peak) · peak ${fmtMoney(dd.peak)} → trough ${fmtMoney(dd.trough)}` : "Max drawdown: none yet (the balance has never fallen from a peak)."}</p>`;
  }
  function eqHover(ev, wrap) {
    const svg = wrap.querySelector("svg"), pts = state.eqPts; if (!svg || !pts || !pts.length) return;
    const r = svg.getBoundingClientRect(), x = ((ev.clientX - r.left) / r.width) * EQ.W;
    const p = pts.reduce((a, b) => (Math.abs(b.x - x) < Math.abs(a.x - x) ? b : a));
    const line = $("#eqLine"), dot = $("#eqDot"), tip = $("#eqTip");
    line.setAttribute("x1", p.x); line.setAttribute("x2", p.x); line.style.display = "";
    dot.setAttribute("cx", p.x); dot.setAttribute("cy", p.y); dot.style.display = "";
    tip.hidden = false;
    tip.innerHTML = p.i === 0 ? `<b>Start</b><br>${fmtMoney(p.balance)}` : `<b>${esc(fmtDate(p.date))}</b><br>${esc(p.label)}<br>${fmtMoney(p.net)} → balance <b>${fmtMoney(p.balance)}</b>`;
    const leftPct = (p.x / EQ.W) * 100; tip.style.left = leftPct > 60 ? "auto" : leftPct + "%"; tip.style.right = leftPct > 60 ? 100 - leftPct + "%" : "auto"; tip.style.top = (p.y / EQ.H) * 100 + "%";
  }
  function eqLeave() { for (const id of ["eqLine", "eqDot"]) { const e = $("#" + id); if (e) e.style.display = "none"; } const t = $("#eqTip"); if (t) t.hidden = true; }

  // ---------- phase 5c: setup tag help, mistakes list, review fields, account cards ----------
  const DEFAULT_TAG_NOTES = {
    breakout: "price breaks through a level it kept failing at", pullback: "a dip back to support inside an uptrend",
    range: "buying near support, selling near resistance in a sideways market", reversal: "betting a trend is turning", news: "trading an event", other: "",
  };
  // your own description (Settings) wins, even an empty one; otherwise the default for the built-in tags
  const tagNote = (g) => { const m = state.settings.setup_tag_notes; return m && Object.prototype.hasOwnProperty.call(m, g) ? m[g] || "" : DEFAULT_TAG_NOTES[g] || ""; };
  const DEFAULT_MISTAKES = ["moved stop", "FOMO entry", "early exit", "late exit", "oversized", "no stop", "revenge trade"];
  const tradeMistakes = () => (state.settings.trade_mistakes && state.settings.trade_mistakes.length ? state.settings.trade_mistakes : DEFAULT_MISTAKES);

  // followed plan / mistakes / rating: on the close form and in the edit dialog (t = the trade being edited, or null)
  const reviewFields = (t) => {
    const mk = t && t.mistakes ? t.mistakes : [], all = [...tradeMistakes(), ...mk.filter((m) => !tradeMistakes().includes(m))];
    return `<fieldset><legend>Did you follow your plan?</legend><div class="chips">${chip("radio", "followed_plan", "yes", "Yes", t && t.followed_plan === true)}${chip("radio", "followed_plan", "no", "No", t && t.followed_plan === false)}</div></fieldset>
      <fieldset><legend>Mistakes <span class="muted small">tick any that apply</span></legend><div class="chips">${all.map((m) => chip("checkbox", "mistakes", m, m, mk.includes(m))).join("")}</div></fieldset>
      <fieldset><legend>Rating <span class="muted small">1 = poor execution, 5 = textbook</span></legend><div class="chips">${[1, 2, 3, 4, 5].map((n) => chip("radio", "rating", String(n), String(n), t && t.rating === n)).join("")}</div></fieldset>`;
  };
  const reviewFromForm = (fd) => ({ followed_plan: fd.get("followed_plan") === "yes" ? true : fd.get("followed_plan") === "no" ? false : null, mistakes: fd.getAll("mistakes").map(String), rating: fd.get("rating") ? Number(fd.get("rating")) : null });
  const reviewLine = (t) => {
    const bits = [];
    if (t.followed_plan != null) bits.push(`<span class="tag ${t.followed_plan ? "right" : "wrong"}">${t.followed_plan ? "followed plan" : "didn't follow plan"}</span>`);
    for (const m of t.mistakes || []) bits.push(`<span class="tag warn">${esc(m)}</span>`);
    if (t.rating != null) bits.push(`<span class="tag soft" title="Your rating of the execution">${"★".repeat(t.rating)}${"☆".repeat(5 - t.rating)}</span>`);
    return bits.length ? `<div class="chips review-line">${bits.join("")}</div>` : "";
  };
  const editsNote = (t) => Array.isArray(t.edits) && t.edits.length
    ? `<span class="muted" title="${esc(t.edits.map((e) => `${e.at.slice(0, 16).replace("T", " ")} UTC: ${e.field} ${JSON.stringify(e.old)} → ${JSON.stringify(e.new)}`).join("\n"))}">✎ edited ${t.edits.length}×</span>` : "";

  const inTradesInner = () => { const st = practiceStats(); return `<div class="stat-v">${fmtMoney(st.inTrades)}</div><div class="stat-l">in trades</div><div class="xs muted">spot: full value · futures: margin${st.uncounted ? ` · ${st.uncounted} open trade${st.uncounted === 1 ? "" : "s"} not counted yet (no currency rate)` : ""}</div>`; };
  const availInner = () => { const st = practiceStats(); return `<div class="stat-v ${st.available < 0 ? "neg" : ""}">${fmtMoney(st.available)}</div><div class="stat-l">available</div><div class="xs muted">balance − in trades</div>`; };

  // ---------- phase 5c: a dialog with a form that validates before it closes ----------
  function formDialog({ title, html, submitLabel = "Save", onSubmit }) {
    return new Promise((resolve) => {
      const back = document.createElement("div"); back.className = "dlg-back";
      back.innerHTML = `<form class="card dlg dlg-wide form" role="dialog" aria-modal="true" aria-label="${esc(title)}"><h3>${esc(title)}</h3><div class="dlg-err small neg" role="alert"></div>${html}
        <div class="form-foot"><button type="button" class="btn ghost" data-cancel>Cancel</button><button type="submit" class="btn primary">${esc(submitLabel)}</button></div></form>`;
      const done = (v) => { back.remove(); document.removeEventListener("keydown", onKey, true); resolve(v); };
      const onKey = (e) => { if (e.key === "Escape" && !$(".dlg-back:last-of-type .dlg:not(.dlg-wide)")) { e.stopPropagation(); done(false); } };
      back.addEventListener("click", (e) => { if (e.target.closest("[data-cancel]")) done(false); });
      const form = back.querySelector("form"), errBox = form.querySelector(".dlg-err");
      form.addEventListener("submit", async (e) => {
        e.preventDefault(); const btn = form.querySelector("[type=submit]"); btn.disabled = true; errBox.textContent = "";
        try {
          const err = await onSubmit(form);
          if (err) { errBox.innerHTML = err.html || ""; if (err.field && form.elements[err.field]) form.elements[err.field].focus(); btn.disabled = false; return; }
          done(true);
        } catch (ex) { console.error(ex); errBox.textContent = friendly(ex); btn.disabled = false; }
      });
      document.addEventListener("keydown", onKey, true); document.body.appendChild(back);
      const first = form.querySelector("input:not([type=hidden]),select,textarea"); if (first) first.focus();
    });
  }

  // ---------- phase 5c: entry typo guard (live price comparison) ----------
  // The entry price compared with the live price in the trade's currency. Returns the warning text, or null (no live price, or the entry is close enough).
  async function typoWarningFor(asset, symbol, cur, entry) {
    if (!asset || !(entry > 0)) return null;
    const r = await TJ_PRICES.getPrice(asset); if (r.price == null || r.stale) return null;
    let px = r.price;
    if (cur !== "USD") { const f = await TJ_PRICES.fiatRate(cur, "USD"); if (f.rate == null || f.stale) return null; px = px / f.rate; }
    return T.entryTypoWarning(symbol, entry, px, (v) => fmtCur(v, cur));
  }
  // An overridable warning for a position bigger than the available cash. `availUsd` is what's free for this trade. true = go ahead.
  async function confirmOverAvailable({ needUsd, availUsd, balance, inTrades, futures, lev, entry, qty, cur }) {
    if (!(needUsd > availUsd + 1e-9)) return true;
    return appDialog({ title: "More than your available cash",
      body: `<p>This ${futures ? `${fmtNum(lev)}× position needs <b>${fmtMoney(needUsd)}</b> of margin` : `position is worth <b>${fmtMoney(needUsd)}</b>`} (entry ${fmtNum(entry)} × ${fmtNum(qty)}${cur !== "USD" ? " " + esc(cur) : ""}), but only <b>${fmtMoney(availUsd)}</b> is available: balance ${fmtMoney(balance)} minus ${fmtMoney(inTrades)} already in other trades.</p><p class="muted">${futures ? "" : "Spot positions can't be bigger than your cash. Switch to futures for leverage, or "}Open it anyway?</p>`,
      buttons: [{ label: "Go back", value: false }, { label: "Open anyway", primary: true, value: true }] });
  }
  const obsOptionsFor = (assetId, keepId) => {
    const list = assetId ? state.obs.filter((o) => o.asset_id === assetId).sort((a, b) => (a.observed_on < b.observed_on ? 1 : a.observed_on > b.observed_on ? -1 : 0)).slice(0, 10) : [];
    const cur = keepId && !list.some((o) => o.id === keepId) ? state.obs.find((o) => o.id === keepId) : null;
    return `<option value="">— none —</option>` + (cur ? [cur] : []).concat(list).map((o) => `<option value="${o.id}" ${o.id === keepId ? "selected" : ""}>${esc(fmtDate(o.observed_on))}${o.trend ? " · " + esc(o.trend) : ""}${o.price != null ? " · " + fmtNum(o.price) : ""}${o.prediction ? " · guess " + esc(o.prediction) : ""}</option>`).join("");
  };

  // ---------- phase 5c: edit a trade ----------
  async function openEditTrade(id) {
    const t = state.trades.find((x) => x.id === id); if (!t) return;
    const closed = t.exit_price != null, cur = t.currency || "USD";
    let html;
    if (!closed) {
      const probs = tradeProblems(t), tags = [...new Set([...setupTags(), ...(t.setup_tag ? [t.setup_tag] : [])])];
      html = `${probs.length ? `<div class="calc warn small"><b>These values need fixing:</b><ul>${probs.map((p) => `<li>${esc(p.msg)}</li>`).join("")}</ul></div>` : ""}
        <p class="muted xs">${esc(t.symbol)} ${esc(t.side)}${isFutures(t) ? ` ${fmtNum(t.leverage)}× futures` : ""} · prices in ${esc(cur)}. Opened ${esc(fmtDate(t.opened_on))}; the date, fees and leverage can't be edited. Every change is logged.</p>
        <div class="row2"><label>Entry price<input name="entry_price" type="number" step="any" min="0" inputmode="decimal" required value="${esc(t.entry_price)}"></label>
          <label>Quantity<input name="quantity" type="number" step="any" min="0" inputmode="decimal" required value="${esc(t.quantity)}"></label></div>
        <div class="row2"><label>Stop loss<input name="stop_loss" type="number" step="any" min="0" inputmode="decimal" value="${esc(t.stop_loss ?? "")}"></label>
          <label>Target<input name="take_profit" type="number" step="any" min="0" inputmode="decimal" value="${esc(t.take_profit ?? "")}"></label></div>
        <div class="row2"><label>Setup<select name="setup_tag"><option value="">— none —</option>${tags.map((g) => `<option value="${esc(g)}" ${g === t.setup_tag ? "selected" : ""}>${esc(g)}</option>`).join("")}</select></label>
          <label>From an observation<select name="observation_id">${obsOptionsFor(t.asset_id, t.observation_id)}</select></label></div>
        <label>Why did you take this trade?<textarea name="reason" rows="2">${esc(t.reason || "")}</textarea></label>`;
    } else {
      html = `<p class="muted xs">${esc(t.symbol)} ${esc(t.side)}, closed ${esc(fmtDate(t.closed_on))}. Prices and dates are locked on a closed trade; you can edit the review. Every change is logged. To fix a wrong price, delete the trade.</p>
        <fieldset><legend>How did you feel?</legend><div class="chips">${EMOTIONS.map((e) => chip("radio", "emotion", e, e, t.emotion === e)).join("")}</div></fieldset>
        ${reviewFields(t)}
        <label>What did you learn?<textarea name="lessons" rows="2">${esc(t.lessons || "")}</textarea></label>`;
    }
    await formDialog({ title: closed ? `Edit review: ${t.symbol}` : `Edit ${t.symbol} trade`, html, submitLabel: "Save changes", onSubmit: async (f) => {
      const fd = new FormData(f), nn = (k) => { const v = fd.get(k); return v === "" || v == null ? null : Number(v); };
      const patch = closed
        ? { emotion: fd.get("emotion") || null, lessons: (fd.get("lessons") || "").toString().trim() || null, ...reviewFromForm(fd) }
        : { entry_price: nn("entry_price"), quantity: nn("quantity"), stop_loss: nn("stop_loss"), take_profit: nn("take_profit"), setup_tag: (fd.get("setup_tag") || "").toString() || null,
            observation_id: (fd.get("observation_id") || "").toString() || null, reason: (fd.get("reason") || "").toString().trim() || null };
      const r = T.applyEdit(t, patch, new Date().toISOString());
      if (!r.ok) return { html: r.errors.map((e) => esc(e.msg)).join("<br>"), field: r.errors[0].field };
      if (!r.changed) return null;
      if (!closed) {
        const warn = await typoWarningFor(t.asset_id ? assetById(t.asset_id) : null, t.symbol, cur, r.row.entry_price);
        if (warn && r.patch.entry_price != null && !(await appDialog({ title: "Check the entry price", body: `<p>${esc(warn)}</p><p class="muted">Save it anyway?</p>`, buttons: [{ label: "Go back", value: false }, { label: "Save anyway", primary: true, value: true }] }))) return { html: "Not saved.", field: "entry_price" };
        const others = state.trades.filter((x) => x.id !== t.id), acc = T.account(Number(state.settings.paper_balance) || 10000, others, (c) => fxRate(c)), fx = cur === "USD" ? 1 : fxRate(cur);
        if (fx != null) {
          const fut = isFutures(r.row), need = (fut ? r.row.entry_price * r.row.quantity / r.row.leverage : r.row.entry_price * r.row.quantity) * fx;
          const pos = fut ? tradeMargin(t) : t.entry_price * t.quantity;   // only warn if the edit makes the position bigger
          if (need > pos * fx + 1e-9 && !(await confirmOverAvailable({ needUsd: need, availUsd: acc.available, balance: acc.balance, inTrades: acc.inTrades, futures: fut, lev: r.row.leverage, entry: r.row.entry_price, qty: r.row.quantity, cur }))) return { html: "Not saved." };
        }
      }
      const upd = { ...r.patch, edits: r.edits };
      await must(sb.from("trading_paper_trades").update(upd).eq("id", t.id));
      Object.assign(t, upd); dropAlerts(t.id); render(true); pollLive();   // the levels may have changed: forget old alerts, the next poll checks again
      const nChanges = Object.keys(r.patch).length;
      toast(`Saved ${nChanges} change${nChanges === 1 ? "" : "s"} to ${t.symbol}`);
      return null;
    } });
  }

  // ---------- phase 5c: keep the open-trade form across reloads ----------
  const DRAFT_NAMES = ["asset_id", "symbol", "opened_on", "leverage", "currency", "entry_price", "quantity", "stop_loss", "take_profit", "risk_pct", "setup_tag", "observation_id", "reason"];
  function saveDraft() {
    const f = $("#tradeForm"); if (!f) return;
    const d = { day: localDate(), vals: {}, side: (f.querySelector("[name=side]:checked") || {}).value, mode: (f.querySelector("[name=mode]:checked") || {}).value, ck_htf: f.elements.ck_htf.checked, ck_liq: f.elements.ck_liq.checked };
    for (const k of DRAFT_NAMES) if (f.elements[k]) d.vals[k] = f.elements[k].value;
    lsSet("tradeDraft", JSON.stringify(d));
  }
  const clearDraft = () => { try { localStorage.removeItem("tj:tradeDraft"); } catch { /* ignore */ } };
  function restoreDraft(f) {
    let d; try { d = JSON.parse(lsGet("tradeDraft") || "null"); } catch { d = null; }
    if (!d || !d.vals) return;
    for (const k of DRAFT_NAMES) {
      const el = f.elements[k], v = d.vals[k]; if (!el || v == null) continue;
      if (k === "opened_on" && d.day !== localDate()) continue;                 // a draft from an earlier day gets today's date
      if (k === "asset_id" && ![...el.options].some((o) => o.value === v)) continue;   // the asset is gone
      if (k === "observation_id") { el.dataset.want = v; continue; }            // the picker is filled afterwards
      el.value = v;
    }
    const radio = (n, v) => { const r = v && f.querySelector(`input[name=${n}][value="${v}"]`); if (r) r.checked = true; };
    radio("side", d.side); radio("mode", d.mode);
    f.elements.ck_htf.checked = !!d.ck_htf; f.elements.ck_liq.checked = !!d.ck_liq;
    const o = $(".trade-other"); if (o) o.hidden = f.elements.asset_id.value !== "";
  }

  // live price + currency rate for the trade form (shown with source and time; only filled when you click)
  async function refreshLiveLine() {
    const f = $("#tradeForm"), line = $("#liveLine"); if (!f || !line) return;
    const id = f.elements.asset_id.value, a = id ? assetById(id) : null;
    if (!a) { line.textContent = "Other symbol: type your own prices."; return; }
    line.textContent = "Checking the live price…";
    const r = await TJ_PRICES.getPrice(a);
    if (!$("#liveLine") || $("#tradeForm").elements.asset_id.value !== id) return;   // you moved on
    const cur = ($("#tradeForm").elements.currency.value || "USD").toUpperCase();
    if (r.price == null) { line.innerHTML = `<span class="muted">No live price: ${esc(r.reason)}</span>`; return; }
    const usable = !r.stale && cur === "USD";
    line.innerHTML = `Live price <b>${fmtMoney(r.price)}</b> <span class="muted">· ${esc(r.source)}, ${TJ_PRICES.fmtAt(r.at)}${r.stale ? ` · ${esc(r.reason)}` : ""}</span>
      <button type="button" class="btn xs" data-action="use-live-entry" data-price="${r.price}" ${usable ? "" : "disabled"} title="${usable ? "Fill the entry price with this" : r.stale ? "Couldn't refresh, type the price" : "Live prices are in USD; this trade uses " + esc(cur)}">Use as entry</button>`;
  }
  async function ensureFx(cur) {
    const f = $("#tradeForm"); if (!f) return;
    const row = f.querySelector(".fx-row"), inp = f.elements.fx_est;
    cur = (cur || "USD").toUpperCase();
    if (cur === "USD" || !/^[A-Z]{3}$/.test(cur)) { row.hidden = true; inp.value = ""; updateTradeCalc(); return; }
    row.hidden = false; $("#fxCur").textContent = cur; inp.value = ""; inp.dataset.cur = cur;
    const r = await TJ_PRICES.fiatRate(cur, "USD");
    const g = $("#tradeForm"); if (!g || g.elements.fx_est.dataset.cur !== cur) return;
    const note = $("#fxNote");
    if (r.rate != null && !r.stale) { if (!g.elements.fx_est.value) g.elements.fx_est.value = r.rate; note.textContent = `${r.source}${r.date ? ", " + r.date : ""}`; }
    else note.textContent = r.reason;
    updateTradeCalc();
  }

  async function openTrade(form) {
    const fd = new FormData(form);
    const n = (k) => { const v = fd.get(k); return v === "" || v == null ? null : Number(v); };
    const asset = assetById(fd.get("asset_id"));
    const symbol = asset ? asset.symbol : (fd.get("symbol") || "").toString().trim().toUpperCase();
    if (!symbol) { toast("Type a symbol for this trade.", "err"); return; }
    const mode = fd.get("mode") === "futures" ? "futures" : "spot";
    const currency = (fd.get("currency") || "USD").toString().trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) { toast("Currency should be a 3-letter code, e.g. USD or INR.", "err"); return; }
    const lev = n("leverage");
    if (mode === "futures" && !(lev >= 1 && lev <= 50)) { toast("Leverage must be between 1 and 50.", "err"); return; }
    const row = {
      asset_id: asset ? asset.id : null, symbol, side: fd.get("side") || "long", opened_on: fd.get("opened_on") || localDate(),
      entry_price: n("entry_price"), quantity: n("quantity"), stop_loss: n("stop_loss"), take_profit: n("take_profit"),
      reason: (fd.get("reason") || "").toString().trim() || null, screenshots: [],
      mode, leverage: mode === "futures" ? lev : null, maintenance_pct: mode === "futures" ? MAINT_PCT : null,
      fee_pct: Number(setting("fee_pct")), funding_pct_8h: Number(setting("funding_pct_8h")), currency,
      setup_tag: (fd.get("setup_tag") || "").toString() || null, observation_id: (fd.get("observation_id") || "").toString() || null,
      opened_at: new Date().toISOString(),
    };
    // Hard blocks, the same ones Edit uses: entry and quantity above 0, a stop is required (the one required checklist item), a stop or target on the
    // wrong side of the entry, or a futures stop beyond liquidation. Each names the field.
    const bad = T.validateTrade(row);
    if (bad.length) {
      await appDialog({ title: bad[0].field === "stop_loss" && row.stop_loss == null ? "Set a stop loss first" : "Check these values", body: `<ul>${bad.map((p) => `<li>${esc(p.msg)}</li>`).join("")}</ul><p class="muted">Nothing was saved.</p>`, buttons: [{ label: "Fix it", primary: true, value: true }] });
      const el = form.elements[bad[0].field]; if (el) el.focus();
      return;
    }
    // Typo guard: an entry more than 10% from the live price is an overridable warning
    const warn = await typoWarningFor(asset, symbol, currency, row.entry_price);
    if (warn) {
      const go = await appDialog({ title: "Check the entry price", body: `<p>${esc(warn)}</p><p class="muted">Open the trade anyway?</p>`, buttons: [{ label: "Go back", value: false }, { label: "Open anyway", primary: true, value: true }] });
      if (!go) { form.elements.entry_price.focus(); return; }
    }
    // Pre-trade checklist: unticked items warn (the stop was checked above); the ticks are saved with the trade
    const ckIn = checkInput(form, formMetrics(form)), ck = S.checklist(ckIn);
    row.checklist = S.checklistRecord(ckIn);
    if (ck.missing.length) {
      const go = await appDialog({ title: "Checklist: not everything is ticked", body: `<ul>${ck.missing.map((x) => `<li>${esc(x.label)}</li>`).join("")}</ul><p class="muted">These are warnings, not blocks. Open the trade anyway?</p>`,
        buttons: [{ label: "Go back", value: false }, { label: "Open anyway", primary: true, value: true }] });
      if (!go) return;
    }
    // Margin (futures) or the full value (spot) bigger than what's available is allowed, but ask first
    const fx = fxUsd(form, currency), st0 = practiceStats();
    const notional = row.entry_price * row.quantity, need = mode === "futures" ? notional / lev : notional;
    if (fx != null && !(await confirmOverAvailable({ needUsd: need * fx, availUsd: st0.available, balance: st0.balance, inTrades: st0.inTrades, futures: mode === "futures", lev, entry: row.entry_price, qty: row.quantity, cur: currency }))) return;
    try {
      const saved = await must(sb.from("trading_paper_trades").insert(row).select().single());
      clearDraft(); state.trades.unshift(saved); render(true); pollLive();
      toast(`Opened ${row.side} ${symbol}`);
    } catch (e) { fail(e); }
  }

  // close form: show gross, fees and net as you type the exit price
  function updateClosePreview(form) {
    const t = state.trades.find((x) => x.id === form.dataset.id), out = form.querySelector(".closeCalc"); if (!t || !out) return;
    const ex = Number(form.elements.exit_price.value);
    if (!(ex > 0)) { out.className = "calc small muted closeCalc"; out.textContent = "Type the exit price to see fees and the net result."; return; }
    const tmp = { ...t, exit_price: ex, closed_on: form.elements.closed_on.value || localDate(), funding_est: null };
    const cur = t.currency || "USD", C = (v) => fmtCur(v, cur), g = tradePnl(tmp), m = tradeMargin(tmp), net = tradeNetLocal(tmp);
    out.className = "calc small " + (net >= 0 ? "okbox" : "warn") + " closeCalc";
    out.innerHTML = `Gross <b>${C(g)}</b>${m != null && g < -m ? ` (capped at the ${C(m)} margin)` : ""} · fees −${C(tradeFees(tmp))}${isFutures(tmp) ? ` · funding −${C(fundingEstimate(tmp))} <span class="muted">(estimate, assumes you pay)</span>` : ""} · net <b>${C(net)}</b>${cur !== "USD" ? `<br><span class="muted">converted to USD with the ${esc(cur)} rate fetched when you close</span>` : ""}`;
  }

  // The rate to USD for closing: 1 for USD, else fetched from Frankfurter for the closing date, else typed. Never guessed.
  async function resolveCloseFx(cur, closedOn, typed) {
    if (cur === "USD") return { fx: 1 };
    const r = await TJ_PRICES.fiatRate(cur, "USD", closedOn === localDate() ? undefined : closedOn);
    if (r.rate != null && !r.stale) return { fx: r.rate };
    if (typed > 0) return { fx: typed };
    return { error: r.reason || `No ${cur}→USD rate available. Type it in.` };
  }
  // Save a close (shared by the card form and the alert banner): same fees, funding and USD rules either way
  async function commitClose(t, patch, fx) {
    patch.closed_at = patch.closed_at || new Date().toISOString();
    const tmp = { ...t, ...patch, funding_est: null };
    patch.funding_est = isFutures(t) ? fundingEstimate(tmp) : null;
    patch.fx_to_usd = fx;
    patch.net_pnl_usd = tradeNetLocal({ ...tmp, funding_est: patch.funding_est }) * fx;
    await must(sb.from("trading_paper_trades").update(patch).eq("id", t.id));
    Object.assign(t, patch); dropAlerts(t.id); render(true);
    toast(`Closed ${t.symbol}: ${fmtMoney(tradeNetUsd(t))} net`);
  }
  async function closeTrade(form) {
    const id = form.dataset.id;
    const t = state.trades.find((x) => x.id === id); if (!t) return;
    const fd = new FormData(form);
    const patch = {
      exit_price: Number(fd.get("exit_price")), closed_on: fd.get("closed_on") || localDate(),
      exit_reason: fd.get("exit_reason") || "manual", emotion: fd.get("emotion") || null,
      lessons: (fd.get("lessons") || "").toString().trim() || null, ...reviewFromForm(fd),
    };
    if (!(patch.exit_price > 0)) { toast("Type the exit price.", "err"); return; }
    const rf = await resolveCloseFx(t.currency || "USD", patch.closed_on, Number(fd.get("fx_to_usd")));
    if (rf.error) {
      const row = form.querySelector(".fxrow"); row.hidden = false; row.querySelector("input").focus();
      toast(`${rf.error} Then press Close again.`, "err"); return;
    }
    try { await commitClose(t, patch, rf.fx); } catch (e) { fail(e); }
  }

  // ---------- currency converter (Practice trades, top right) ----------
  const numOf = (sel) => { const el = $(sel); const v = el ? Number(el.value) : NaN; return v > 0 ? v : null; };
  async function runConvert() {
    const out = $("#convOut"); if (!out) return;
    const amt = Number(($("#convAmt") || {}).value), cur = (($("#convCur") || {}).value || "").trim().toUpperCase();
    if (!(amt > 0) || !/^[A-Z]{3}$/.test(cur)) { out.className = "small conv-out neg"; out.textContent = "Enter an amount and a 3-letter currency code."; return; }
    const ov = { rate: numOf("#convRate"), usdt: numOf("#convUsdt"), px: numOf("#convPx") };   // values typed after a failed fetch
    out.className = "small conv-out muted"; out.textContent = "Fetching rates…";
    const f = $("#tradeForm"), aid = f && f.elements.asset_id.value, a = aid ? assetById(aid) : null;
    const [rate, usdt, price] = await Promise.all([TJ_PRICES.fiatRate(cur, "USD"), TJ_PRICES.getUsdt(), a ? TJ_PRICES.getPrice(a) : Promise.resolve(null)]);
    const ok = (x, k) => x && x[k] != null && !x.stale;
    const L = []; let needsTyping = false;
    const typed = (id, label) => { needsTyping = true; return `<input id="${id}" type="number" step="any" min="0" inputmode="decimal" placeholder="${label}" aria-label="${label}">`; };
    const when = (x) => `${esc(x.source)}${x.date ? ", " + x.date : ""}, fetched ${TJ_PRICES.fmtAt(x.at)}`;
    // 1) amount → USD
    let usd = null;
    if (cur === "USD") { usd = amt; L.push(`${fmtNum(amt)} USD`); }
    else if (ok(rate, "rate")) { usd = amt * rate.rate; L.push(`${fmtNum(amt)} ${esc(cur)} ≈ <b>${fmtNum(Math.round(usd * 100) / 100)} USD</b> <span class="muted">· rate ${fmtNum(rate.rate)} (${when(rate)})</span>`); }
    else if (ov.rate) { usd = amt * ov.rate; L.push(`${fmtNum(amt)} ${esc(cur)} ≈ <b>${fmtNum(Math.round(usd * 100) / 100)} USD</b> <span class="muted">· rate ${fmtNum(ov.rate)} typed by you</span> ${typed("convRate", "USD per 1 " + cur)}`); }
    else L.push(`<span class="neg">No ${esc(cur)}→USD rate: ${esc(rate.reason || "unavailable")}</span> ${typed("convRate", "USD per 1 " + cur)}`);
    // 2) USD → USDT (the real CoinGecko USDT price, not exactly $1)
    let usdtAmt = null, usdtPx = ok(usdt, "price") ? usdt.price : ov.usdt;
    if (usd != null && usdtPx) { usdtAmt = usd / usdtPx; L.push(`≈ <b>${fmtNum(Math.round(usdtAmt * 100) / 100)} USDT</b> <span class="muted">· 1 USDT = $${fmtNum(usdtPx)} (${ok(usdt, "price") ? when(usdt) : "typed by you"})</span>${ok(usdt, "price") ? "" : " " + typed("convUsdt", "USD per 1 USDT")}`); }
    else if (usd != null) L.push(`<span class="neg">No USDT price: ${esc(usdt.reason || "unavailable")}</span> ${typed("convUsdt", "USD per 1 USDT")}`);
    // 3) → quantity of the selected asset
    let qty = null;
    if (!a) L.push(`<span class="muted">Pick an asset in the trade form to see how much it buys.</span>`);
    else if (usd != null) {
      const assetCur = defaultCurrency(a);
      let px = null, pxNote = "";
      if (assetCur === "USD" && ok(price, "price")) { px = price.price; pxNote = `at $${fmtNum(px)} (${when(price)})`; }
      else {
        const why = price && price.price == null ? price.reason : price && price.stale ? price.reason : "";
        px = ov.px; pxNote = px ? `at ${fmtCur(px, assetCur)} (typed by you)` : "";
        if (!px) L.push(`<span class="neg">No live price for ${esc(a.symbol)}: ${esc(why || "unavailable")}</span> ${typed("convPx", "Price in " + assetCur)}`);
        else L.push(`<span class="muted">No live price for ${esc(a.symbol)}: ${esc(why || "unavailable")}</span> ${typed("convPx", "Price in " + assetCur)}`);
      }
      if (px) {
        let budget = assetCur === "USD" ? usd : null;   // money to spend, in the asset's currency
        if (assetCur !== "USD") {
          if (cur === assetCur) budget = amt;
          else { const r2 = await TJ_PRICES.fiatRate(cur, assetCur); if (ok(r2, "rate")) budget = amt * r2.rate; else L.push(`<span class="neg">No ${esc(cur)}→${esc(assetCur)} rate: ${esc(r2.reason || "unavailable")}. Use ${esc(assetCur)} as the currency instead.</span>`); }
        }
        if (budget != null) {
          qty = floorTo(budget / px, a.category === "crypto" ? 6 : 4);
          L.push(`≈ <b>${fmtNum(qty)} ${esc(a.symbol)}</b> <span class="muted">${pxNote}</span> <button type="button" class="btn xs" data-action="conv-use" data-qty="${qty}">Use as quantity</button>`);
        }
      }
    }
    if (needsTyping) L.push(`<button type="button" class="btn xs ghost" data-action="conv-run">Recalculate</button>`);
    out.className = "small conv-out"; out.innerHTML = L.join("<br>");
  }
  async function fillCurrencyList() {
    const dl = $("#curList"); if (!dl || dl.dataset.filled) return; dl.dataset.filled = "1";
    const list = await TJ_PRICES.currencies(); const d2 = $("#curList");
    if (d2) d2.innerHTML = Object.entries(list).map(([c, n]) => `<option value="${esc(c)}">${esc(n)}</option>`).join("");
  }
  // "Use live price" next to a price field: fills it only when clicked, shows source and time, never guesses.
  async function useLivePrice(assetId, input, note) {
    const a = assetById(assetId); if (!input || !a) return;
    const say = (h) => { if (note) note.innerHTML = h; };
    say("Checking…");
    const r = await TJ_PRICES.getPrice(a);
    if (r.price == null) { say(`<span class="neg">${esc(r.reason)}</span>`); return; }
    if (r.stale) { say(`<span class="neg">${esc(r.reason)} Type the price instead.</span>`); return; }
    input.value = r.price; input.dispatchEvent(new Event("input", { bubbles: true }));
    say(`${fmtMoney(r.price)} · ${esc(r.source)}, ${TJ_PRICES.fmtAt(r.at)}`);
  }
  async function testFinnhub() {
    const el = $("#fhNote"); if (el) el.textContent = "Testing…";
    TJ_PRICES.clear();
    const r = await TJ_PRICES.getPrice({ symbol: "AAPL", category: "us", tv_symbol: "NASDAQ:AAPL" });
    const e2 = $("#fhNote"); if (e2) e2.textContent = r.price != null && !r.stale ? `Works: AAPL ${fmtMoney(r.price)} (${TJ_PRICES.fmtAt(r.at)})` : r.reason;
  }
  // After any re-render of the Practice tab: fill the currency list, the live price line and the currency rate
  function practiceAfterRender() {
    const f = $("#tradeForm"); if (f) restoreDraft(f);   // put back what was typed before a reload or re-render
    fillCurrencyList(); refreshLiveLine();
    if (f) { f.querySelector(".lev-row").hidden = (f.querySelector("[name=mode]:checked") || {}).value !== "futures"; fillObsPicker(f); ensureFx(f.elements.currency.value); updateTradeCalc(); }
    applyLive(); if (Date.now() - state.live.at > 30000) pollLive();
  }

  // ---------- PROGRESS (Overview · Journal · History on one page) ----------
  function viewProgress() {
    const due = state.obs.filter(readyToGrade).length;
    if (state.assetFilter !== "all" && !assetById(state.assetFilter)) state.assetFilter = "all";
    const body = state.sub === "journal" ? viewJournal() : state.sub === "history" ? viewHistory() : viewOverview();
    return `
      ${calendarCard()}
      <div class="subnav" role="tablist">${SUBS.map(([k, l]) =>
        `<button class="subtab ${state.sub === k ? "on" : ""}" role="tab" aria-selected="${state.sub === k}" data-action="sub" data-sub="${k}">${l}${k === "history" && due ? ` <span class="badge" title="Guesses ready to grade">${due}</span>` : ""}</button>`).join("")}</div>
      ${body}`;
  }

  // ---------- DAYS-CHECKED CALENDAR (above the sub-tabs; shares the asset filter with them) ----------
  const assetObs = () => state.obs.filter((o) => state.assetFilter === "all" || o.asset_id === state.assetFilter);
  // Observations after both shared filters (asset, then clicked day)
  const filteredObs = () => assetObs().filter((o) => !state.dayFilter || o.observed_on === state.dayFilter);
  function calendarCard() {
    const days = [];
    for (let i = 29; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); days.push(localDate(d)); }
    const today = localDate();
    const list = assetObs();
    const checked = new Set(list.map((o) => o.observed_on));
    const due = new Set(list.filter(readyToGrade).map((o) => o.observed_on));
    const n = days.filter((d) => checked.has(d)).length;
    const a = state.assetFilter === "all" ? null : assetById(state.assetFilter);
    return `
      <div class="card cal">
        <div class="cal-head">
          <div><h3>Days checked</h3><div class="small muted">${a ? esc(a.symbol) : "All assets"} · ${n} of 30 days</div></div>
          <div class="sec-actions">
            <select data-change="asset-filter" class="select" aria-label="Asset">
              <option value="all">All assets</option>
              ${byGroup(state.assets).map((x) => `<option value="${x.id}" ${state.assetFilter === x.id ? "selected" : ""}>${esc(x.symbol)} · ${esc(x.name)}</option>`).join("")}
            </select>
            <button type="button" class="btn ghost sm" data-action="csv" data-scope="progress" title="Export what the filters show">⬇ CSV</button>
          </div>
        </div>
        <div class="cal-grid">${days.map((d) => `<button type="button" class="cal-day ${checked.has(d) ? "on" : ""} ${d === today ? "today" : ""} ${state.dayFilter === d ? "sel" : ""}" data-action="cal-day" data-day="${d}" aria-pressed="${state.dayFilter === d}" aria-label="${fmtDate(d)}${checked.has(d) ? ", checked" : ""}${due.has(d) ? ", guess ready to grade" : ""}" title="${fmtDate(d)}">${parseDay(d).getDate()}${due.has(d) ? `<i class="cal-dot"></i>` : ""}</button>`).join("")}</div>
        <div class="cal-foot small muted">
          ${state.dayFilter ? `<span class="tag">Showing ${fmtDate(state.dayFilter)} <button type="button" class="icon-btn" data-action="clear-day" title="Clear day filter" aria-label="Clear day filter">✕</button></span>` : "Tap a day to filter the section below."}
          <span class="cal-key"><i class="cal-dot inline"></i> guess ready to grade</span>
        </div>
      </div>`;
  }

  function viewOverview() {
    const daysSet = new Set(state.obs.map((o) => o.observed_on));   // streak and challenge day always use every asset
    const fo = filteredObs();
    const today = localDate();
    let streak = 0;
    const cur = new Date();
    if (!daysSet.has(today)) cur.setDate(cur.getDate() - 1);
    while (daysSet.has(localDate(cur))) { streak++; cur.setDate(cur.getDate() - 1); }
    const minutes = Math.round(fo.reduce((s, o) => s + (o.seconds_spent || 0), 0) / 60);
    const graded = fo.filter((o) => o.outcome);
    const right = graded.filter((o) => o.outcome === "right").length;
    const learned = state.concepts.filter((c) => c.learned).length;
    const first = [...daysSet].sort()[0];
    const dayN = first ? daysBetween(first, today) + 1 : 0;
    const srcCount = {};
    fo.forEach((o) => { if (o.source) srcCount[o.source] = (srcCount[o.source] || 0) + 1; });
    const srcTotal = Object.values(srcCount).reduce((s, n) => s + n, 0);

    const cols = [];
    for (let i = 29; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); cols.push(localDate(d)); }
    const hit = new Set(assetObs().map((o) => o.asset_id + "|" + o.observed_on));
    const rows = state.assetFilter === "all" ? activeAssets() : activeAssets().filter((a) => a.id === state.assetFilter);

    const stat = (v, l, sub = "") => `<div class="card stat"><div class="stat-v">${v}</div><div class="stat-l">${l}</div>${sub ? `<div class="xs muted">${sub}</div>` : ""}</div>`;
    return `
      <section>
        <div class="sec-head"><div><h2>Progress</h2><p class="muted">Anikait's challenge: one month of daily chart watching.</p></div></div>
        <div class="stats">
          ${stat(first ? `Day ${Math.min(dayN, 999)}` : "—", "of your 30-day challenge", first ? `Started ${fmtDate(first)}` : "Save your first observation to start")}
          ${stat(new Set(fo.map((o) => o.observed_on)).size, "days practised")}
          ${stat(streak, "day streak 🔥")}
          ${stat(fo.length, "charts studied", `${minutes} min of focused watching`)}
          ${stat(graded.length ? Math.round((right / graded.length) * 100) + "%" : "—", "guesses right", graded.length ? `${right} of ${graded.length} graded · ${fo.filter(readyToGrade).length} waiting` : "Grade guesses in History after a week")}
          ${stat(`${learned}/${state.concepts.length}`, "concepts learned")}
        </div>
        ${srcTotal ? `
          <div class="card">
            <h3>Where you look</h3>
            <div class="src-bars">${SOURCES.filter(([k]) => srcCount[k]).map(([k, l]) => `
              <div class="src-row"><span class="small">${l}</span><div class="bar slim"><span style="width:${(srcCount[k] / srcTotal) * 100}%"></span></div><span class="small muted">${srcCount[k]}</span></div>`).join("")}
            </div>
          </div>` : ""}
        <div class="card">
          <h3>Last 30 days</h3>
          <div class="heat-wrap">
            <table class="heat">
              <thead><tr><th></th>${cols.map((d) => `<th title="${d}">${parseDay(d).getDate()}</th>`).join("")}</tr></thead>
              <tbody>${rows.map((a) => `<tr><th><button type="button" class="linkbtn" data-action="filter-asset" data-id="${a.id}" title="Show only ${esc(a.symbol)}">${esc(a.symbol)}</button></th>${cols.map((d) => `<td class="${hit.has(a.id + "|" + d) ? "on" : ""}" title="${esc(a.symbol)} · ${d}"></td>`).join("")}</tr>`).join("")}</tbody>
            </table>
          </div>
        </div>
      </section>`;
  }

  // ---------- SETTINGS ----------
  const DEFAULT_DEFAULTS = { home_currency: "CAD", risk_pct: 1, fee_pct: 0.055, funding_pct_8h: 0.01 };
  const setting = (k) => (state.settings[k] != null ? state.settings[k] : DEFAULT_DEFAULTS[k]);

  async function saveSettings(patch) {
    const saved = await must(sb.from("trading_settings").upsert({ user_id: state.user.id, ...patch, updated_at: new Date().toISOString() }).select().single());
    state.settings = saved; return saved;
  }

  function viewSettings() {
    const pref = themePref();
    if (state.resetCounts === null && !state.resetCountsBusy) refreshResetCounts();
    const chips = tfChips();
    const r = state.reset;
    return `
      <section class="settings">
        <div class="sec-head"><div><h2>Settings</h2><p class="muted">Theme, defaults, your data, and the account.</p></div></div>

        <div class="card">
          <h3>Theme</h3>
          <div class="chips" role="radiogroup" aria-label="Theme">
            ${[["system", "System"], ["light", "Light"], ["dark", "Dark"]].map(([k, l]) => `<label class="chip"><input type="radio" name="theme" value="${k}" data-change="theme" ${pref === k ? "checked" : ""}><span>${l}</span></label>`).join("")}
          </div>
        </div>

        <div class="card">
          <h3>Show practice trades</h3>
          <label class="ckbox"><input type="checkbox" data-change="show-practice" ${practiceOn() ? "checked" : ""}><span>Show the Practice trades tab</span></label>
          <p class="muted small">Off by default: practice trades are frozen. While this is off the tab is hidden and nothing runs for them (no price requests, alerts or notifications). Your practice data and code are untouched, and exports still include practice trades if you have any. Paper trade in TradingView Paper Trading or Bybit Demo; journal the lesson here.</p>
        </div>

        <form id="defaultsForm" class="card form">
          <h3>Defaults</h3>
          <p class="muted small">Only used by practice trades (when shown). Saved to your account.</p>
          <div class="row4">
            <label>Starting practice balance<input name="paper_balance" type="number" step="any" min="1" value="${esc(Number(state.settings.paper_balance) || 10000)}"></label>
            <label>Home currency<input name="home_currency" maxlength="3" value="${esc(setting("home_currency"))}" style="text-transform:uppercase"></label>
            <label>Risk % per trade<input name="risk_pct" type="number" step="any" min="0" value="${esc(setting("risk_pct"))}"></label>
            <label>Fee % (each side)<input name="fee_pct" type="number" step="any" min="0" value="${esc(setting("fee_pct"))}"></label>
          </div>
          <div class="row4">
            <label>Funding % per 8h<input name="funding_pct_8h" type="number" step="any" min="0" value="${esc(setting("funding_pct_8h"))}"></label>
          </div>
          <div class="form-foot"><span></span><button class="btn primary" type="submit">Save defaults</button></div>

          <h3 class="list-head">Edit timeframe chips</h3>
          <p class="muted small">These are the chips on Today and the tiles in the “All timeframes” grid. Use forms like 15m, 4h, 1D, 1W, 1M, 1Y. The free TradingView widget can't show everything (8h and 12h show the 4h tile instead).</p>
          <ul class="tfedit">
            ${chips.map((t, i) => `<li><span class="tag">${esc(t)}</span>
              <button type="button" class="icon-btn" data-action="chip-move" data-i="${i}" data-d="-1" ${i === 0 ? "disabled" : ""} aria-label="Move ${esc(t)} earlier">↑</button>
              <button type="button" class="icon-btn" data-action="chip-move" data-i="${i}" data-d="1" ${i === chips.length - 1 ? "disabled" : ""} aria-label="Move ${esc(t)} later">↓</button>
              <button type="button" class="icon-btn" data-action="chip-del" data-i="${i}" ${chips.length < 2 ? "disabled" : ""} aria-label="Remove ${esc(t)}">×</button></li>`).join("")}
          </ul>
          <div class="row-btns align-end">
            <label>Add a chip<input id="chipNew" maxlength="6" placeholder="e.g. 2h" autocomplete="off"></label>
            <button type="button" class="btn" data-action="chip-add">Add</button>
            <button type="button" class="btn ghost" data-action="chip-reset">Reset to default list</button>
          </div>
        </form>

        <div class="card">
          <h3>Setup tags</h3>
          <p class="muted small">The list on the practice-trade form. The one-line description shows under the Setup menu to remind you what the setup means; edit it any time. Removing a tag never changes trades that already use it.</p>
          <ul class="tfedit tagedit">
            ${setupTags().map((g, i) => `<li><span class="tag">${esc(g)}</span>
              <input class="tagnote" data-tag="${esc(g)}" value="${esc(tagNote(g))}" maxlength="140" placeholder="one-line description" aria-label="Description of ${esc(g)}">
              <button type="button" class="icon-btn" data-action="tag-del" data-i="${i}" ${setupTags().length < 2 ? "disabled" : ""} aria-label="Remove ${esc(g)}">×</button></li>`).join("")}
          </ul>
          <div class="row-btns align-end">
            <label>Add a tag<input id="tagNew" maxlength="24" placeholder="e.g. trend continuation" autocomplete="off"></label>
            <label>Description<input id="tagNewNote" maxlength="140" placeholder="optional" autocomplete="off"></label>
            <button type="button" class="btn" data-action="tag-add">Add</button>
            <button type="button" class="btn ghost" data-action="tag-reset">Reset to default list</button>
          </div>
        </div>

        <div class="card">
          <h3>Trade mistakes</h3>
          <p class="muted small">The ticks on the close form and in a trade's review. Removing one never changes trades that already used it.</p>
          <ul class="tfedit">
            ${tradeMistakes().map((g, i) => `<li><span class="tag">${esc(g)}</span>
              <button type="button" class="icon-btn" data-action="mistake-del" data-i="${i}" ${tradeMistakes().length < 2 ? "disabled" : ""} aria-label="Remove ${esc(g)}">×</button></li>`).join("")}
          </ul>
          <div class="row-btns align-end">
            <label>Add a mistake<input id="mistakeNew" maxlength="30" placeholder="e.g. chased the candle" autocomplete="off"></label>
            <button type="button" class="btn" data-action="mistake-add">Add</button>
            <button type="button" class="btn ghost" data-action="mistake-reset">Reset to default list</button>
          </div>
        </div>

        <div class="card">
          <h3>Live stock prices <span class="muted small">optional</span></h3>
          <p class="muted small">Crypto prices (CoinGecko) and currency rates (Frankfurter) need no key. US stock and ETF prices come from Finnhub: paste your own free key from finnhub.io. It is saved <b>in this browser only</b>, never in your account and never in an export.</p>
          <div class="row-btns align-end">
            <label>Finnhub key<input id="fhKey" type="password" autocomplete="off" placeholder="${TJ_PRICES.hasKey() ? "A key is saved in this browser" : "paste key"}" value=""></label>
            <button type="button" class="btn" data-action="fh-save">Save key</button>
            <button type="button" class="btn ghost" data-action="fh-test">Test</button>
            <button type="button" class="btn ghost" data-action="fh-clear" ${TJ_PRICES.hasKey() ? "" : "disabled"}>Remove</button>
          </div>
          <p class="small muted" id="fhNote" aria-live="polite"></p>
        </div>

        <div class="card">
          <h3>Export my data</h3>
          <p class="muted small">A .zip with a CSV and a JSON for every table, your screenshots, and a README. The date range filters observations (observed_on), journal entries (entry_on) and practice trades (opened_on); the watchlist, concepts, words and settings are always included in full.</p>
          <div class="row-btns align-end">
            <label>From<input type="date" id="expFrom" value="${esc(state.exp.from)}"></label>
            <label>To<input type="date" id="expTo" value="${esc(state.exp.to)}"></label>
            <button type="button" class="btn ghost sm" data-action="exp-range" data-r="week">This week</button>
            <button type="button" class="btn ghost sm" data-action="exp-range" data-r="30">Last 30 days</button>
            <button type="button" class="btn ghost sm" data-action="exp-range" data-r="all">All time</button>
          </div>
          <div class="form-foot"><span class="small muted" id="expProgress" aria-live="polite"></span><button type="button" class="btn primary" data-action="export-all" id="expBtn">Download everything (.zip)</button></div>
        </div>

        <div class="card">
          <h3>Account</h3>
          <p class="small">Signed in as <b>${esc(state.user.email)}</b></p>
          <p class="xs muted">App version <b>${esc(window.APP_VERSION || "unknown")}</b> <span title="If this isn't the version in docs/BUILD_STATUS.md, your browser is showing an old copy: reload with Cmd/Ctrl+Shift+R.">(what your browser is running)</span></p>
          <button class="btn" data-action="signout">Sign out</button>
        </div>

        <div class="card danger">
          <h3>Danger zone: reset to day one</h3>
          <p class="small">Deletes <b>all</b> of your Chart Journal data: observations and their screenshot files, journal entries, practice trades, words, concepts and the watchlist. Then the starter watchlist and Learn list come back and the 30-day challenge starts again at day 1. Your account, theme, defaults and timeframe chips are kept, and the practice account goes back to your starting balance. Nothing outside Chart Journal is touched.</p>
          <p class="small" id="resetCounts">${resetCountsText()}</p>
          ${r && r.failed ? `<p class="small neg" id="resetStatus">${esc(resetStatusText())}</p>` : `<p class="small" id="resetStatus"></p>`}
          <p class="small"><button type="button" class="btn sm" data-action="export-all">Export everything first</button></p>
          <label>Type <b>RESET</b> to enable the button<input id="resetBox" autocomplete="off" placeholder="RESET"></label>
          <div class="form-foot"><span></span><button type="button" class="btn danger-btn" id="resetBtn" data-action="reset-day-one" disabled>${r && r.failed ? "Resume reset" : "Reset to day one"}</button></div>
        </div>
      </section>`;
  }

  // ---------- chips editor ----------
  async function setChips(list) {
    try { await saveSettings({ timeframe_chips: list }); render(true); }
    catch (e) { fail(e); }
  }
  async function setTags(list) {
    try { await saveSettings({ setup_tags: list }); render(true); }
    catch (e) { fail(e); }
  }
  function addTag() {
    const v = ($("#tagNew").value || "").trim().toLowerCase().replace(/\s+/g, " "), note = ($("#tagNewNote").value || "").trim();
    if (!v) { toast("Type a tag first.", "err"); return; }
    const cur = setupTags();
    if (cur.includes(v)) { toast(`${v} is already in the list.`, "err"); return; }
    (async () => {
      try { await saveSettings({ setup_tags: [...cur, v], ...(note ? { setup_tag_notes: { ...(state.settings.setup_tag_notes || {}), [v]: note } } : {}) }); render(true); }
      catch (e) { fail(e); }
    })();
  }
  async function saveTagNote(tag, text) {
    try { await saveSettings({ setup_tag_notes: { ...(state.settings.setup_tag_notes || {}), [tag]: text.trim() } }); toast(`Description of ${tag} saved`); }
    catch (e) { fail(e); }
  }
  async function setMistakes(list) { try { await saveSettings({ trade_mistakes: list }); render(true); } catch (e) { fail(e); } }
  function addMistake() {
    const v = ($("#mistakeNew").value || "").trim().replace(/\s+/g, " ");
    if (!v) { toast("Type a mistake first.", "err"); return; }
    const cur = tradeMistakes();
    if (cur.some((m) => m.toLowerCase() === v.toLowerCase())) { toast(`${v} is already in the list.`, "err"); return; }
    setMistakes([...cur, v]);
  }
  function addChip() {
    const raw = ($("#chipNew").value || "").trim();
    const v = /^\d+[mh]$/i.test(raw) ? raw.toLowerCase() : raw.replace(/^(\d+)([a-z])$/i, (_, n, u) => n + u.toUpperCase());
    if (!/^\d+(m|h|D|W|M|Y)$/.test(v)) { toast("Use a number then m, h, D, W, M or Y (e.g. 2h, 1D).", "err"); return; }
    const cur = tfChips();
    if (cur.includes(v)) { toast(`${v} is already in the list.`, "err"); return; }
    setChips([...cur, v]);
  }

  // ---------- export ----------
  const pad2 = (n) => String(n).padStart(2, "0");
  const csvCell = (v) => {
    if (v == null) return "";
    const t = typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  };
  function toCsv(rows, columns) {   // `columns` fixes the header (and keeps it when there are no rows)
    const cols = columns || [...rows.reduce((set, r) => { Object.keys(r).forEach((k) => set.add(k)); return set; }, new Set())];
    return "﻿" + [cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\r\n") + "\r\n";
  }
  function download(blob, name) {
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }
  // `order` lists columns that exist on that table (trading_settings has neither id nor created_at; its one row per user sorts by user_id)
  async function fetchAllRows(table, dateCol, order, from, to, mod) {
    const out = []; const size = 1000;
    for (let i = 0; ; i += size) {
      let q = sb.from(table).select("*");
      if (dateCol && from) q = q.gte(dateCol, from);
      if (dateCol && to) q = q.lte(dateCol, to);
      if (mod) q = mod(q);
      for (const col of order) q = q.order(col, { ascending: true });
      const part = await must(q.range(i, i + size - 1));
      out.push(...(part || []));
      if (!part || part.length < size) break;
    }
    return out;
  }
  const shotName = (p) => p.split("/").slice(1).join("_") || p;   // drop the user-id folder: 2026-10-24_<uuid>.webp
  // Adds each screenshot to zipFolder. One that can't be downloaded is skipped and listed in `missing` (never fails the zip).
  async function addShots(zipFolder, paths, missing, onProgress) {
    let n = 0;
    for (const p of paths) {
      n++; if (onProgress) onProgress(n, paths.length);
      try {
        const { data, error } = await sb.storage.from(BUCKET).download(p);
        if (error || !data) throw error || new Error("empty");
        zipFolder.file(shotName(p), data);
      } catch (e) { missing.push(`${p} (${(e && e.message) || "download failed"})`); }
    }
  }
  const needZip = () => { if (!window.JSZip) { toast("Couldn't load the zip library. Check your connection and reload.", "err"); return false; } return true; };

  async function exportAll() {
    if (!needZip()) return;
    // read the pickers directly; empty From and/or To means no filter on that side (All time when both are empty)
    const fromEl = $("#expFrom"), toEl = $("#expTo");
    if (fromEl) state.exp.from = fromEl.value; if (toEl) state.exp.to = toEl.value;
    const from = state.exp.from || null, to = state.exp.to || null;
    if (from && to && from > to) { toast("“From” is after “To”. Swap them or clear one.", "err"); return; }
    const btns = $$("[data-action=export-all]"); btns.forEach((b) => (b.disabled = true));
    const prog = (t) => { const el = $("#expProgress"); if (el) el.textContent = t; };
    try {
      prog("Reading your data…");
      const BY = ["created_at", "id"];
      const T = [   // [table, date column the range filters (or null), order columns]
        ["trading_assets", null, ["sort", ...BY]], ["trading_observations", "observed_on", ["observed_on", ...BY]], ["trading_concepts", null, ["phase", "sort", ...BY]],
        ["trading_journal_entries", "entry_on", ["entry_on", ...BY]], ["trading_paper_trades", "opened_on", ["opened_on", ...BY]], ["trading_glossary", null, BY],
        ["trading_settings", null, ["user_id"]],
      ];
      const zip = new window.JSZip(); const data = {};
      for (const [t, col, order] of T) {
        prog(`Reading ${t.replace("trading_", "")}…`);
        data[t] = await fetchAllRows(t, col, order, from, to);
        if (t === "trading_paper_trades" && !data[t].length) continue;   // no practice trades: no empty trade files either (README.txt says so)
        zip.file(`data/${t}.json`, JSON.stringify(data[t], null, 2));
        let csvRows = data[t];
        if (t === "trading_observations") {   // readable on its own: symbol and name right after asset_id (CSV only; the JSON stays raw)
          const A = Object.fromEntries((data.trading_assets || []).map((a) => [a.id, a]));
          csvRows = data[t].map((o) => { const r = {}; for (const k of Object.keys(o)) { r[k] = o[k]; if (k === "asset_id") { const a = A[o.asset_id]; r.symbol = a ? a.symbol : ""; r.name = a ? a.name : ""; } } return r; });
        }
        zip.file(`data/${t}.csv`, toCsv(csvRows, X.tidyColumns(csvRows, t === "trading_observations" ? ["timeframe"] : [])));   // no user_id, ids last, no legacy timeframe (the JSON stays raw)
      }
      prog("Building the practice-trade files…");
      // no practice trades in the range (e.g. after a reset): no practice/ folder at all, so the export carries no empty trade files
      const practice = data.trading_paper_trades.length ? practiceFiles(data.trading_paper_trades, { obs: [...state.obs, ...data.trading_observations], assets: data.trading_assets }) : null;
      if (practice) for (const [name, body] of Object.entries(practice.files)) zip.file(`practice/${name}`, body);
      const paths = [...new Set([...data.trading_observations, ...data.trading_paper_trades].flatMap((r) => r.screenshots || []))];
      const missing = [];
      const folder = zip.folder("screenshots");
      await addShots(folder, paths, missing, (i, n) => prog(`Adding screenshots ${i} of ${n}`));
      const added = paths.length - missing.length;
      zip.file("README.txt", [
        "Chart Journal export",
        `Made: ${new Date().toISOString()}  (account: ${state.user.email})`,
        `Date range: ${from || "the beginning"} to ${to || "today"} (filters observations by observed_on, journal by entry_on, practice trades by opened_on).`,
        "The watchlist, concepts, words and settings are always included in full.", "",
        "data/<table>.csv  and  data/<table>.json  one pair per table:",
        ...T.map(([t]) => `  ${t}: ${data[t].length} rows${t === "trading_paper_trades" && !data[t].length ? " (no files: there are no practice trades in this range)" : ""}`), "",
        `screenshots/  ${added} image${added === 1 ? "" : "s"} (named <date>_<id>.<ext>; the rows' "screenshots" column holds the original storage paths).`,
        missing.length ? `\nMISSING screenshots (${missing.length}), these could not be downloaded and are not in the zip:\n${missing.map((m) => "  - " + m).join("\n")}` : "No screenshots are missing.", "",
        practice ? "practice/  trades.csv, fills.csv, stats.csv, equity_curve.csv: your practice trades in the range, readable and enriched (described below)." : "practice/  not included: there are no practice trades in this range.",
        "Times are UTC ISO timestamps; days (observed_on etc.) are local calendar dates.",
        "The data/*.csv files leave out user_id, put id columns last and leave out the old single timeframe column; the .json files are raw.", "",
        practice ? practice.dictionary : "",
      ].join("\n"));
      prog("Compressing…");
      const blob = await zip.generateAsync({ type: "blob" }, (m) => prog(`Compressing ${Math.round(m.percent)}%`));
      const d = new Date();
      download(blob, `chart-journal-export-${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}.zip`);
      prog(`Done: ${Object.values(data).reduce((s, x) => s + x.length, 0)} rows, ${added} screenshot${added === 1 ? "" : "s"}${missing.length ? `, ${missing.length} missing (listed in README.txt)` : ""}.`);
      return true;
    } catch (e) { prog(""); fail(e); return false; }
    finally { btns.forEach((b) => (b.disabled = false)); }
  }

  function itemMarkdown(kind, r, a) {
    const L = [];
    const add = (k, v) => { if (v != null && v !== "" && !(Array.isArray(v) && !v.length)) L.push(`- **${k}:** ${Array.isArray(v) ? v.join(", ") : v}`); };
    if (kind === "obs") {
      L.push(`# ${a ? a.symbol : "?"} · ${r.observed_on}`, "");
      add("Source", r.source); add("Timeframes", r.timeframes && r.timeframes.length ? r.timeframes : r.timeframe); add("Trend", r.trend); add("Volume", r.volume);
      add("Price", r.price); add("Support", r.support); add("Resistance", r.resistance);
      add("Liquidation above", r.liq_above); add("Liquidation below", r.liq_below); add("Stops likely at", r.stops_note); add("Liquidation map checked", r.liq_map_checked);
      add("Minutes spent", Math.round((r.seconds_spent || 0) / 60)); add("Prediction", r.prediction); add("Outcome", r.outcome);
      if (r.note) L.push("", r.note);
    } else {
      L.push(`# ${r.symbol} ${r.side} · opened ${r.opened_on}`, "");
      add("Quantity", r.quantity); add("Entry", r.entry_price); add("Stop loss", r.stop_loss); add("Target", r.take_profit);
      add("Mode", r.mode === "futures" ? `futures ${r.leverage}×` : r.mode); add("Setup", r.setup_tag);
      const lo = r.observation_id ? state.obs.find((x) => x.id === r.observation_id) : null; if (r.observation_id) add("From observation", lo ? `${lo.observed_on} (${r.observation_id})` : r.observation_id);
      if (r.checklist && typeof r.checklist === "object") add("Checklist at open", CK_KEYS.filter((k) => r.checklist[k] != null).map((k) => `${r.checklist[k] ? "✓" : "✗"} ${CK_NAMES[k]}`));
      add("Opened at", r.opened_at); add("Closed at", r.closed_at);
      add("Closed", r.closed_on); add("Exit", r.exit_price); add("Exit reason", r.exit_reason); add("Felt", r.emotion);
      if (r.followed_plan != null) add("Followed plan", r.followed_plan ? "yes" : "no"); add("Mistakes", r.mistakes); add("Rating", r.rating);
      if (r.mae_price != null || r.mfe_price != null) add("Price range seen (app open only)", `worst ${r.mae_price ?? "?"}, best ${r.mfe_price ?? "?"}`);
      if (Array.isArray(r.edits) && r.edits.length) add("Edits", r.edits.map((e) => `${e.at}: ${e.field} ${JSON.stringify(e.old)} → ${JSON.stringify(e.new)}`));
      if (r.reason) L.push("", "**Why I took it:** " + r.reason);
      if (r.lessons) L.push("", "**Lesson:** " + r.lessons);
    }
    return L.join("\n") + "\n";
  }
  // One observation or trade → small zip: row.json, summary.md, screenshots/. Phase 5's trade cards reuse this unchanged.
  async function downloadItem(kind, id) {
    if (!needZip()) return;
    const r = (kind === "obs" ? state.obs : state.trades).find((x) => x.id === id); if (!r) return;
    const a = kind === "obs" ? assetById(r.asset_id) : null;
    toast("Preparing download…");
    try {
      const zip = new window.JSZip(); const missing = [];
      zip.file("row.json", JSON.stringify(r, null, 2));
      zip.file("summary.md", itemMarkdown(kind, r, a));
      await addShots(zip.folder("screenshots"), r.screenshots || [], missing);
      if (missing.length) zip.file("MISSING-screenshots.txt", missing.join("\n"));
      const name = kind === "obs" ? `${a ? a.symbol : "chart"}-${r.observed_on}` : `${r.symbol}-${r.opened_on}`;
      download(await zip.generateAsync({ type: "blob" }), `${name}.zip`);
      if (missing.length) toast(`${missing.length} screenshot(s) couldn't be downloaded (listed in the zip).`, "err");
    } catch (e) { fail(e); }
  }

  // ---------- CSV EXPORT OF WHAT YOU'RE LOOKING AT (one stock, a group, a selection, the Progress filter, practice trades) ----------
  const METRIC_COLS = ["date", "symbol", "name", "category", "source", "timeframes", "minutes_watched", "price", "trend", "support", "resistance", "volume",
    "liq_above", "liq_below", "liq_map_checked", "stops_note", "notes", "news", "prediction", "confidence", "check_price", "checked_on", "move_pct", "outcome",
    "screenshot_count", "screenshot_files", "asset_id"];
  const SUMMARY_COLS = ["symbol", "name", "category", "days_watched", "observations", "total_minutes", "first_seen", "last_seen", "guesses_made", "guesses_graded",
    "right", "mixed", "wrong", "accuracy_pct", "trades_opened", "trades_closed", "realised_pnl"];
  const min1 = (sec) => ((sec || 0) / 60).toFixed(1);   // minutes to 1 decimal place ("10.0", "7.5")
  const round2 = (n) => (n == null || !isFinite(n) ? "" : Math.round(n * 100) / 100);
  const yesNo = (v) => (v === true ? "yes" : v === false ? "no" : "");
  const tfText = (o) => (o.timeframes && o.timeframes.length ? o.timeframes : o.timeframe ? [o.timeframe] : []).join("; ");   // new field first, old one as fallback
  const shotFiles = (r) => (r.screenshots || []).map(shotName).join("; ");

  function metricRow(o, a) {
    const move = o.check_price != null && o.price != null && Number(o.price) !== 0 ? ((o.check_price - o.price) / o.price) * 100 : null;
    return {
      date: o.observed_on, symbol: a ? a.symbol : "", name: a ? a.name : "", category: a ? CAT_LABEL[a.category] || a.category : "",
      source: o.source ? SOURCE_LABEL[o.source] || o.source : "", timeframes: tfText(o), minutes_watched: min1(o.seconds_spent),
      price: o.price, trend: o.trend, support: o.support, resistance: o.resistance, volume: o.volume,
      liq_above: o.liq_above, liq_below: o.liq_below, liq_map_checked: yesNo(o.liq_map_checked), stops_note: o.stops_note, notes: o.notes, news: o.news,
      prediction: o.prediction, confidence: o.prediction ? o.confidence : null, check_price: o.check_price, checked_on: o.checked_on, move_pct: round2(move),
      outcome: o.outcome, screenshot_count: (o.screenshots || []).length, screenshot_files: shotFiles(o), asset_id: o.asset_id,
    };
  }
  const tradeMatches = (t, a) => t.asset_id === a.id || (!t.asset_id && (t.symbol || "").toUpperCase() === a.symbol.toUpperCase());
  function summaryRow(a, obs, trades, from, to) {
    const inR = (d) => d && (!from || d >= from) && (!to || d <= to);
    const mine = obs.filter((o) => o.asset_id === a.id).sort((x, y) => x.observed_on.localeCompare(y.observed_on));
    const days = new Set(mine.map((o) => o.observed_on));
    const graded = mine.filter((o) => o.outcome);
    const n = (k) => graded.filter((o) => o.outcome === k).length;
    const tr = trades.filter((t) => tradeMatches(t, a));
    const closed = tr.filter((t) => t.exit_price != null && inR(t.closed_on));
    return {
      symbol: a.symbol, name: a.name, category: CAT_LABEL[a.category] || a.category, days_watched: days.size, observations: mine.length,
      total_minutes: min1(mine.reduce((s, o) => s + (o.seconds_spent || 0), 0)), first_seen: mine.length ? mine[0].observed_on : "", last_seen: mine.length ? mine[mine.length - 1].observed_on : "",
      guesses_made: mine.filter((o) => o.prediction).length, guesses_graded: graded.length, right: n("right"), mixed: n("mixed"), wrong: n("wrong"),
      accuracy_pct: graded.length ? Math.round((n("right") / graded.length) * 1000) / 10 : "",
      trades_opened: tr.filter((t) => inR(t.opened_on)).length, trades_closed: closed.length, realised_pnl: round2(closed.reduce((s, t) => s + tradeNetUsd(t), 0)),
    };
  }
  const sortAssets = (ids) => byGroup(state.assets.filter((a) => ids.includes(a.id)));

  // spec: { ids: [asset ids], label, from, to, day }. One stock → one CSV; several → a zip with metrics.csv + summary.csv.
  // The readable practice-trade files (trades, fills, stats, equity curve) for a set of trades; the running balance always covers the whole account
  function practiceFiles(trades, opts = {}) {
    const obsList = opts.obs || state.obs, assetList = opts.assets || state.assets;
    const ctx = { start: Number(state.settings.paper_balance) || 10000, today: localDate(), assetsById: Object.fromEntries(assetList.map((a) => [a.id, a])),
      obsById: Object.fromEntries(obsList.map((o) => [o.id, o])), fee_pct: setting("fee_pct"), funding_pct_8h: setting("funding_pct_8h") };
    const sorted = trades.slice().sort((a, b) => (a.opened_on < b.opened_on ? -1 : a.opened_on > b.opened_on ? 1 : (a.created_at || "") < (b.created_at || "") ? -1 : 1));
    return {
      files: {
        "trades.csv": toCsv(X.tradeRows(sorted, state.trades, ctx), X.TRADE_COLS), "fills.csv": toCsv(X.fillRows(sorted), X.FILL_COLS),
        "stats.csv": toCsv(X.statsRows(sorted, state.trades, ctx), X.STATS_COLS), "equity_curve.csv": toCsv(X.equityRows(sorted, state.trades, ctx), X.EQUITY_COLS),
      },
      dictionary: X.dictionaryText(ctx),
    };
  }

  async function exportMetrics(spec) {
    const day = spec.day || null, from = day || spec.from || null, to = day || spec.to || null;
    const assets = sortAssets(spec.ids); if (!assets.length) { toast("Nothing to export.", "err"); return; }
    const multi = assets.length > 1;
    if (multi && !needZip()) return;
    toast("Preparing CSV…");
    try {
      const obs = await fetchAllRows("trading_observations", "observed_on", ["observed_on", "created_at", "id"], from, to,
        (q) => (assets.length === state.assets.length ? q : q.in("asset_id", assets.map((a) => a.id))));
      const trades = await fetchAllRows("trading_paper_trades", null, ["opened_on", "created_at", "id"], null, null);
      const byId = Object.fromEntries(assets.map((a) => [a.id, a]));
      const metrics = toCsv(obs.map((o) => metricRow(o, byId[o.asset_id])), METRIC_COLS);
      const today = localDate();
      const f = from || (obs.length ? obs[0].observed_on : today), t = to || today;
      // this stock's (or these stocks') practice trades opened in the range: when there are some, the export is a zip that includes them
      const inR = (d) => (!from || d >= from) && (!to || d <= to);
      const myTrades = trades.filter((tr) => assets.some((a) => tradeMatches(tr, a)) && inR(tr.opened_on));
      if (!multi && !myTrades.length) { download(new Blob([metrics], { type: "text/csv" }), `${assets[0].symbol}_metrics_${f}_${t}.csv`); toast(`${obs.length} row${obs.length === 1 ? "" : "s"} exported`); return; }
      if (!needZip()) return;
      const summary = toCsv(assets.map((a) => summaryRow(a, obs, trades, from, to)), SUMMARY_COLS);
      const zip = new window.JSZip();
      zip.file("metrics.csv", metrics); if (multi) zip.file("summary.csv", summary);
      const pf = myTrades.length ? practiceFiles(myTrades) : null;
      if (pf) for (const [name, body] of Object.entries(pf.files)) zip.file(name, body);
      zip.file("README.txt", [`Chart Journal metrics: ${spec.label}`, `Range: ${from || "the beginning"} to ${to || "today"}`, `Stocks: ${assets.map((a) => a.symbol).join(", ")}`, "",
        "metrics.csv  one row per observation, oldest first.", multi ? "summary.csv  one row per stock. accuracy_pct = right ÷ graded (mixed does not count as right)." : "",
        pf ? "trades.csv, fills.csv, stats.csv, equity_curve.csv  your practice trades for these stocks opened in the range (described below)." : "No trade files: there are no practice trades for these stocks in this range.",
        "screenshot_files are file names; the images are in the full export (Settings → Export).", "", pf ? pf.dictionary : ""].filter((x, i, a) => x !== "" || a[i - 1] !== "").join("\n"));
      download(await zip.generateAsync({ type: "blob" }), `${spec.label}_metrics_${f}_${t}.zip`);
      toast(multi ? `${obs.length} rows for ${assets.length} stocks exported` : `${obs.length} row${obs.length === 1 ? "" : "s"} and ${myTrades.length} trade${myTrades.length === 1 ? "" : "s"} exported`);
    } catch (e) { fail(e); }
  }

  async function exportTrades(spec) {
    const from = spec.from || null, to = spec.to || null;
    const a = spec.assetId ? assetById(spec.assetId) : null;
    if (!needZip()) return;
    try {
      let rows = await fetchAllRows("trading_paper_trades", "opened_on", ["opened_on", "created_at", "id"], from, to);
      if (a) rows = rows.filter((t) => tradeMatches(t, a));
      const pf = practiceFiles(rows), zip = new window.JSZip();
      for (const [name, body] of Object.entries(pf.files)) zip.file(name, body);
      zip.file("README.txt", [`Chart Journal practice trades${a ? ": " + a.symbol : ""}`, `Made: ${new Date().toISOString()}`, `Range: ${from || "the beginning"} to ${to || "today"} (by the date the trade was opened)`, `Trades: ${rows.length}`, "",
        "trades.csv        one row per trade, oldest first (open trades included).", "fills.csv        one row per entry and per exit.", "stats.csv         the stats panel for these trades, plus the account's max drawdown.",
        "equity_curve.csv  the balance after each closed trade (whole-account balances).", "", pf.dictionary].join("\n"));
      const f = from || (rows.length ? rows[0].opened_on : localDate()), t2 = to || localDate();
      download(await zip.generateAsync({ type: "blob" }), `${a ? a.symbol + "_" : ""}practice_${f}_${t2}.zip`);
      toast(`${rows.length} trade${rows.length === 1 ? "" : "s"} exported`);
    } catch (e) { fail(e); }
  }

  // Small popover next to the button: the same From / To as Settings (shared values) + shortcuts. spec.kind "trades" adds an asset picker.
  function closePop() { const p = $("#expop"); if (p) p.remove(); }
  function openExportPop(anchor, spec) {
    closePop();
    const pop = document.createElement("div"); pop.id = "expop"; pop.className = "expop card";
    const sel = spec.kind === "trades"
      ? `<label>Stock<select id="popAsset"><option value="">All</option>${byGroup(state.assets).map((a) => `<option value="${a.id}">${esc(a.symbol)}</option>`).join("")}</select></label>` : "";
    pop.innerHTML = `
      <div class="small"><b>${esc(spec.title)}</b></div>
      ${sel}
      <div class="row2"><label>From<input type="date" id="popFrom" value="${esc(state.exp.from)}"></label><label>To<input type="date" id="popTo" value="${esc(state.exp.to)}"></label></div>
      <div class="row-btns">
        <button type="button" class="btn ghost sm" data-r="week">This week</button><button type="button" class="btn ghost sm" data-r="30">Last 30 days</button><button type="button" class="btn ghost sm" data-r="all">All time</button>
      </div>
      <div class="form-foot"><button type="button" class="btn ghost sm" data-close>Cancel</button><button type="button" class="btn primary sm" data-go>Download</button></div>`;
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    pop.style.top = Math.min(window.innerHeight - pop.offsetHeight - 8, r.bottom + 6) + "px";
    pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - pop.offsetWidth - 8)) + "px";
    pop.addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.r) { const [f, t] = rangeFor(b.dataset.r); $("#popFrom").value = f; $("#popTo").value = t; }
      else if (b.hasAttribute("data-close")) closePop();
      else if (b.hasAttribute("data-go")) {
        const from = $("#popFrom").value, to = $("#popTo").value;
        if (from && to && from > to) { toast("“From” is after “To”. Swap them or clear one.", "err"); return; }
        state.exp.from = from; state.exp.to = to;
        const assetId = ($("#popAsset") || {}).value || null;   // read before the popover is removed
        closePop();
        if (spec.kind === "trades") exportTrades({ from, to, assetId }); else exportMetrics({ ...spec, from, to });
      }
    });
  }
  // This week (Monday → today) / last 30 days / all time → [from, to] date strings ("" = open)
  function rangeFor(r) {
    const d = new Date(), p = (x) => `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}`;
    if (r === "all") return ["", ""];
    const f = new Date(d); f.setDate(f.getDate() - (r === "30" ? 29 : (d.getDay() + 6) % 7));
    return [p(f), p(d)];
  }
  // data-action="csv" buttons: scope = asset | group | selected | today | progress
  function csvAction(el) {
    const { scope, id, group } = el.dataset;
    const all = state.assets.map((a) => a.id);
    let spec;
    if (scope === "asset" || scope === "today") { const a = assetById(scope === "today" ? state.selected : id); if (!a) return; spec = { ids: [a.id], label: a.symbol, title: `${a.symbol} metrics (CSV, or a zip when it has practice trades)` }; }
    else if (scope === "group") spec = { ids: state.assets.filter((a) => a.category === group).map((a) => a.id), label: CAT_LABEL[group] || group, title: `${CAT_LABEL[group] || group} (zip)` };
    else if (scope === "selected") spec = { ids: [...state.sel], label: "selection", title: `${state.sel.size} selected stocks (zip)` };
    else if (scope === "progress") {
      const one = state.assetFilter !== "all" ? assetById(state.assetFilter) : null;
      spec = { ids: one ? [one.id] : all, label: one ? one.symbol : "all-assets", title: one ? `${one.symbol} metrics (CSV)` : "All assets (zip)", day: state.dayFilter };
    } else return;
    if (!spec.ids.length) { toast("No stocks in there yet.", "err"); return; }
    spec.label = spec.label.replace(/[^\w-]+/g, "-");
    if (spec.day) exportMetrics(spec);            // a day picked on the calendar IS the range
    else openExportPop(el, spec);
  }

  // ---------- small in-app dialog (instead of window.confirm) ----------
  function appDialog({ title, body, buttons }) {
    return new Promise((resolve) => {
      const back = document.createElement("div"); back.className = "dlg-back";
      back.innerHTML = `<div class="card dlg" role="alertdialog" aria-modal="true" aria-label="${esc(title)}"><h3>${esc(title)}</h3><div class="dlg-body small">${body}</div>
        <div class="form-foot">${buttons.map((b, i) => `<button type="button" class="btn ${b.primary ? "primary" : "ghost"}" data-i="${i}">${esc(b.label)}</button>`).join("")}</div></div>`;
      const done = (v) => { back.remove(); document.removeEventListener("keydown", onKey, true); resolve(v); };
      const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); done(buttons[0].value); } };
      back.addEventListener("click", (e) => { const b = e.target.closest("button[data-i]"); if (b) done(buttons[Number(b.dataset.i)].value); });
      document.addEventListener("keydown", onKey, true);
      document.body.appendChild(back); back.querySelector("button[data-i]:last-child").focus();
    });
  }

  // ---------- reset to day one ----------
  const RESET_STEPS = [
    ["trading_observations", "observations"], ["trading_journal_entries", "journal entries"], ["trading_glossary", "words"],
    ["trading_paper_trades", "practice trades"], ["trading_concepts", "concepts"], ["trading_assets", "watchlist assets"],
  ];
  async function listShotFiles(prefix) {
    const files = [];
    for (let off = 0; ; off += 100) {
      const { data, error } = await sb.storage.from(BUCKET).list(prefix, { limit: 100, offset: off });
      if (error) throw error;
      for (const f of data || []) {
        if (f.id == null && !f.metadata) files.push(...(await listShotFiles(prefix + "/" + f.name)));   // a date folder
        else files.push(prefix + "/" + f.name);
      }
      if (!data || data.length < 100) break;
    }
    return files;
  }
  async function countRows(t) {
    const { count, error } = await sb.from(t).select("id", { count: "exact", head: true });
    if (error) throw error; return count || 0;
  }
  async function refreshResetCounts() {
    state.resetCountsBusy = true;
    try {
      const counts = {}; for (const [t, label] of RESET_STEPS) counts[label] = await countRows(t);
      counts.screenshots = (await listShotFiles(state.user.id)).length;
      state.resetCounts = counts;
    } catch (e) { console.error(e); state.resetCounts = false; }
    state.resetCountsBusy = false;
    const el = $("#resetCounts"); if (el) el.textContent = resetCountsText();
  }
  // "1 journal entry" / "2 journal entries" from the plural label
  const countLabel = (n, label) => `${n} ${n === 1 ? label.replace(/entries$/, "entry").replace(/s$/, "") : label}`;
  function resetCountsText() {
    const c = state.resetCounts;
    if (c === false) return "Couldn't count what will be deleted (you can still reset).";
    if (!c) return "Counting what will be deleted…";
    return "Will delete: " + [...RESET_STEPS.map(([, l]) => l), "screenshots"].map((l) => countLabel(c[l], l)).join(", ") + ".";
  }
  function resetStatusText() {
    const r = state.reset; if (!r || !r.failed) return "";
    const done = Object.entries(r.removed).filter(([, n]) => n).map(([k, n]) => countLabel(n, k)).join(", ") || "nothing yet";
    return `Reset stopped at “${r.failed.step}”: ${r.failed.msg}. Already removed: ${done}. Press “Resume reset” to carry on from there.`;
  }
  async function resetToDayOne() {
    const btn = $("#resetBtn"), status = $("#resetStatus");
    const r = state.reset && state.reset.failed ? state.reset : (state.reset = { removed: {}, done: [] });
    r.failed = null;
    const say = (t) => { const el = $("#resetStatus"); if (el) { el.className = "small"; el.textContent = t; } };
    btn.disabled = true; $("#resetBox").disabled = true;
    const uid = state.user.id;
    let step = "";
    try {
      for (const [t, label] of RESET_STEPS) {
        if (r.done.includes(label)) continue;
        step = label; say(`Deleting ${label}…`);
        // scoped to this user explicitly (RLS also enforces it); a delete that fails part-way removes nothing it didn't confirm
        const gone = await must(sb.from(t).delete().eq("user_id", uid).select("id"));
        r.removed[label] = (r.removed[label] || 0) + (gone ? gone.length : 0);
        r.done.push(label);
      }
      if (!r.done.includes("screenshots")) {
        step = "screenshots"; say("Finding screenshot files…");
        const files = await listShotFiles(uid);          // only this user's folder in the trading-screenshots bucket
        for (let i = 0; i < files.length; i += 50) {
          const batch = files.slice(i, i + 50);
          say(`Deleting screenshots ${Math.min(i + 50, files.length)} of ${files.length}…`);
          const { data, error } = await sb.storage.from(BUCKET).remove(batch);
          if (error) throw error;
          r.removed.screenshots = (r.removed.screenshots || 0) + (data ? data.length : batch.length);
        }
        r.done.push("screenshots");
      }
      step = "seed versions"; say("Restoring the starter watchlist and Learn list…");
      await saveSettings({ seed_assets_v: null, seed_concepts_v: null });   // other settings, defaults and the starting balance are untouched
      const summary = Object.entries(r.removed).map(([k, n]) => countLabel(n, k)).join(", ");
      state.reset = null; state.resetCounts = null; state.selected = null; state.tfGrid = false;
      state.assetFilter = "all"; state.dayFilter = null; state.historyFilter = "all"; shotUrlCache.clear(); clearPending();
      await boot();
      toast(`Back to day one. Removed ${summary}.`);
    } catch (e) {
      console.error(e);
      r.failed = { step, msg: (e && e.message) || String(e) };
      const el = $("#resetStatus"); if (el) { el.className = "small neg"; el.textContent = resetStatusText(); }
      btn.textContent = "Resume reset"; btn.disabled = $("#resetBox").value !== "RESET"; $("#resetBox").disabled = false;
    }
  }

  // ---------- CONCEPTS ----------
  // Phase sections remember open/closed in this browser only (localStorage); Phase 0 is open until you close it, the rest start closed
  const phaseOpen = (n) => { const v = lsGet("phase" + n); return v == null ? n === 0 : v === "1"; };
  function viewConcepts() {
    const hide = lsGet("hideLearned") === "1";
    const learned = state.concepts.filter((c) => c.learned).length;
    const total = state.concepts.length;
    const phaseOf = (c) => (SEED.PHASES.some((p) => p.n === c.phase) ? c.phase : 5);
    return `
      <section>
        <div class="sec-head">
          <div><h2>Concepts to learn</h2><p class="muted">Tick a concept once you can explain it in your own words. Notes save automatically.</p></div>
          <div class="sec-actions">
            <label class="toggle small"><input type="checkbox" data-change="hide-learned" ${hide ? "checked" : ""}> Hide learned</label>
            <div class="pill big">${learned}/${total}</div>
          </div>
        </div>
        <div class="bar"><span style="width:${total ? Math.round((learned / total) * 100) : 0}%"></span></div>
        ${glossaryCard()}
        ${SEED.PHASES.map((p) => {
          const items = state.concepts.filter((c) => phaseOf(c) === p.n);
          if (!items.length) return "";
          const l = items.filter((c) => c.learned).length;
          const shown = items.filter((c) => !hide || !c.learned);
          return `
            <div class="card phase">
              <button type="button" class="phase-head phase-toggle" data-action="toggle-phase" data-n="${p.n}" aria-expanded="${phaseOpen(p.n)}">
                <span class="caret">${phaseOpen(p.n) ? "▾" : "▸"}</span>
                <span class="ptext"><h3>Phase ${p.n} · ${esc(p.title)}</h3><span class="muted small">${esc(p.hint)}</span></span>
                <span class="pill ${l === items.length ? "good" : ""}">${l}/${items.length}</span>
              </button>
              ${phaseOpen(p.n) ? `<ul class="concepts">
                ${shown.map((c) => `
                  <li class="concept ${c.learned ? "learned" : ""}">
                    <label class="ccheck"><input type="checkbox" data-learn="${c.id}" ${c.learned ? "checked" : ""}><span class="box">✓</span></label>
                    <div class="cbody">
                      <div class="ctitle">${esc(c.title)}</div>
                      ${c.detail ? `<div class="small muted">${esc(c.detail)}</div>` : ""}
                      ${c.learned && c.learned_at ? `<div class="xs muted">Learned ${fmtDate(localDate(new Date(c.learned_at)))}</div>` : ""}
                      <details>
                        <summary class="small">${c.notes ? "Your notes" : "Add notes"}</summary>
                        <textarea data-cnotes="${c.id}" rows="3" placeholder="Explain it in your own words, and add a chart example you saw…">${esc(c.notes || "")}</textarea>
                      </details>
                    </div>
                    <button class="icon-btn" data-action="del-concept" data-id="${c.id}" title="Remove concept">×</button>
                  </li>`).join("")}
                ${!shown.length ? `<li class="muted small pad">All learned in this phase ✓</li>` : ""}
              </ul>` : ""}
            </div>`;
        }).join("")}
        <form id="conceptForm" class="card form inline-form">
          <h3>Add your own concept</h3>
          <div class="row3">
            <label class="span2">Concept<input name="title" required maxlength="120" placeholder="e.g. Fibonacci retracements"></label>
            <label>Phase<select name="phase">${SEED.PHASES.map((p) => `<option value="${p.n}">${p.n} · ${esc(p.title)}</option>`).join("")}</select></label>
          </div>
          <label>Short description (optional)<input name="detail" maxlength="300"></label>
          <div class="form-foot"><span></span><button class="btn primary" type="submit">Add concept</button></div>
        </form>
      </section>`;
  }

  // ---------- WORDS I DON'T UNDERSTAND ----------
  function glossaryCard() {
    const open = state.glossary.filter((w) => !w.understood).length;
    const list = [...state.glossary].sort((a, b) => a.understood - b.understood || b.created_at.localeCompare(a.created_at));
    return `
      <div class="card phase" id="glossary">
        <div class="phase-head">
          <div><div class="eyebrow">Words I don't understand</div><h3>Ask Anikait</h3><p class="muted small">Add a word whenever he uses one you don't fully get. Tick it off once you've asked and once it makes sense.</p></div>
          <div class="pill ${state.glossary.length && !open ? "good" : ""}">${open} to understand</div>
        </div>
        <form id="wordForm" class="word-add">
          <input name="term" required maxlength="80" placeholder="Word, e.g. basis" aria-label="Word">
          <input name="context" maxlength="200" placeholder="Where I heard it (optional)" aria-label="Where I heard it">
          <button class="btn primary" type="submit">Add</button>
        </form>
        <ul class="concepts">
          ${list.map((w) => `
            <li class="concept ${w.understood ? "learned" : ""}">
              <div class="cbody">
                <div class="ctitle">${esc(w.term)}</div>
                ${w.context ? `<div class="small muted">Heard: ${esc(w.context)}</div>` : ""}
                <div class="word-ticks">
                  <label class="toggle small"><input type="checkbox" data-wasked="${w.id}" ${w.asked ? "checked" : ""}> Asked Anikait</label>
                  <label class="toggle small"><input type="checkbox" data-wunder="${w.id}" ${w.understood ? "checked" : ""}> Understood</label>
                  <button class="btn ghost small" type="button" data-action="promote-word" data-id="${w.id}">Promote to concept</button>
                </div>
                <details ${w.notes ? "open" : ""}>
                  <summary class="small">${w.notes ? "Notes" : "Add notes"}</summary>
                  <textarea data-wnotes="${w.id}" rows="3" placeholder="What he said, what it means…">${esc(w.notes || "")}</textarea>
                </details>
              </div>
              <button class="icon-btn" data-action="del-word" data-id="${w.id}" title="Remove word">×</button>
            </li>`).join("")}
          ${!list.length ? `<li class="muted small pad">No words yet. Use the box above, or ＋ Word in the header from any tab.</li>` : ""}
        </ul>
      </div>`;
  }

  async function addWord(term, context) {
    term = (term || "").trim(); if (!term) return false;
    try {
      const saved = await must(sb.from("trading_glossary").insert({ term, context: (context || "").trim() || null }).select().single());
      state.glossary.unshift(saved); toast(`Added “${term}”`); return true;
    } catch (e) { fail(e); return false; }
  }
  async function patchWord(id, patch, rerender) {
    const w = state.glossary.find((x) => x.id === id); if (!w) return;
    const prev = Object.fromEntries(Object.keys(patch).map((k) => [k, w[k]]));
    Object.assign(w, patch); if (rerender) render(true);
    try { await must(sb.from("trading_glossary").update(patch).eq("id", id)); }
    catch (e) { Object.assign(w, prev); render(true); fail(e); }
  }
  // Turns a word into a Phase 0 concept (notes and "understood" carry over) and takes it off the words list
  async function promoteWord(id) {
    const w = state.glossary.find((x) => x.id === id); if (!w) return;
    if (state.concepts.some((c) => c.title.toLowerCase() === w.term.toLowerCase())) { toast(`“${w.term}” is already in your Learn list.`, "err"); return; }
    if (!confirm(`Move “${w.term}” into Learn (Phase 0)? Your notes come with it.`)) return;
    const row = {
      phase: 0, title: w.term, detail: w.context ? `Heard: ${w.context}` : null, notes: w.notes || null,
      learned: w.understood, learned_at: w.understood ? new Date().toISOString() : null,
      sort: state.concepts.filter((c) => c.phase === 0).reduce((m, c) => Math.max(m, c.sort), -1) + 1,
    };
    try {
      const saved = await must(sb.from("trading_concepts").insert(row).select().single());
      state.concepts.push(saved);
      await must(sb.from("trading_glossary").delete().eq("id", id));
      state.glossary = state.glossary.filter((x) => x.id !== id);
      render(true); toast(`“${w.term}” is now a concept`);
    } catch (e) { fail(e); }
  }
  // Quick-add from any tab (header ＋ Word)
  function openWordModal() {
    if ($("#wordModal")) return;
    const lb = document.createElement("div");
    lb.className = "lightbox"; lb.id = "wordModal"; lb.style.cursor = "default";
    lb.innerHTML = `
      <form class="card form word-modal">
        <h3>Add a word I don't understand</h3>
        <label>Word<input name="term" required maxlength="80" autocomplete="off"></label>
        <label>Where I heard it (optional)<input name="context" maxlength="200" autocomplete="off"></label>
        <div class="form-foot"><button class="btn ghost" type="button" data-close>Cancel</button><button class="btn primary" type="submit">Add word</button></div>
      </form>`;
    document.body.appendChild(lb);
    const f = lb.querySelector("form");
    lb.addEventListener("click", (e) => { if (e.target === lb || e.target.hasAttribute("data-close")) lb.remove(); });
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(f);
      if (await addWord(fd.get("term").toString(), fd.get("context").toString())) { lb.remove(); if (state.tab === "learn") render(true); }
    });
    f.elements.term.focus();
  }

  async function toggleLearn(id, checked) {
    const c = state.concepts.find((x) => x.id === id); if (!c) return;
    const prev = { learned: c.learned, learned_at: c.learned_at };
    c.learned = checked; c.learned_at = checked ? new Date().toISOString() : null;
    render(true);
    try {
      await must(sb.from("trading_concepts").update({ learned: c.learned, learned_at: c.learned_at }).eq("id", id));
      if (checked) toast(`Learned: ${c.title} ✓`);
    } catch (e) { Object.assign(c, prev); render(true); fail(e); }
  }

  // ---------- JOURNAL ----------
  function journalList() {
    const q = state.journalQuery.trim().toLowerCase();
    const list = state.journal.filter((j) => (!state.dayFilter || j.entry_on === state.dayFilter) && (!q || [j.title, j.body, (j.tags || []).join(" ")].join(" ").toLowerCase().includes(q)));
    if (!list.length) return `<div class="card empty"><p class="muted">${q || state.dayFilter ? "No entries match." : "No entries yet. Your first one can be short."}</p></div>`;
    return list.map((j) => `
      <article class="card entry">
        <div class="entry-head">
          <div><div class="eyebrow">${fmtDate(j.entry_on, { weekday: "long", month: "short", day: "numeric", year: "numeric" })}</div>
            ${j.title ? `<h3>${esc(j.title)}</h3>` : ""}</div>
          <div class="entry-actions">
            ${j.confidence ? `<span class="tag">Confidence ${j.confidence}/5</span>` : ""}
            <button class="btn ghost xs" data-action="edit-journal" data-id="${j.id}">Edit</button>
            <button class="icon-btn" data-action="del-journal" data-id="${j.id}" title="Delete">×</button>
          </div>
        </div>
        <p class="note">${esc(j.body)}</p>
        ${j.tags && j.tags.length ? `<div class="tags">${j.tags.map((t) => `<span class="tag soft">#${esc(t)}</span>`).join("")}</div>` : ""}
      </article>`).join("");
  }

  function viewJournal() {
    const e = state.editingJournal ? state.journal.find((j) => j.id === state.editingJournal) : null;
    return `
      <section>
        <div class="sec-head"><div><h2>Journal</h2><p class="muted">What you learned, what surprised you, what you'll look at next.</p></div></div>
        <form id="journalForm" class="card form">
          <h3>${e ? "Edit entry" : "New entry"}</h3>
          <div class="row3">
            <label>Date<input type="date" name="entry_on" value="${esc(e ? e.entry_on : state.dayFilter || localDate())}" required></label>
            <label class="span2">Title<input name="title" maxlength="140" value="${esc(e ? e.title || "" : "")}" placeholder="e.g. Gold and silver moved together again"></label>
          </div>
          <label>Entry
            <textarea name="body" rows="7" required placeholder="What patterns did I see today?\nWhat surprised me?\nWhich concept clicked (or didn't)?\nWhat do I want to ask Anikait?\nWhat will I watch tomorrow?">${esc(e ? e.body : "")}</textarea>
          </label>
          <div class="row2">
            <label><span class="lbl">Tags <span class="muted small">comma separated</span></span><input name="tags" value="${esc(e ? (e.tags || []).join(", ") : "")}" placeholder="btc, support, question"></label>
            <label><span class="lbl">How confident do I feel? <span class="muted" id="jconfOut">${e && e.confidence ? e.confidence : 3}/5</span></span><input type="range" name="confidence" min="1" max="5" value="${e && e.confidence ? e.confidence : 3}" data-input="jconf"></label>
          </div>
          <div class="form-foot">
            ${e ? `<button class="btn ghost" type="button" data-action="cancel-journal">Cancel</button>` : "<span></span>"}
            <button class="btn primary" type="submit">${e ? "Save changes" : "Save entry"}</button>
          </div>
        </form>
        <div class="sec-head slim"><h3>Past entries <span class="muted small">(${state.journal.length})</span></h3>
          <input class="search" type="search" placeholder="Search entries…" value="${esc(state.journalQuery)}" data-input="journal-search"></div>
        <div id="journalList">${journalList()}</div>
      </section>`;
  }

  async function saveJournal(form) {
    const fd = new FormData(form);
    const row = {
      entry_on: fd.get("entry_on") || localDate(),
      title: (fd.get("title") || "").toString().trim() || null,
      body: (fd.get("body") || "").toString().trim(),
      tags: (fd.get("tags") || "").toString().split(",").map((t) => t.trim().replace(/^#/, "")).filter(Boolean),
      confidence: Number(fd.get("confidence")) || null,
    };
    if (!row.body) { toast("Write something first.", "err"); return; }
    try {
      if (state.editingJournal) {
        row.updated_at = new Date().toISOString();
        const saved = await must(sb.from("trading_journal_entries").update(row).eq("id", state.editingJournal).select().single());
        state.journal = state.journal.map((j) => (j.id === saved.id ? saved : j));
        state.editingJournal = null;
        toast("Entry updated");
      } else {
        const saved = await must(sb.from("trading_journal_entries").insert(row).select().single());
        state.journal.unshift(saved);
        toast("Journal entry saved");
      }
      state.journal.sort((a, b) => (b.entry_on.localeCompare(a.entry_on)) || (b.created_at || "").localeCompare(a.created_at || ""));
      render();
    } catch (e) { fail(e); }
  }

  // ---------- WATCHLIST ----------
  function viewWatchlist() {
    const e = state.editingAsset ? assetById(state.editingAsset) : null;
    const n = activeAssets().length;
    return `
      <section>
        <div class="sec-head">
          <div><h2>Watchlist</h2><p class="muted">Active assets appear on Today's checklist. Aim for 10–20.</p></div>
          <div class="pill big ${n >= 10 && n <= 20 ? "good" : ""}">${n} active</div>
        </div>
        ${state.sel.size ? `<div class="sel-bar card"><b>${state.sel.size}</b> selected <button type="button" class="btn primary sm" data-action="csv" data-scope="selected">⬇ Export selected</button><button type="button" class="btn ghost sm" data-action="sel-clear">Clear</button></div>` : ""}
        <div class="card table-card">
          <table class="wl">
            <thead><tr><th class="selcol" title="Tick stocks to export"></th><th>Active</th><th>Symbol</th><th class="hide-sm">Name</th><th class="hide-sm">Group</th><th class="hide-sm">Chart symbols</th><th></th></tr></thead>
            <tbody>
              ${groupAssets(byGroup(state.assets)).map(([label, xs]) => `
                <tr class="group-row"><th colspan="7"><label class="selall"><input type="checkbox" data-selgroup="${esc(xs[0].category)}" ${xs.every((a) => state.sel.has(a.id)) ? "checked" : ""} aria-label="Tick every stock in ${esc(label)}"></label> ${esc(label)}
                  <button type="button" class="btn ghost xs" data-action="csv" data-scope="group" data-group="${esc(xs[0].category)}" title="Export ${esc(label)} (zip)">⬇ CSV</button></th></tr>
                ${xs.map((a, i) => `
                <tr class="${a.active ? "" : "inactive"}">
                  <td class="selcol"><input type="checkbox" data-sel="${a.id}" ${state.sel.has(a.id) ? "checked" : ""} aria-label="Select ${esc(a.symbol)}"></td>
                  <td><label class="switch"><input type="checkbox" data-active="${a.id}" ${a.active ? "checked" : ""}><span></span></label></td>
                  <td><b>${esc(a.symbol)}</b>${isListed(a) ? "" : ` <span class="tag warn show-sm">Not listed yet</span>`}<div class="xs muted show-sm">${esc(a.name)}</div></td>
                  <td class="hide-sm">${esc(a.name)}${isListed(a) ? "" : ` <span class="tag warn">Not listed yet</span>`}${a.why ? `<div class="xs muted">${esc(a.why)}</div>` : ""}</td>
                  <td class="hide-sm">${esc(CAT_LABEL[a.category] || a.category)}</td>
                  <td class="hide-sm mono xs">TV ${esc(a.tv_symbol || "—")}<br>Yahoo ${esc(a.yahoo_symbol || "—")}<br>MC ${a.mc_url ? "link ✓" : "search"}${isCrypto(a) ? `<br>Coinglass ${a.coinglass_url ? "custom ✓" : "default"}` : ""}</td>
                  <td class="row-actions">
                    <button class="icon-btn" data-action="move" data-id="${a.id}" data-dir="-1" ${i === 0 ? "disabled" : ""} title="Move up">↑</button>
                    <button class="icon-btn" data-action="move" data-id="${a.id}" data-dir="1" ${i === xs.length - 1 ? "disabled" : ""} title="Move down">↓</button>
                    <button class="btn ghost xs" data-action="csv" data-scope="asset" data-id="${a.id}" title="Export ${esc(a.symbol)} metrics (CSV)">⬇ CSV</button>
                    <button class="btn ghost xs" data-action="edit-asset" data-id="${a.id}">Edit</button>
                    <button class="icon-btn" data-action="del-asset" data-id="${a.id}" title="Delete">×</button>
                  </td>
                </tr>`).join("")}`).join("")}
            </tbody>
          </table>
        </div>
        <form id="assetForm" class="card form">
          <h3>${e ? `Edit ${esc(e.symbol)}` : "Add an asset"}</h3>
          <div class="row3">
            <label>Symbol<input name="symbol" required maxlength="20" value="${esc(e ? e.symbol : "")}" placeholder="e.g. AMZN"></label>
            <label>Name<input name="name" required maxlength="80" value="${esc(e ? e.name : "")}" placeholder="e.g. Amazon"></label>
            <label>Group<select name="category">${SEED.CATEGORIES.map(([k, l]) => `<option value="${k}" ${e && e.category === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
          </div>
          <div class="row2">
            <label><span class="lbl">TradingView symbol <span class="muted small">EXCHANGE:TICKER · empty hides the button</span></span><input name="tv_symbol" maxlength="40" value="${esc(e ? e.tv_symbol || "" : "")}" placeholder="e.g. NASDAQ:AMZN"></label>
            <label><span class="lbl">Yahoo Finance symbol <span class="muted small">as shown on Yahoo · empty hides the button</span></span><input name="yahoo_symbol" maxlength="40" value="${esc(e ? e.yahoo_symbol || "" : "")}" placeholder="e.g. AMZN, BTC-USD, TCS.NS"></label>
          </div>
          <div class="row2">
            <label><span class="lbl">Moneycontrol page <span class="muted small">paste the link</span></span><input name="mc_url" type="url" maxlength="300" value="${esc(e ? e.mc_url || "" : "")}" placeholder="https://www.moneycontrol.com/…"></label>
            <label>Why it's on my list<input name="why" maxlength="200" value="${esc(e ? e.why || "" : "")}"></label>
          </div>
          <div class="row2">
            <label><span class="lbl">CoinGecko id <span class="muted small">optional, crypto only · for live prices (e.g. dogecoin)</span></span><input name="coingecko_id" maxlength="60" value="${esc(e ? e.coingecko_id || "" : "")}" placeholder="${esc(TJ_PRICES.COINGECKO[(e ? e.symbol : "").toUpperCase()] || "e.g. dogecoin")}"></label>
          </div>
          <div class="row2">
            <label><span class="lbl">Coinglass link <span class="muted small">optional, crypto only · replaces the default liquidation-map link</span></span><input name="coinglass_url" type="url" maxlength="300" value="${esc(e ? e.coinglass_url || "" : "")}" placeholder="https://www.coinglass.com/…"></label>
          </div>
          <div class="form-foot">
            ${e ? `<button class="btn ghost" type="button" data-action="cancel-asset">Cancel</button>` : "<span class='small muted'>Find each symbol by searching the asset on that site.</span>"}
            <button class="btn primary" type="submit">${e ? "Save changes" : "Add asset"}</button>
          </div>
        </form>
      </section>`;
  }

  async function saveAsset(form) {
    const fd = new FormData(form);
    const txt = (k) => (fd.get(k) || "").toString().trim();
    const row = {
      symbol: txt("symbol").toUpperCase(),
      name: txt("name"),
      category: fd.get("category") || "other",
      tv_symbol: txt("tv_symbol").toUpperCase() || null,
      yahoo_symbol: txt("yahoo_symbol").toUpperCase() || null,
      mc_url: /^https?:\/\//i.test(txt("mc_url")) ? txt("mc_url") : null,
      coinglass_url: /^https?:\/\//i.test(txt("coinglass_url")) ? txt("coinglass_url") : null,
      coingecko_id: txt("coingecko_id").toLowerCase() || null,
      why: txt("why") || null,
    };
    if (!row.symbol || !row.name) return;
    try {
      if (state.editingAsset) {
        const saved = await must(sb.from("trading_assets").update(row).eq("id", state.editingAsset).select().single());
        state.assets = state.assets.map((a) => (a.id === saved.id ? saved : a));
        state.editingAsset = null;
        toast(`${saved.symbol} updated`);
      } else {
        const sort = state.assets.reduce((m, a) => Math.max(m, a.sort), -1) + 1;
        const saved = await must(sb.from("trading_assets").insert({ ...row, sort, active: true }).select().single());
        state.assets.push(saved);
        toast(`${saved.symbol} added to your watchlist`);
      }
      render();
    } catch (e) { fail(e); }
  }

  async function moveAsset(id, dir) {
    const list = byGroup(state.assets);          // same order the Watchlist shows
    const i = list.findIndex((a) => a.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= list.length || list[j].category !== list[i].category) return;   // moves stay inside a group
    [list[i], list[j]] = [list[j], list[i]];
    list.forEach((a, k) => (a.sort = k));
    state.assets = list;
    render(true);
    try {
      await Promise.all(list.map((a) => must(sb.from("trading_assets").update({ sort: a.sort }).eq("id", a.id))));
    } catch (e) { fail(e); }
  }

  // ---------- auth / setup screens ----------
  function renderAuth() {
    app.innerHTML = `
      <div class="auth-wrap">
        <div class="card auth">
          <div class="brand big"><span class="logo">▲</span>Chart Journal</div>
          <p class="muted">Your personal trading-practice journal. Everything is saved to your own Supabase project, so it's all still here next time you start the app.</p>
          <form id="authForm" class="form">
            <label>Email<input name="email" type="email" required autocomplete="email"></label>
            <label>Password<input name="password" type="password" required minlength="6" autocomplete="current-password"></label>
            <div class="row-btns">
              <button class="btn primary" type="submit" value="in">Sign in</button>
              <button class="btn ghost" type="submit" value="up">Create account</button>
            </div>
            <p id="authMsg" class="small muted">First time? Use “Create account” once, then sign in.</p>
          </form>
        </div>
      </div>`;
  }

  async function doAuth(form, mode) {
    const fd = new FormData(form);
    const email = fd.get("email"), password = fd.get("password");
    const msg = $("#authMsg");
    msg.className = "small muted"; msg.textContent = mode === "up" ? "Creating account…" : "Signing in…";
    try {
      if (mode === "up") {
        const data = await must(sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } }));
        if (!data.session) {
          msg.className = "small ok";
          msg.textContent = "Account created. Check your email for a confirmation link (or turn off “Confirm email” in Supabase), then sign in.";
        }
      } else {
        await must(sb.auth.signInWithPassword({ email, password }));
      }
    } catch (e) {
      msg.className = "small err"; msg.textContent = friendly(e);
    }
  }

  function renderSetup() {
    app.innerHTML = `
      <div class="auth-wrap">
        <div class="card auth wide">
          <div class="brand big"><span class="logo">▲</span>Chart Journal</div>
          <h3>One-time setup</h3>
          <ol class="steps">
            <li>Use your shared <b>PersonalOS</b> Supabase project (create it once at <b>supabase.com</b> if it doesn't exist yet).</li>
            <li>Open <b>SQL Editor</b>, paste the contents of <code>supabase/trading_schema.sql</code>, and click <b>Run</b>.</li>
            <li>In <b>Project Settings → API</b>, copy the <b>Project URL</b> and the <b>anon / publishable key</b>.</li>
            <li>Copy <code>config.example.js</code> to <code>config.js</code> in this folder, paste both values in, save, and reload this page.</li>
          </ol>
          <p class="small muted">The full walkthrough is in README.md.</p>
        </div>
      </div>`;
  }

  function renderFatal(msg, canRetry) {
    app.innerHTML = `<div class="auth-wrap"><div class="card auth"><h3>Something's not right</h3><p>${esc(msg)}</p>
      ${canRetry ? `<div class="row-btns"><button class="btn primary" data-action="retry">Try again</button><button class="btn ghost" data-action="signout">Sign out</button></div>` : ""}</div></div>`;
  }

  // ---------- events ----------
  app.addEventListener("click", async (ev) => {
    const src = ev.target.closest("a[data-src]");
    if (src) { const r = $(`#obsForm input[name=source][value="${src.dataset.src}"]`); if (r) r.checked = true; return; }
    const el = ev.target.closest("[data-action]");
    if (!el || el.disabled) return;
    const { action, id } = el.dataset;
    switch (action) {
      case "tab":
        state.tab = el.dataset.tab; lsSet("tab", state.tab);
        if (state.tab === "settings" && !state.resetCountsBusy) state.resetCounts = null;
        ev.preventDefault();
        if (el.dataset.sub) { state.sub = el.dataset.sub; lsSet("sub", state.sub); }
        render(); window.scrollTo(0, 0); break;
      case "sub":
        state.sub = el.dataset.sub; lsSet("sub", state.sub);
        render(); window.scrollTo(0, 0); break;
      case "signout":
        resetTimer(); clearPending(); state.selected = null;
        await sb.auth.signOut(); break;
      case "retry": boot(); break;
      case "csv": csvAction(el); break;
      case "conv-run": runConvert(); break;
      case "conv-use": { const q = $("#tradeForm input[name=quantity]"); if (q) { q.value = el.dataset.qty; updateTradeCalc(); toast(`Quantity set to ${el.dataset.qty}`); } break; }
      case "use-qty": { const q = $("#tradeForm input[name=quantity]"); if (q) { q.value = el.dataset.qty; updateTradeCalc(); } break; }
      case "use-live-entry": { const e = $("#tradeForm input[name=entry_price]"); if (e) { e.value = el.dataset.price; updateTradeCalc(); } break; }
      case "live-obs": useLivePrice(state.selected, $("#obsForm input[name=price]"), $("#liveObsNote")); break;
      case "live-grade": { const o = state.obs.find((x) => x.id === id); if (o) useLivePrice(o.asset_id, $(`[data-checkprice="${id}"]`), el.parentElement.querySelector(".live-note")); break; }
      case "fh-save": { const v = ($("#fhKey").value || "").trim(); TJ_PRICES.setFinnhubKey(v); toast(v ? "Finnhub key saved in this browser" : "Finnhub key removed"); render(true); break; }
      case "fh-clear": TJ_PRICES.setFinnhubKey(""); toast("Finnhub key removed"); render(true); break;
      case "fh-test": testFinnhub(); break;
      case "trades-csv": openExportPop(el, { kind: "trades", title: "Practice trades (zip)" }); break;
      case "notif-enable": try { Promise.resolve(Notification.requestPermission()).then(() => { const b = $("#notifBox"); if (b) b.innerHTML = notifHtml(); }); } catch { /* unsupported */ } break;
      case "stats-clear": state.stats = { asset: "all", tag: "all", from: "", to: "" }; { const c = $("#statsCard"); if (c) c.innerHTML = statsInner(); } break;
      case "goto-obs": {
        const o = state.obs.find((x) => x.id === id); if (!o) break;
        ev.preventDefault();
        state.tab = "progress"; lsSet("tab", "progress"); state.sub = "history"; lsSet("sub", "history");
        state.assetFilter = assetById(o.asset_id) ? o.asset_id : "all"; state.dayFilter = o.observed_on; state.historyFilter = "all";
        render(); window.scrollTo(0, 0); break;
      }
      case "tag-add": addTag(); break;
      case "mistake-add": addMistake(); break;
      case "mistake-del": { const i = Number(el.dataset.i); const l = tradeMistakes().filter((_, k) => k !== i); if (l.length) setMistakes(l); break; }
      case "mistake-reset": setMistakes(null); break;
      case "edit-trade": openEditTrade(id); break;
      case "clear-form": clearDraft(); render(true); toast("Form cleared"); break;
      case "tag-del": { const i = Number(el.dataset.i); const l = setupTags().filter((_, k) => k !== i); if (l.length) setTags(l); break; }
      case "tag-reset": setTags(null); break;
      case "sel-clear": state.sel.clear(); render(true); break;
      case "chip-add": addChip(); break;
      case "chip-del": { const i = Number(el.dataset.i); const c = tfChips().filter((_, k) => k !== i); if (c.length) setChips(c); break; }
      case "chip-move": { const i = Number(el.dataset.i), j = i + Number(el.dataset.d), c = [...tfChips()]; if (j >= 0 && j < c.length) { [c[i], c[j]] = [c[j], c[i]]; setChips(c); } break; }
      case "chip-reset": setChips(null); break;
      case "exp-range": { [state.exp.from, state.exp.to] = rangeFor(el.dataset.r); render(true); break; }
      case "export-all": exportAll(); break;
      case "dl-item": downloadItem(el.dataset.kind, id); break;
      case "reset-day-one": resetToDayOne(); break;
      case "cal-day": state.dayFilter = state.dayFilter === el.dataset.day ? null : el.dataset.day; render(true); break;
      case "clear-day": state.dayFilter = null; render(true); break;
      case "filter-asset": state.assetFilter = id; render(true); break;
      case "toggle-phase": { const k = "phase" + el.dataset.n; lsSet(k, phaseOpen(Number(el.dataset.n)) ? "0" : "1"); render(true); break; }
      case "select":
        if (state.selected !== id) {
          if (state.pendingShots.length && !confirm("You have screenshots that aren't saved yet. Switch anyway?")) return;
          clearPending(); resetTimer(); state.selected = id; state.tfGrid = false; startTimer(); render(true);
        }
        if (window.innerWidth < 900) { const o = $("#observe"); if (o) o.scrollIntoView({ behavior: "smooth", block: "start" }); }
        break;
      case "timer-toggle": timer.running ? pauseTimer() : startTimer(); updateTimerUI(); break;
      case "timer-reset": resetTimer(); updateTimerUI(); break;
      case "toggle-chart": lsSet("chart", chartOn() ? "0" : "1"); render(true); break;
      case "toggle-grid": state.tfGrid = !state.tfGrid; if (state.tfGrid) state.tfList = chosenTimeframes(); render(true); break;
      case "enlarge-tf": enlargeTile(Number(el.dataset.i)); break;
      case "rm-pending": {
        const i = Number(el.dataset.i); const p = state.pendingShots[i];
        if (p) { URL.revokeObjectURL(p.url); state.pendingShots.splice(i, 1); renderPendingShots(); }
        break;
      }
      case "view-shot": openLightbox(el.dataset.path); break;
      case "grade": gradeWithPrice(id); break;
      case "ungrade": {
        const o = state.obs.find((x) => x.id === id); if (!o) return;
        const patch = { check_price: null, checked_on: null, outcome: null };
        try { await must(sb.from("trading_observations").update(patch).eq("id", id)); Object.assign(o, patch); render(true); }
        catch (e) { fail(e); }
        break;
      }
      case "outcome": {
        const o = state.obs.find((x) => x.id === id); if (!o) return;
        const prev = o.outcome; o.outcome = prev === el.dataset.v ? null : el.dataset.v;
        render(true);
        try { await must(sb.from("trading_observations").update({ outcome: o.outcome }).eq("id", id)); }
        catch (e) { o.outcome = prev; render(true); fail(e); }
        break;
      }
      case "del-obs": {
        if (!confirm("Delete this observation and its screenshots?")) return;
        const o = state.obs.find((x) => x.id === id);
        try {
          await must(sb.from("trading_observations").delete().eq("id", id));
          await removeShots(o && o.screenshots);
          state.obs = state.obs.filter((x) => x.id !== id); render(true); toast("Deleted");
        } catch (e) { fail(e); }
        break;
      }
      case "del-trade": {
        const t = state.trades.find((x) => x.id === id);
        if (!t) return;
        const st = practiceStats(), others = state.trades.filter((x) => x.id !== id), after = T.account(st.start, others, (c) => fxRate(c));
        const closedT = t.exit_price != null;
        const go = await appDialog({ title: `Delete the ${t.symbol} practice trade?`,
          body: `<p>${closedT ? `Its result (${fmtMoney(tradeNetUsd(t))}) comes out of your balance, stats and equity curve.` : "It stops being an open trade and its cash is freed."}</p><p>Balance <b>${fmtMoney(st.balance)}</b> → <b>${fmtMoney(after.balance)}</b> · available <b>${fmtMoney(st.available)}</b> → <b>${fmtMoney(after.available)}</b></p><p class="muted">This can't be undone.</p>`,
          buttons: [{ label: "Cancel", value: false }, { label: "Delete trade", primary: true, value: true }] });
        if (!go) return;
        try {
          await must(sb.from("trading_paper_trades").delete().eq("id", id));
          dropAlerts(id);
          await removeShots(t.screenshots);
          state.trades = state.trades.filter((x) => x.id !== id); render(true); toast("Trade deleted");
        } catch (e) { fail(e); }
        break;
      }
      case "del-concept": {
        const c = state.concepts.find((x) => x.id === id);
        if (!c || !confirm(`Remove “${c.title}” from your list?`)) return;
        try { await must(sb.from("trading_concepts").delete().eq("id", id)); state.concepts = state.concepts.filter((x) => x.id !== id); render(true); }
        catch (e) { fail(e); }
        break;
      }
      case "word-modal": openWordModal(); break;
      case "promote-word": promoteWord(id); break;
      case "del-word": {
        const w = state.glossary.find((x) => x.id === id);
        if (!w || !confirm(`Remove “${w.term}” from your words?`)) return;
        try { await must(sb.from("trading_glossary").delete().eq("id", id)); state.glossary = state.glossary.filter((x) => x.id !== id); render(true); }
        catch (e) { fail(e); }
        break;
      }
      case "edit-journal": state.editingJournal = id; render(); window.scrollTo(0, 0); break;
      case "cancel-journal": state.editingJournal = null; render(); break;
      case "del-journal":
        if (!confirm("Delete this journal entry?")) return;
        try { await must(sb.from("trading_journal_entries").delete().eq("id", id)); state.journal = state.journal.filter((j) => j.id !== id); if (state.editingJournal === id) state.editingJournal = null; render(true); toast("Entry deleted"); }
        catch (e) { fail(e); }
        break;
      case "edit-asset": state.editingAsset = id; render(); $("#assetForm").scrollIntoView({ behavior: "smooth" }); break;
      case "cancel-asset": state.editingAsset = null; render(); break;
      case "del-asset": {
        const a = assetById(id);
        const mine = state.obs.filter((o) => o.asset_id === id);
        if (!a || !confirm(`Delete ${a.symbol}?${mine.length ? ` This also deletes its ${mine.length} saved observation${mine.length > 1 ? "s" : ""}. Tip: switch it off instead to keep history.` : ""}`)) return;
        try {
          await must(sb.from("trading_assets").delete().eq("id", id));
          await removeShots(mine.flatMap((o) => o.screenshots || []));
          state.assets = state.assets.filter((x) => x.id !== id);
          state.obs = state.obs.filter((o) => o.asset_id !== id);
          state.trades.forEach((t) => { if (t.asset_id === id) t.asset_id = null; });
          if (state.selected === id) { state.selected = null; clearPending(); }
          render(true); toast(`${a.symbol} deleted`);
        } catch (e) { fail(e); }
        break;
      }
      case "move": moveAsset(id, Number(el.dataset.dir)); break;
    }
  });

  app.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const f = ev.target;
    if (f.id === "authForm") doAuth(f, (ev.submitter && ev.submitter.value) || "in");
    else if (f.id === "obsForm") saveObservation(f);
    else if (f.id === "journalForm") saveJournal(f);
    else if (f.id === "assetForm") saveAsset(f);
    else if (f.id === "tradeForm") openTrade(f);
    else if (f.classList.contains("closeTradeForm")) closeTrade(f);
    else if (f.id === "defaultsForm") (async () => {
      const fd = new FormData(f);
      const num = (k) => (fd.get(k) === "" ? null : Number(fd.get(k)));
      const bal = num("paper_balance");
      if (!(bal > 0)) { toast("Enter a starting balance above 0.", "err"); return; }
      const cur = (fd.get("home_currency") || "").toString().trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(cur)) { toast("Currency should be a 3-letter code, e.g. CAD.", "err"); return; }
      const patch = { paper_balance: bal, home_currency: cur, risk_pct: num("risk_pct"), fee_pct: num("fee_pct"), funding_pct_8h: num("funding_pct_8h") };
      if (["risk_pct", "fee_pct", "funding_pct_8h"].some((k) => patch[k] == null || patch[k] < 0)) { toast("Risk, fee and funding must be numbers, 0 or more.", "err"); return; }
      try { await saveSettings(patch); render(true); toast("Defaults saved"); } catch (e) { fail(e); }
    })();
    else if (f.id === "wordForm") (async () => {
      const fd = new FormData(f);
      if (await addWord(fd.get("term").toString(), fd.get("context").toString())) render(true);
    })();
    else if (f.id === "conceptForm") (async () => {
      const fd = new FormData(f);
      const row = { title: fd.get("title").toString().trim(), detail: (fd.get("detail") || "").toString().trim() || null, phase: Number(fd.get("phase")) || 1 };
      if (!row.title) return;
      row.sort = state.concepts.reduce((m, c) => Math.max(m, c.sort), -1) + 1;
      try { const saved = await must(sb.from("trading_concepts").insert(row).select().single()); state.concepts.push(saved); render(true); toast("Concept added"); }
      catch (e) { fail(e); }
    })();
  });

  app.addEventListener("change", async (ev) => {
    const t = ev.target;
    if (t.closest && t.closest("#tradeForm")) setTimeout(saveDraft, 0);   // keep the open-trade form across reloads (after the handlers below have updated other fields)
    if (t.dataset.shotfile) {
      const files = Array.from(t.files || []); t.value = "";
      if (t.dataset.shotfile === "new") addPending(files); else attachShots(t.dataset.shotfile, files);
      return;
    }
    if (t.name === "timeframes" && state.tfGrid) { state.tfList = chosenTimeframes(); return refreshGrid(); }
    if (t.dataset.learn) return toggleLearn(t.dataset.learn, t.checked);
    if (t.dataset.wasked) return patchWord(t.dataset.wasked, { asked: t.checked }, true);
    if (t.dataset.wunder) return patchWord(t.dataset.wunder, { understood: t.checked }, true);
    if (t.dataset.wnotes) {
      const w = state.glossary.find((x) => x.id === t.dataset.wnotes); if (!w) return;
      const notes = t.value.trim() || null;
      if (notes !== (w.notes || null)) patchWord(w.id, { notes }, false).then(() => toast("Notes saved"));
      return;
    }
    if (t.dataset.cnotes) {
      const c = state.concepts.find((x) => x.id === t.dataset.cnotes); if (!c) return;
      const notes = t.value.trim() || null;
      if (notes === (c.notes || null)) return;
      try { await must(sb.from("trading_concepts").update({ notes }).eq("id", c.id)); c.notes = notes; toast("Notes saved"); }
      catch (e) { fail(e); }
      return;
    }
    if (t.dataset.active) {
      const a = assetById(t.dataset.active); if (!a) return;
      const prev = a.active; a.active = t.checked;
      if (!a.active && state.selected === a.id) { state.selected = null; clearPending(); }
      render(true);
      try { await must(sb.from("trading_assets").update({ active: a.active }).eq("id", a.id)); }
      catch (e) { a.active = prev; render(true); fail(e); }
      return;
    }
    if (t.dataset.input === "trade-asset") {
      const o = $(".trade-other"); if (o) o.hidden = t.value !== "";
      const f = t.form, a = assetById(t.value); f.elements.currency.value = defaultCurrency(a);   // India assets default to INR
      refreshLiveLine(); fillObsPicker(f); ensureFx(f.elements.currency.value); return;
    }
    if (t.dataset.input === "trade-cur") { t.value = t.value.toUpperCase(); if (/^[A-Z]{3}$/.test(t.value)) { ensureFx(t.value); refreshLiveLine(); } return; }
    if (t.classList && t.classList.contains("tagnote")) { saveTagNote(t.dataset.tag, t.value); return; }
    if (t.dataset.input === "tag-help") { updateTradeCalc(); saveDraft(); return; }
    if ((t.name === "ck_htf" || t.name === "ck_liq") && t.closest("#tradeForm")) { updateTradeCalc(); saveDraft(); return; }
    if (t.dataset.change === "stats-filter") { state.stats[t.dataset.k] = t.value; const c = $("#statsCard"); if (c) c.innerHTML = statsInner(); return; }
    if (t.name === "side" && t.closest("#tradeForm")) { updateTradeCalc(); return; }
    if (t.name === "mode" && t.closest("#tradeForm")) { t.form.querySelector(".lev-row").hidden = t.value !== "futures"; updateTradeCalc(); return; }
    if (t.dataset.sel) { t.checked ? state.sel.add(t.dataset.sel) : state.sel.delete(t.dataset.sel); render(true); return; }
    if (t.dataset.selgroup) { state.assets.filter((a) => a.category === t.dataset.selgroup).forEach((a) => (t.checked ? state.sel.add(a.id) : state.sel.delete(a.id))); render(true); return; }
    if (t.dataset.change === "show-practice") {
      try { await saveSettings({ show_practice: t.checked }); applyPracticeSwitch(); render(true); toast(t.checked ? "Practice trades shown" : "Practice trades hidden"); }
      catch (e) { t.checked = !t.checked; fail(e); }
      return;
    }
    if (t.dataset.change === "theme") {
      applyTheme(t.value);
      saveSettings({ theme: t.value }).catch(fail);
      render(true); return;   // re-render so TradingView widgets on Today pick up the new theme
    }
    if (t.id === "expFrom") { state.exp.from = t.value; return; }
    if (t.id === "expTo") { state.exp.to = t.value; return; }
    if (t.dataset.change === "asset-filter") { state.assetFilter = t.value; render(true); }
    if (t.dataset.change === "grade-only") { state.historyFilter = t.checked ? "grade" : "all"; render(true); }
    if (t.dataset.change === "hide-learned") { lsSet("hideLearned", t.checked ? "1" : "0"); render(true); }
  });

  app.addEventListener("input", (ev) => {
    const t = ev.target;
    if (t.id === "resetBox") { const b = $("#resetBtn"); if (b) b.disabled = t.value !== "RESET"; }
    if (t.dataset.input === "conf") $("#confOut").textContent = t.value + "/5";
    if (t.dataset.input === "jconf") $("#jconfOut").textContent = t.value + "/5";
    if (t.dataset.input === "trade-calc") updateTradeCalc();
    if (t.closest && t.closest("#tradeForm")) saveDraft();
    if (t.dataset.input === "px-now") { const v = Number(t.value); if (t.value !== "" && v > 0) state.typed.set(t.dataset.id, { price: v, at: Date.now() }); else state.typed.delete(t.dataset.id); applyLive(); }
    if (t.dataset.input === "close-calc") updateClosePreview(t.form);
    if (t.dataset.input === "journal-search") { state.journalQuery = t.value; $("#journalList").innerHTML = journalList(); hydrateShots(); }
  });

  app.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && ev.target.dataset && ev.target.dataset.checkprice) { ev.preventDefault(); gradeWithPrice(ev.target.dataset.checkprice); }
  });

  // Paste a screenshot straight into the observation you're writing
  document.addEventListener("paste", (ev) => {
    if (state.tab !== "today" || !$("#obsForm")) return;
    const files = Array.from((ev.clipboardData && ev.clipboardData.files) || []);
    if (addPending(files)) ev.preventDefault();
  });
  app.addEventListener("dragover", (ev) => { const d = ev.target.closest("#shotDrop"); if (d) { ev.preventDefault(); d.classList.add("over"); } });
  app.addEventListener("dragleave", (ev) => { const d = ev.target.closest("#shotDrop"); if (d) d.classList.remove("over"); });
  app.addEventListener("drop", (ev) => {
    const d = ev.target.closest("#shotDrop"); if (!d) return;
    ev.preventDefault(); d.classList.remove("over");
    addPending(ev.dataTransfer && ev.dataTransfer.files);
  });
  // alert banner (lives outside #app so it shows on every tab)
  document.addEventListener("click", (ev) => {
    const b = ev.target.closest("#alertHost button[data-akey]"); if (!b) return;
    if (b.dataset.aact === "dismiss") { state.alertItems = state.alertItems.filter((x) => x.key !== b.dataset.akey); renderBanner(); applyLive(); }
    else if (b.dataset.aact === "fix") { const it = state.alertItems.find((x) => x.key === b.dataset.akey); if (it) openEditTrade(it.tradeId); }
    else alertClose(b.dataset.akey);
  });
  // equity curve hover / tap
  app.addEventListener("pointermove", (ev) => { const w = ev.target.closest(".eq-wrap"); if (w) eqHover(ev, w); });
  app.addEventListener("pointerdown", (ev) => { const w = ev.target.closest(".eq-wrap"); if (w) eqHover(ev, w); });
  app.addEventListener("pointerout", (ev) => { const w = ev.target.closest(".eq-wrap"); if (w && !w.contains(ev.relatedTarget)) eqLeave(); });
  document.addEventListener("visibilitychange", () => { if (practiceOn() && document.visibilityState === "visible" && state.user && Date.now() - state.live.at > 30000 && state.trades.some((t) => t.exit_price == null)) pollLive(); });
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") { $$(".lightbox").forEach((l) => l.remove()); closePop(); } });
  document.addEventListener("click", (ev) => { if ($("#expop") && !ev.target.closest("#expop, [data-action=csv], [data-action=trades-csv]")) closePop(); });

  // On "System", follow the OS when it flips between light and dark
  if (window.matchMedia) window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (themePref() === "system" && applyTheme("system") && state.user) render(true); });

  // Keep the checklist honest if the app stays open past midnight
  let lastDay = localDate();
  setInterval(() => { const d = localDate(); if (d !== lastDay) { lastDay = d; if (state.user && !(state.tab === "progress" && state.sub === "journal") && state.tab !== "practice") render(true); } }, 60000);
})();
