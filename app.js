/* Chart Journal — local trading-practice journal backed by Supabase. */
(function () {
  "use strict";

  const CFG = window.TJ_CONFIG || {};
  const SEED = window.TJ_SEED;
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
    if (/does not exist|Could not find the table|schema cache|column .* not found/i.test(m)) return "Tables are missing or out of date. Run supabase/trading_schema.sql in the Supabase SQL Editor (shared PersonalOS project), then reload.";
    if (/Bucket not found/i.test(m)) return "The trading-screenshots storage bucket isn't set up. Run supabase/trading_schema.sql again in the Supabase SQL Editor.";
    if (/duplicate key|unique/i.test(m)) return "That already exists (symbols, concept titles and words must be unique).";
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
    resetCounts: null, resetCountsBusy: false,   // "what will be deleted" numbers, fetched when Settings opens
    reset: null,                 // {removed: {step: n}, done: [steps], failed: {step, msg}} while a reset is resumable
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
      render();
    } catch (e) {
      console.error(e);
      renderFatal(friendly(e), true);
    }
  }

  // ---------- shell ----------
  const TABS = [
    ["progress", "Progress"], ["watchlist", "Watchlist"], ["today", "Today"], ["learn", "Learn"], ["practice", "Practice trades"],
  ];
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
    if (!VIEWS[state.tab]) state.tab = "today";
    if (!SUBS.some(([k]) => k === state.sub)) state.sub = "overview";
    const due = state.obs.filter(readyToGrade).length;
    app.innerHTML = `
      <header class="top">
        <div class="brand"><span class="logo">▲</span>Chart Journal</div>
        <nav class="tabs">${TABS.map(([k, l]) =>
          `<button class="tab ${state.tab === k ? "on" : ""}" data-action="tab" data-tab="${k}">${l}${k === "progress" && due ? ` <span class="badge" title="Guesses ready to grade">${due}</span>` : ""}</button>`).join("")}</nav>
        <button class="tab gear addword" data-action="word-modal" title="Add a word I don't understand">＋ <span class="gear-l">Word</span></button>
        <button class="tab gear ${state.tab === "settings" ? "on" : ""}" data-action="tab" data-tab="settings" title="Settings" aria-label="Settings">⚙ <span class="gear-l">Settings</span></button>
      </header>
      <main class="main">${VIEWS[state.tab]()}</main>`;
    restoreObsForm(snap);
    if (keepScroll) window.scrollTo(0, y);
    if (state.tab === "today" && state.selected && chartOn()) { const a = assetById(state.selected); if (a && a.tv_symbol) mountChart(a); }
    if (state.tab === "today" && state.selected && state.tfGrid) { const a = assetById(state.selected); if (a) mountGrid(a); }
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
            <label>Current price<input name="price" type="number" step="any" inputmode="decimal" placeholder="e.g. 245.30"></label>
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
      prediction: str("prediction"), confidence: num("confidence"), screenshots: [],
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
  const tradePnl = (t) => (t.exit_price == null ? null : (t.side === "short" ? t.entry_price - t.exit_price : t.exit_price - t.entry_price) * t.quantity);
  const tradeRisk = (t) => (t.stop_loss == null ? null : Math.abs(t.entry_price - t.stop_loss) * t.quantity);
  const tradeR = (t) => { const p = tradePnl(t), r = tradeRisk(t); return p == null || !r ? null : p / r; };

  function practiceStats() {
    const closed = state.trades.filter((t) => t.exit_price != null);
    const realized = closed.reduce((s, t) => s + tradePnl(t), 0);
    const wins = closed.filter((t) => tradePnl(t) > 0).length;
    const rs = closed.map(tradeR).filter((r) => r != null);
    const start = Number(state.settings.paper_balance) || 10000;
    return {
      start, realized, balance: start + realized, closed, wins,
      open: state.trades.filter((t) => t.exit_price == null),
      winRate: closed.length ? (wins / closed.length) * 100 : null,
      avgR: rs.length ? rs.reduce((s, r) => s + r, 0) / rs.length : null,
      noStop: state.trades.filter((t) => t.stop_loss == null).length,
    };
  }

  function viewPractice() {
    const st = practiceStats();
    const active = activeAssets();
    const stat = (v, l, sub = "", cls = "") => `<div class="card stat"><div class="stat-v ${cls}">${v}</div><div class="stat-l">${l}</div>${sub ? `<div class="xs muted">${sub}</div>` : ""}</div>`;
    return `
      <section>
        <div class="sec-head">
          <div><h2>Practice trades</h2>
            <p class="muted">Fake money only. Use it once you reach phase 4: decide your stop before you enter, and risk no more than 1–2% of the balance per trade.</p></div>
        </div>
        <div class="stats">
          ${stat(fmtMoney(st.balance), "practice balance", `started at ${fmtMoney(st.start)}`)}
          ${stat(fmtMoney(st.realized), "profit / loss", `${fmtPct((st.realized / st.start) * 100)} overall`, sign(st.realized))}
          ${stat(st.closed.length ? Math.round(st.winRate) + "%" : "—", "win rate", `${st.wins} of ${st.closed.length} closed trades`)}
          ${stat(st.avgR == null ? "—" : (st.avgR > 0 ? "+" : "") + st.avgR.toFixed(2) + "R", "average result in R", "R = what you risked. +2R means you made twice your risk.", st.avgR == null ? "" : sign(st.avgR))}
          ${stat(st.open.length, "open trades", st.noStop ? `${st.noStop} without a stop loss ⚠` : "all have stop losses")}
        </div>

        <form id="tradeForm" class="card form">
          <h3>Open a practice trade</h3>
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
          <fieldset><legend>Direction</legend>
            <div class="chips">${chip("radio", "side", "long", "Long (betting it goes up)", true)}${chip("radio", "side", "short", "Short (betting it goes down)")}</div>
          </fieldset>
          <div class="row2">
            <label>Entry price<input name="entry_price" type="number" step="any" min="0" inputmode="decimal" required data-input="trade-calc"></label>
            <label><span class="lbl">Quantity <span class="muted small">shares or coins</span></span><input name="quantity" type="number" step="any" min="0" inputmode="decimal" required data-input="trade-calc"></label>
          </div>
          <div class="row2">
            <label><span class="lbl">Stop loss <span class="muted small">exit here if wrong</span></span><input name="stop_loss" type="number" step="any" min="0" inputmode="decimal" data-input="trade-calc"></label>
            <label><span class="lbl">Target <span class="muted small">take profit here</span></span><input name="take_profit" type="number" step="any" min="0" inputmode="decimal" data-input="trade-calc"></label>
          </div>
          <div id="tradeCalc" class="calc small muted">Fill in entry, quantity and stop to see your risk.</div>
          <label>Why are you taking this trade?
            <textarea name="reason" rows="2" placeholder="e.g. Bounced off support at 100k on rising volume, weekly trend still up"></textarea>
          </label>
          <div class="form-foot"><span></span><button class="btn primary" type="submit">Open trade</button></div>
        </form>

        <h3 class="list-head">Open trades <span class="muted small">(${st.open.length})</span></h3>
        ${st.open.length ? st.open.map(openTradeCard).join("") : `<div class="card empty slim"><p class="muted">No open trades.</p></div>`}

        <h3 class="list-head">Closed trades <span class="muted small">(${st.closed.length})</span></h3>
        ${st.closed.length ? st.closed.map(closedTradeCard).join("") : `<div class="card empty slim"><p class="muted">Closed trades and their results show up here.</p></div>`}

        <p class="small muted">Starting practice balance: <b>${fmtMoney(st.start)}</b>. Change it in <a href="#" data-action="tab" data-tab="settings">Settings</a>.</p>
      </section>`;
  }

  const tradeHead = (t) => `
    <div class="obs-top">
      <span class="sym">${esc(t.symbol)}</span>
      <span class="tag ${t.side === "long" ? "trend-up" : "trend-down"}">${t.side === "long" ? "Long ↗" : "Short ↘"}</span>
      <span class="small">${fmtNum(t.quantity)} @ ${fmtNum(t.entry_price)}</span>
      <span class="meta-right"><span class="small muted">${fmtDate(t.opened_on)}${t.closed_on ? ` → ${fmtDate(t.closed_on)}` : ""}</span>
      <button class="icon-btn" data-action="dl-item" data-kind="trade" data-id="${t.id}" title="Download this trade (zip)" aria-label="Download">⬇</button>
      <button class="icon-btn" data-action="del-trade" data-id="${t.id}" title="Delete">×</button></span>
    </div>
    <div class="small">Stop <b>${fmtNum(t.stop_loss)}</b> · Target <b>${fmtNum(t.take_profit)}</b>${tradeRisk(t) != null ? ` · Risk ${fmtMoney(tradeRisk(t))}` : ` · <span class="neg">no stop loss</span>`}</div>
    ${t.reason ? `<p class="note">${esc(t.reason)}</p>` : ""}`;

  function openTradeCard(t) {
    return `
      <article class="card trade">
        ${tradeHead(t)}
        ${shotStrip(t.screenshots, "trade", t.id)}
        <details class="close-trade">
          <summary class="small">Close this trade</summary>
          <form class="form closeTradeForm" data-id="${t.id}">
            <div class="row3">
              <label>Exit price<input name="exit_price" type="number" step="any" min="0" inputmode="decimal" required></label>
              <label>Date<input type="date" name="closed_on" value="${localDate()}" required></label>
              <label>Why did you exit?
                <select name="exit_reason"><option value="target">Hit my target</option><option value="stop">Hit my stop loss</option><option value="manual">Changed my mind</option><option value="time">Ran out of time</option></select>
              </label>
            </div>
            <fieldset><legend>How did you feel?</legend>
              <div class="chips">${EMOTIONS.map((e) => chip("radio", "emotion", e, e)).join("")}</div>
            </fieldset>
            <label>What did you learn?<textarea name="lessons" rows="2"></textarea></label>
            <div class="form-foot"><span></span><button class="btn primary" type="submit">Close trade</button></div>
          </form>
        </details>
      </article>`;
  }

  function closedTradeCard(t) {
    const p = tradePnl(t), r = tradeR(t);
    const pct = ((t.side === "short" ? t.entry_price - t.exit_price : t.exit_price - t.entry_price) / t.entry_price) * 100;
    const why = { target: "hit target", stop: "hit stop", manual: "closed early", time: "ran out of time" }[t.exit_reason] || "";
    return `
      <article class="card trade closed">
        ${tradeHead(t)}
        <div class="result">
          <span class="big ${sign(p)}">${fmtMoney(p)}</span>
          <span class="${sign(pct)}">${fmtPct(pct)}</span>
          ${r != null ? `<span class="tag ${sign(r) === "pos" ? "right" : sign(r) === "neg" ? "wrong" : ""}">${r > 0 ? "+" : ""}${r.toFixed(2)}R</span>` : ""}
          <span class="small muted">exit ${fmtNum(t.exit_price)}${why ? ` · ${why}` : ""}${t.emotion ? ` · felt ${esc(t.emotion)}` : ""}</span>
        </div>
        ${t.lessons ? `<p class="note small">💡 ${esc(t.lessons)}</p>` : ""}
        ${shotStrip(t.screenshots, "trade", t.id)}
      </article>`;
  }

  function updateTradeCalc() {
    const f = $("#tradeForm"); const out = $("#tradeCalc"); if (!f || !out) return;
    const n = (k) => { const v = f.elements[k] && f.elements[k].value; return v === "" || v == null ? null : Number(v); };
    const entry = n("entry_price"), qty = n("quantity"), stop = n("stop_loss"), tgt = n("take_profit");
    const side = (f.querySelector("[name=side]:checked") || {}).value || "long";
    if (!entry || !qty) { out.className = "calc small muted"; out.innerHTML = "Fill in entry, quantity and stop to see your risk."; return; }
    const bal = practiceStats().balance;
    const size = entry * qty;
    const parts = [`Position size <b>${fmtMoney(size)}</b> (${((size / bal) * 100).toFixed(1)}% of balance)`];
    let warn = false;
    if (stop != null) {
      const wrongSide = side === "long" ? stop >= entry : stop <= entry;
      const risk = Math.abs(entry - stop) * qty, riskPct = (risk / bal) * 100;
      if (wrongSide) { parts.push(`<b class="neg">Stop is on the wrong side of entry for a ${side}</b>`); warn = true; }
      else {
        parts.push(`Risk <b>${fmtMoney(risk)}</b> = <b class="${riskPct > 2 ? "neg" : ""}">${riskPct.toFixed(2)}%</b> of balance${riskPct > 2 ? " (over the 2% rule)" : ""}`);
        if (riskPct > 2) warn = true;
        if (tgt != null) {
          const reward = Math.abs(tgt - entry) * qty, rr = reward / risk;
          parts.push(`Reward ${fmtMoney(reward)} · reward/risk <b class="${rr < 2 ? "neg" : "pos"}">${rr.toFixed(2)} : 1</b>${rr < 2 ? " (aim for 2 or more)" : ""}`);
        }
      }
    } else { parts.push(`<b class="neg">No stop loss yet</b>`); warn = true; }
    out.className = "calc small " + (warn ? "warn" : "okbox");
    out.innerHTML = parts.join("<br>");
  }

  async function openTrade(form) {
    const fd = new FormData(form);
    const n = (k) => { const v = fd.get(k); return v === "" || v == null ? null : Number(v); };
    const asset = assetById(fd.get("asset_id"));
    const symbol = asset ? asset.symbol : (fd.get("symbol") || "").toString().trim().toUpperCase();
    if (!symbol) { toast("Type a symbol for this trade.", "err"); return; }
    const row = {
      asset_id: asset ? asset.id : null, symbol, side: fd.get("side") || "long", opened_on: fd.get("opened_on") || localDate(),
      entry_price: n("entry_price"), quantity: n("quantity"), stop_loss: n("stop_loss"), take_profit: n("take_profit"),
      reason: (fd.get("reason") || "").toString().trim() || null, screenshots: [],
    };
    if (!(row.entry_price > 0) || !(row.quantity > 0)) { toast("Entry price and quantity must be above 0.", "err"); return; }
    if (row.stop_loss != null && (row.side === "long" ? row.stop_loss >= row.entry_price : row.stop_loss <= row.entry_price)) {
      toast(`For a ${row.side}, the stop loss must be ${row.side === "long" ? "below" : "above"} the entry price.`, "err"); return;
    }
    try {
      const saved = await must(sb.from("trading_paper_trades").insert(row).select().single());
      state.trades.unshift(saved); render(true);
      toast(`Opened ${row.side} ${symbol}${row.stop_loss == null ? ". Tip: add a stop loss next time" : ""}`);
    } catch (e) { fail(e); }
  }

  async function closeTrade(form) {
    const id = form.dataset.id;
    const t = state.trades.find((x) => x.id === id); if (!t) return;
    const fd = new FormData(form);
    const patch = {
      exit_price: Number(fd.get("exit_price")), closed_on: fd.get("closed_on") || localDate(),
      exit_reason: fd.get("exit_reason") || "manual", emotion: fd.get("emotion") || null,
      lessons: (fd.get("lessons") || "").toString().trim() || null,
    };
    if (!(patch.exit_price > 0)) { toast("Type the exit price.", "err"); return; }
    try {
      await must(sb.from("trading_paper_trades").update(patch).eq("id", id));
      Object.assign(t, patch); render(true);
      toast(`Closed ${t.symbol}: ${fmtMoney(tradePnl(t))}`);
    } catch (e) { fail(e); }
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
          <select data-change="asset-filter" class="select" aria-label="Asset">
            <option value="all">All assets</option>
            ${byGroup(state.assets).map((x) => `<option value="${x.id}" ${state.assetFilter === x.id ? "selected" : ""}>${esc(x.symbol)} · ${esc(x.name)}</option>`).join("")}
          </select>
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

        <form id="defaultsForm" class="card form">
          <h3>Defaults</h3>
          <p class="muted small">Used by practice trades. Saved to your account.</p>
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
  function toCsv(rows) {
    const cols = [...rows.reduce((set, r) => { Object.keys(r).forEach((k) => set.add(k)); return set; }, new Set())];
    return "﻿" + [cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\r\n") + "\r\n";
  }
  function download(blob, name) {
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }
  async function fetchAllRows(table, dateCol, from, to) {
    const out = []; const size = 1000;
    for (let i = 0; ; i += size) {
      let q = sb.from(table).select("*");
      if (dateCol && from) q = q.gte(dateCol, from);
      if (dateCol && to) q = q.lte(dateCol, to);
      const part = await must(q.order(dateCol || "created_at", { ascending: true }).order("id", { ascending: true }).range(i, i + size - 1));
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
    const from = state.exp.from || null, to = state.exp.to || null;
    const btns = $$("[data-action=export-all]"); btns.forEach((b) => (b.disabled = true));
    const prog = (t) => { const el = $("#expProgress"); if (el) el.textContent = t; };
    try {
      prog("Reading your data…");
      const T = [
        ["trading_assets", null], ["trading_observations", "observed_on"], ["trading_concepts", null], ["trading_journal_entries", "entry_on"],
        ["trading_paper_trades", "opened_on"], ["trading_glossary", null], ["trading_settings", null],
      ];
      const zip = new window.JSZip(); const data = {};
      for (const [t, col] of T) {
        prog(`Reading ${t.replace("trading_", "")}…`);
        data[t] = await fetchAllRows(t, col, from, to);
        zip.file(`data/${t}.json`, JSON.stringify(data[t], null, 2));
        zip.file(`data/${t}.csv`, toCsv(data[t]));
      }
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
        ...T.map(([t]) => `  ${t}: ${data[t].length} rows`), "",
        `screenshots/  ${added} image${added === 1 ? "" : "s"} (named <date>_<id>.<ext>; the rows' "screenshots" column holds the original storage paths).`,
        missing.length ? `\nMISSING screenshots (${missing.length}), these could not be downloaded and are not in the zip:\n${missing.map((m) => "  - " + m).join("\n")}` : "No screenshots are missing.", "",
        "Times are UTC ISO timestamps; days (observed_on etc.) are local calendar dates.",
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
      add("Closed", r.closed_on); add("Exit", r.exit_price); add("Exit reason", r.exit_reason); add("Felt", r.emotion);
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
        <div class="card table-card">
          <table class="wl">
            <thead><tr><th>Active</th><th>Symbol</th><th class="hide-sm">Name</th><th class="hide-sm">Group</th><th class="hide-sm">Chart symbols</th><th></th></tr></thead>
            <tbody>
              ${groupAssets(byGroup(state.assets)).map(([label, xs]) => `
                <tr class="group-row"><th colspan="6">${esc(label)}</th></tr>
                ${xs.map((a, i) => `
                <tr class="${a.active ? "" : "inactive"}">
                  <td><label class="switch"><input type="checkbox" data-active="${a.id}" ${a.active ? "checked" : ""}><span></span></label></td>
                  <td><b>${esc(a.symbol)}</b>${isListed(a) ? "" : ` <span class="tag warn show-sm">Not listed yet</span>`}<div class="xs muted show-sm">${esc(a.name)}</div></td>
                  <td class="hide-sm">${esc(a.name)}${isListed(a) ? "" : ` <span class="tag warn">Not listed yet</span>`}${a.why ? `<div class="xs muted">${esc(a.why)}</div>` : ""}</td>
                  <td class="hide-sm">${esc(CAT_LABEL[a.category] || a.category)}</td>
                  <td class="hide-sm mono xs">TV ${esc(a.tv_symbol || "—")}<br>Yahoo ${esc(a.yahoo_symbol || "—")}<br>MC ${a.mc_url ? "link ✓" : "search"}${isCrypto(a) ? `<br>Coinglass ${a.coinglass_url ? "custom ✓" : "default"}` : ""}</td>
                  <td class="row-actions">
                    <button class="icon-btn" data-action="move" data-id="${a.id}" data-dir="-1" ${i === 0 ? "disabled" : ""} title="Move up">↑</button>
                    <button class="icon-btn" data-action="move" data-id="${a.id}" data-dir="1" ${i === xs.length - 1 ? "disabled" : ""} title="Move down">↓</button>
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
      case "chip-add": addChip(); break;
      case "chip-del": { const i = Number(el.dataset.i); const c = tfChips().filter((_, k) => k !== i); if (c.length) setChips(c); break; }
      case "chip-move": { const i = Number(el.dataset.i), j = i + Number(el.dataset.d), c = [...tfChips()]; if (j >= 0 && j < c.length) { [c[i], c[j]] = [c[j], c[i]]; setChips(c); } break; }
      case "chip-reset": setChips(null); break;
      case "exp-range": {
        const d = new Date(), p = (x) => `${x.getFullYear()}-${pad2(x.getMonth() + 1)}-${pad2(x.getDate())}`;
        const r = el.dataset.r; state.exp.to = r === "all" ? "" : p(d);
        if (r === "all") state.exp.from = ""; else { const f = new Date(d); f.setDate(f.getDate() - (r === "30" ? 29 : (d.getDay() + 6) % 7)); state.exp.from = p(f); }
        render(true); break;
      }
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
        if (!t || !confirm(`Delete the ${t.symbol} practice trade?`)) return;
        try {
          await must(sb.from("trading_paper_trades").delete().eq("id", id));
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
    if (t.dataset.input === "trade-asset") { const o = $(".trade-other"); if (o) o.hidden = t.value !== ""; return; }
    if (t.name === "side" && t.closest("#tradeForm")) { updateTradeCalc(); return; }
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
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") $$(".lightbox").forEach((l) => l.remove()); });

  // On "System", follow the OS when it flips between light and dark
  if (window.matchMedia) window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (themePref() === "system" && applyTheme("system") && state.user) render(true); });

  // Keep the checklist honest if the app stays open past midnight
  let lastDay = localDate();
  setInterval(() => { const d = localDate(); if (d !== lastDay) { lastDay = d; if (state.user && !(state.tab === "progress" && state.sub === "journal") && state.tab !== "practice") render(true); } }, 60000);
})();
