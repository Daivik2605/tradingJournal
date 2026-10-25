// Chart Journal: every live price and exchange rate comes from here, and nowhere else.
// Rules: never invent a number. If a price can't be fetched, return { price: null, reason } and let the user type it.
// Sources (all free): CoinGecko (crypto + USDT), Frankfurter/ECB (currency rates), Finnhub (US stocks/ETFs, needs the user's own key).
// Caching: 60 s in memory for prices, 30 min for currency rates, plus the last good value in localStorage so the app can still
// *show* it offline. A stale value is shown as stale ("couldn't refresh") and is never offered to fill a field.
window.TJ_PRICES = (function () {
  const TTL_PRICE = 60 * 1000, TTL_FX = 30 * 60 * 1000, TTL_LIST = 24 * 60 * 60 * 1000, TIMEOUT = 8000;
  const KEY_LS = "tj:finnhub_key", PX_LS = "tj:px:";
  const mem = new Map();        // key -> { price|rate|..., at, source }
  const inflight = new Map();   // key -> Promise (so two callers share one request)

  // CoinGecko ids for common coins. A per-asset `coingecko_id` (Watchlist → Edit) wins over this table.
  const COINGECKO = {
    BTC: "bitcoin", ETH: "ethereum", SOL: "solana", HYPE: "hyperliquid", XRP: "ripple", BNB: "binancecoin", DOGE: "dogecoin",
    ADA: "cardano", AVAX: "avalanche-2", LINK: "chainlink", LTC: "litecoin", SUI: "sui", USDT: "tether",
  };
  const US_EXCHANGES = ["NASDAQ", "NYSE", "AMEX", "NYSEARCA", "ARCA", "BATS"];

  const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
  const hasKey = () => !!(lsGet(KEY_LS) || "").trim();
  const setFinnhubKey = (k) => { k = (k || "").trim(); if (k) lsSet(KEY_LS, k); else { try { localStorage.removeItem(KEY_LS); } catch { /* ignore */ } } };
  const getFinnhubKey = () => (lsGet(KEY_LS) || "").trim();

  async function getJson(url) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), TIMEOUT);
    try {
      const r = await fetch(url, { signal: ctl.signal });
      if (!r.ok) { const e = new Error(`HTTP ${r.status}`); e.status = r.status; throw e; }
      return await r.json();
    } finally { clearTimeout(t); }
  }
  const why = (e) => (e && e.name === "AbortError" ? "timed out" : e && e.status === 429 ? "rate limit reached, try again in a minute" : e && e.status === 401 ? "the key was rejected" : (e && e.message) || "network error");

  // cache helpers: fresh value from memory, else the last good value from localStorage (marked stale)
  const fresh = (key, ttl) => { const c = mem.get(key); return c && Date.now() - c.at < ttl ? c : null; };
  const lastGood = (key) => { const c = mem.get(key); if (c) return c; try { const s = JSON.parse(lsGet(PX_LS + key) || "null"); return s && typeof s.at === "number" ? s : null; } catch { return null; } };
  const remember = (key, v) => { mem.set(key, v); lsSet(PX_LS + key, JSON.stringify(v)); };
  function once(key, fn) {
    if (inflight.has(key)) return inflight.get(key);
    const p = fn().finally(() => inflight.delete(key)); inflight.set(key, p); return p;
  }

  // ---------- which source can price this asset? ----------
  function sourceFor(a) {
    if (!a) return { kind: "none", reason: "No asset chosen." };
    const sym = (a.symbol || "").toUpperCase();
    if (!a.tv_symbol && !a.yahoo_symbol) return { kind: "none", reason: `${sym} isn't listed yet, so it has no price.` };
    if (sym === "BTC.D") return { kind: "none", reason: "BTC.D is a share of the market, not a price." };
    if (a.category === "crypto") {
      const id = (a.coingecko_id || "").trim().toLowerCase() || COINGECKO[sym];
      return id ? { kind: "coingecko", id } : { kind: "none", reason: `No CoinGecko id for ${sym}. Add one in Watchlist → Edit, or type the price.` };
    }
    const ex = (a.tv_symbol || "").split(":")[0].toUpperCase(), tick = (a.tv_symbol || "").split(":")[1];
    if (tick && US_EXCHANGES.includes(ex)) return { kind: "finnhub", symbol: tick.toUpperCase() };
    if (ex === "TVC" || ex === "NYMEX") return { kind: "none", reason: `No free live price for ${sym} (index or commodity). Type the price.` };
    if (a.category === "india") return { kind: "none", reason: `No free live price for Indian stocks (${sym}). Type the price.` };
    return { kind: "none", reason: `No free live price source for ${sym}. Type the price.` };
  }

  // ---------- CoinGecko (batched: one call for all the ids you ask for) ----------
  // returns { [id]: { price, at, source, stale? } | { price: null, reason } }
  async function getCoins(ids) {
    ids = [...new Set(ids)];
    const out = {}; const need = [];
    for (const id of ids) { const c = fresh("cg:" + id, TTL_PRICE); if (c) out[id] = c; else need.push(id); }
    if (need.length) {
      try {
        const data = await once("cg:" + need.sort().join(","), () => getJson(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(need.join(","))}&vs_currencies=usd`));
        const at = Date.now();
        for (const id of need) {
          const p = data && data[id] && data[id].usd;
          if (typeof p === "number" && p > 0) { out[id] = { price: p, at, source: "CoinGecko", currency: "USD" }; remember("cg:" + id, out[id]); }
          else out[id] = { price: null, reason: `CoinGecko has no price for “${id}”. Check the id, or type the price.` };
        }
      } catch (e) {
        for (const id of need) {
          const g = lastGood("cg:" + id);
          out[id] = g ? { ...g, stale: true, reason: `Couldn't refresh from CoinGecko (${why(e)}). Showing the last known value.` } : { price: null, reason: `Couldn't fetch the price from CoinGecko (${why(e)}). Type it in.` };
        }
      }
    }
    return out;
  }
  const getUsdt = async () => (await getCoins(["tether"])).tether;

  // ---------- Finnhub (US stocks and ETFs; needs the user's own free key) ----------
  async function getFinnhub(symbol) {
    const key = getFinnhubKey();
    if (!key) return { price: null, needsKey: true, reason: "Add your free Finnhub key in Settings for stock prices, or type the price." };
    const ck = "fh:" + symbol; const c = fresh(ck, TTL_PRICE); if (c) return c;
    try {
      const d = await once(ck, () => getJson(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(key)}`));
      if (!d || typeof d.c !== "number" || d.c <= 0) return { price: null, reason: `Finnhub has no quote for ${symbol}. Type the price.` };
      const v = { price: d.c, at: Date.now(), source: "Finnhub", currency: "USD" }; remember(ck, v); return v;
    } catch (e) {
      const g = lastGood(ck);
      return g ? { ...g, stale: true, reason: `Couldn't refresh from Finnhub (${why(e)}). Showing the last known value.` } : { price: null, reason: `Couldn't fetch the price from Finnhub (${why(e)}). Type it in.` };
    }
  }

  // The one call the app uses for an asset's price. { price, at, source, currency, stale? } or { price: null, reason }
  async function getPrice(asset) {
    const s = sourceFor(asset);
    if (s.kind === "coingecko") return (await getCoins([s.id]))[s.id];
    if (s.kind === "finnhub") return getFinnhub(s.symbol);
    return { price: null, reason: s.reason, none: true };
  }

  // Several assets at once (the live P&L refresh): all CoinGecko ids go in ONE request, Finnhub is one request per symbol.
  // Same cache and TTL as getPrice. Returns Map(asset.id → the same result getPrice gives).
  async function getPrices(assets) {
    const out = new Map(), cg = new Map(), fh = new Map();
    for (const a of assets) {
      const s = sourceFor(a);
      if (s.kind === "coingecko") cg.set(a.id, s.id);
      else if (s.kind === "finnhub") fh.set(a.id, s.symbol);
      else out.set(a.id, { price: null, reason: s.reason, none: true });
    }
    const [coins, quotes] = await Promise.all([
      cg.size ? getCoins([...cg.values()]) : Promise.resolve({}),
      Promise.all([...new Set(fh.values())].map(async (sym) => [sym, await getFinnhub(sym)])),
    ]);
    const q = Object.fromEntries(quotes);
    for (const [aid, id] of cg) out.set(aid, coins[id]);
    for (const [aid, sym] of fh) out.set(aid, q[sym]);
    return out;
  }

  // ---------- Frankfurter (ECB rates) ----------
  // 1 `from` = rate × `to`. `date` (YYYY-MM-DD) asks for that day's rate (weekends fall back to the last working day).
  async function fiatRate(from, to, date) {
    from = (from || "").toUpperCase(); to = (to || "").toUpperCase();
    if (from === to) return { rate: 1, at: Date.now(), source: "same currency", date: null };
    const ck = `fx:${from}:${to}:${date || "latest"}`; const c = fresh(ck, date ? TTL_FX * 48 : TTL_FX); if (c) return c;
    try {
      const d = await once(ck, () => getJson(`https://api.frankfurter.dev/v1/${date || "latest"}?base=${from}&symbols=${to}`));
      const r = d && d.rates && d.rates[to];
      if (!(typeof r === "number" && r > 0)) return { rate: null, reason: `Frankfurter has no ${from}→${to} rate. Type it in.` };
      const v = { rate: r, at: Date.now(), source: "Frankfurter (ECB)", date: d.date }; remember(ck, v); return v;
    } catch (e) {
      const g = lastGood(ck);
      return g ? { ...g, stale: true, reason: `Couldn't refresh the ${from}→${to} rate (${why(e)}). Showing the last known value.` } : { rate: null, reason: `Couldn't fetch the ${from}→${to} rate (${why(e)}). Type it in.` };
    }
  }
  const FALLBACK_CURRENCIES = { USD: "US Dollar", CAD: "Canadian Dollar", INR: "Indian Rupee", EUR: "Euro", GBP: "British Pound" };
  async function currencies() {
    const c = fresh("fx:list", TTL_LIST); if (c) return c.list;
    try {
      const d = await once("fx:list", () => getJson("https://api.frankfurter.dev/v1/currencies"));
      if (d && typeof d === "object") { remember("fx:list", { list: d, at: Date.now() }); return d; }
    } catch { /* fall through to the last good list */ }
    const g = lastGood("fx:list"); return g && g.list ? g.list : FALLBACK_CURRENCIES;
  }

  const fmtAt = (at) => { const d = new Date(at); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
  const clear = () => { mem.clear(); inflight.clear(); };   // for tests

  return { sourceFor, getPrice, getPrices, getCoins, getUsdt, fiatRate, currencies, hasKey, setFinnhubKey, getFinnhubKey, fmtAt, clear, COINGECKO };
})();
