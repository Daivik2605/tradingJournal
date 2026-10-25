// Chart Journal: pure practice-trade maths and rules (no DOM, no network). Moved out of app.js in phase 5c so node can test it.
// Loaded as window.TJ_TRADE in the browser and with require() in node (tests/trade.test.js).
(function (root) {
  const MAINT_PCT = 0.5;        // futures maintenance margin, percent (the liquidation price is an estimate, not an exchange's number)
  const TYPO_WARN_PCT = 10;     // entry this far from the live price: overridable warning
  const TYPO_FLAG_PCT = 50;     // an existing open trade this far off is flagged (no one-click close)

  const pad = (n) => String(n).padStart(2, "0");
  const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parseDay = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const daysBetween = (a, b) => Math.round((parseDay(b) - parseDay(a)) / 86400000);
  const num = (n) => (n == null ? "—" : Number(n).toLocaleString(undefined, { maximumFractionDigits: 6 }));
  const r6 = (v) => Math.round(v * 1e6) / 1e6;
  const floorTo = (n, dp) => Math.floor(n * 10 ** dp + 1e-9) / 10 ** dp;

  // ---------- one trade ----------
  const tradePnl = (t) => (t.exit_price == null ? null : (t.side === "short" ? t.entry_price - t.exit_price : t.exit_price - t.entry_price) * t.quantity);   // GROSS, in the trade's currency
  // Isolated margin: long = entry × (1 − 1/leverage + maintenance), short mirrors it. 10× long at 100 → 90.50; 10× short at 100 → 109.50.
  const liqPrice = (side, entry, lev, maintPct = MAINT_PCT) => { const m = maintPct / 100; return side === "short" ? entry * (1 + 1 / lev - m) : entry * (1 - 1 / lev + m); };
  const tradeLiq = (t) => liqPrice(t.side, t.entry_price, t.leverage, t.maintenance_pct != null ? Number(t.maintenance_pct) : MAINT_PCT);
  // Quantity that loses `riskPct`% of `balance` if the stop is hit, counting round-trip fees: risk per unit = |entry − stop| + fee% × (entry + stop)
  const positionSize = (balance, riskPct, entry, stop, feePct) => {
    const perUnit = Math.abs(entry - stop) + ((feePct || 0) / 100) * (entry + stop), riskAmt = (balance * riskPct) / 100;
    return perUnit > 0 ? { qty: riskAmt / perUnit, riskAmt, perUnit } : null;
  };
  const isFutures = (t) => t.mode === "futures" && Number(t.leverage) >= 1;
  const tradeMargin = (t) => (isFutures(t) ? (t.entry_price * t.quantity) / t.leverage : null);
  const tradeFees = (t) => ((Number(t.fee_pct) || 0) / 100) * (t.entry_price * t.quantity + (t.exit_price == null ? 0 : t.exit_price * t.quantity));   // entry fee on entry × qty, exit fee on exit × qty
  // Funding is an ESTIMATE that assumes you pay it (a cost for longs and shorts). Trades only have dates, so: days held × 3 periods; same-day = 0.
  const fundingEstimate = (t, today = localDate()) => {
    if (!isFutures(t)) return 0;
    const days = daysBetween(t.opened_on, t.closed_on || today);
    return days > 0 ? ((Number(t.funding_pct_8h) || 0) / 100) * t.entry_price * t.quantity * days * 3 : 0;
  };
  // Net result in the trade's currency: gross (a futures loss can't exceed the margin), minus fees and funding
  function tradeNetLocal(t, today) {
    const g = tradePnl(t); if (g == null) return null;
    const m = tradeMargin(t), capped = m != null ? Math.max(g, -m) : g;
    return capped - tradeFees(t) - (t.funding_est != null ? Number(t.funding_est) : fundingEstimate(t, today));
  }
  // …and in USD. Closed trades store net_pnl_usd; older trades have none, were always USD, and had no fees, so gross stands.
  const tradeNetUsd = (t, today) => (t.exit_price == null ? null : t.net_pnl_usd != null ? Number(t.net_pnl_usd) : tradeNetLocal(t, today) * (t.fx_to_usd != null ? Number(t.fx_to_usd) : 1));
  const tradeRisk = (t) => (t.stop_loss == null ? null : Math.abs(t.entry_price - t.stop_loss) * t.quantity);   // price risk in the trade's currency (fees not included)
  const tradeR = (t, today) => { const p = tradeNetLocal(t, today), r = tradeRisk(t); return p == null || !r ? null : p / r; };   // net ÷ price risk

  // ---------- entry typo guard ----------
  // How far the entry is from the live price (both in the trade's currency): { pct (unsigned), dir: "lower" | "higher" } or null
  function entryDistance(entry, live) {
    if (!(entry > 0) || !(live > 0)) return null;
    const d = ((entry - live) / live) * 100;
    return { pct: Math.abs(d), dir: d < 0 ? "lower" : "higher" };
  }
  // Overridable warning text when the entry is more than 10% from the live price, else null.
  // e.g. "BTC is $80,652 now; your entry 8,007 is 90% lower. Missing a digit?"
  function entryTypoWarning(symbol, entry, live, fmtPrice = (v) => "$" + num(v)) {
    const d = entryDistance(entry, live);
    if (!d || d.pct <= TYPO_WARN_PCT) return null;
    return `${symbol} is ${fmtPrice(live)} now; your entry ${num(entry)} is ${Math.round(d.pct)}% ${d.dir}. Missing a digit?`;
  }

  // Wrong-side stop/target for a trade's direction, a futures stop beyond the liquidation price, or (only when a live price is passed)
  // an entry more than 50% from it. Used to block saving and to flag old trades (never edits them).
  function tradeProblems(t, livePrice) {
    const out = []; const long = t.side !== "short", e = t.entry_price, f = num;
    if (t.stop_loss != null && (long ? t.stop_loss >= e : t.stop_loss <= e)) out.push({ field: "stop_loss", msg: `Stop loss (${f(t.stop_loss)}) must be ${long ? "below" : "above"} the entry price (${f(e)}) for a ${long ? "long" : "short"}.` });
    if (t.take_profit != null && (long ? t.take_profit <= e : t.take_profit >= e)) out.push({ field: "take_profit", msg: `Target (${f(t.take_profit)}) must be ${long ? "above" : "below"} the entry price (${f(e)}) for a ${long ? "long" : "short"}.` });
    if (isFutures(t) && t.stop_loss != null && e > 0) {
      const liq = tradeLiq(t);
      if (long ? t.stop_loss <= liq : t.stop_loss >= liq) out.push({ field: "stop_loss", msg: `Stop loss (${f(t.stop_loss)}) is beyond the estimated liquidation price (${f(r6(liq))}) at ${f(t.leverage)}×: you'd be liquidated before your stop.` });
    }
    const d = livePrice != null ? entryDistance(e, livePrice) : null;
    if (d && d.pct > TYPO_FLAG_PCT) out.push({ field: "entry_price", msg: `Entry (${f(e)}) is ${Math.round(d.pct)}% ${d.dir} than the live price (${f(livePrice)}). That looks like a typo.` });
    return out;
  }

  // The same hard checks for opening and editing: entry and quantity above 0, a stop is required, then tradeProblems. [{ field, msg }]
  function validateTrade(t) {
    if (!(t.entry_price > 0)) return [{ field: "entry_price", msg: "Entry price must be above 0." }];
    if (!(t.quantity > 0)) return [{ field: "quantity", msg: "Quantity must be above 0." }];
    if (t.stop_loss == null || !isFinite(t.stop_loss)) return [{ field: "stop_loss", msg: "A practice trade needs a stop loss: the price where you admit you're wrong." }];
    if (!(t.stop_loss > 0)) return [{ field: "stop_loss", msg: "Stop loss must be above 0." }];
    return tradeProblems(t);
  }

  // ---------- the account: balance, in trades, available ----------
  // trades: all rows. fxOf(currency) → USD per 1 unit, or null when unknown (USD is always 1).
  // Balance = start + net of closed trades. In trades = spot: entry × qty, futures: margin, converted to USD. Available = balance − in trades.
  function account(start, trades, fxOf = () => null, today) {
    let realized = 0, inTrades = 0, uncounted = 0, open = 0;
    for (const t of trades) {
      if (t.exit_price != null) { realized += tradeNetUsd(t, today); continue; }
      open++;
      const cur = t.currency || "USD", fx = cur === "USD" ? 1 : fxOf(cur);
      if (fx == null) { uncounted++; continue; }
      const cash = isFutures(t) ? tradeMargin(t) : t.entry_price * t.quantity;
      inTrades += cash * fx;
    }
    const balance = start + realized;
    return { start, realized, balance, inTrades, available: balance - inTrades, open, uncounted };
  }
  // The most that `available` (in the trade's currency) can buy, counting the entry fee: spot available ÷ (entry × (1 + fee%)),
  // futures available ÷ (entry × (1/leverage + fee%)). null when there is no cash left.
  function capQty(available, entry, feePct, lev) {
    if (!(available > 0) || !(entry > 0)) return null;
    const f = (feePct || 0) / 100;
    return available / (entry * ((lev >= 1 ? 1 / lev : 1) + f));
  }
  // Suggested quantity: the risk-based size, never more than the cap. { qty, riskQty, cap, capped } or null
  function suggestQty({ balance, riskPct, entry, stop, feePct, available, lev }) {
    const ps = positionSize(balance, riskPct, entry, stop, feePct); if (!ps) return null;
    const cap = capQty(available, entry, feePct, lev);
    if (cap == null) return { qty: null, riskQty: ps.qty, cap: null, capped: true, riskAmt: ps.riskAmt };
    return { qty: Math.min(ps.qty, cap), riskQty: ps.qty, cap, capped: cap < ps.qty, riskAmt: ps.riskAmt };
  }
  // The target price that makes reward/risk equal `rr`: long entry + rr × (entry − stop); short entry − rr × (stop − entry). null if the stop is on the wrong side.
  function targetForRR(side, entry, stop, rr) {
    if (!(entry > 0) || stop == null) return null;
    if (side === "short") return stop > entry ? entry - rr * (stop - entry) : null;
    return stop < entry ? entry + rr * (entry - stop) : null;
  }

  // ---------- editing ----------
  const OPEN_FIELDS = ["entry_price", "quantity", "stop_loss", "take_profit", "setup_tag", "observation_id", "reason"];
  const CLOSED_FIELDS = ["emotion", "lessons", "followed_plan", "mistakes", "rating"];
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  // Apply an edit to a trade. Open trades take OPEN_FIELDS (validated like opening); closed trades take CLOSED_FIELDS only.
  // Returns { ok:false, errors:[{field,msg}] } or { ok:true, row (merged), patch (only what changed), edits (the new full log) }.
  function applyEdit(trade, patch, nowIso = new Date().toISOString(), livePrice) {
    const isClosed = trade.exit_price != null, allowed = isClosed ? CLOSED_FIELDS : OPEN_FIELDS;
    const bad = Object.keys(patch).filter((k) => !allowed.includes(k));
    if (bad.length) return { ok: false, errors: bad.map((k) => ({ field: k, msg: `${k} can't be edited on a ${isClosed ? "closed" : "open"} trade.` })) };
    const changed = {}; const log = [];
    for (const k of Object.keys(patch)) {
      if (same(trade[k], patch[k])) continue;
      changed[k] = patch[k] === "" ? null : patch[k];
      log.push({ field: k, old: trade[k] ?? null, new: changed[k], at: nowIso });
    }
    const row = { ...trade, ...changed };
    if (isClosed) {
      if (row.rating != null && !(Number.isInteger(row.rating) && row.rating >= 1 && row.rating <= 5)) return { ok: false, errors: [{ field: "rating", msg: "Rating must be 1 to 5." }] };
    } else {
      const errors = validateTrade(row);
      if (errors.length) return { ok: false, errors };
    }
    return { ok: true, row, patch: changed, edits: [...(Array.isArray(trade.edits) ? trade.edits : []), ...log], changed: log.length > 0, livePrice };
  }

  // ---------- price range seen while the app was open (MAE / MFE) ----------
  // mae = the worst price seen against the trade (long: lowest, short: highest); mfe = the best (long: highest, short: lowest).
  // Returns the columns to save, or null when nothing changed.
  function updateExcursions(t, price) {
    if (!(price > 0)) return null;
    const long = t.side !== "short", out = {};
    const mae = t.mae_price == null ? null : Number(t.mae_price), mfe = t.mfe_price == null ? null : Number(t.mfe_price);
    const worse = (a, b) => (long ? a < b : a > b), better = (a, b) => (long ? a > b : a < b);
    if (mae == null || worse(price, mae)) out.mae_price = price;
    if (mfe == null || better(price, mfe)) out.mfe_price = price;
    return Object.keys(out).length ? out : null;
  }
  // For exports: MAE/MFE in price and as % of entry. The entry (and exit, once closed) count as prices seen, so a long's MAE is never above entry.
  // null when the app never saw a live price for this trade.
  function excursions(t) {
    if (t.mae_price == null && t.mfe_price == null) return null;
    const long = t.side !== "short", e = t.entry_price;
    const seen = [t.mae_price, t.mfe_price, e, t.exit_price].filter((v) => v != null).map(Number);
    const lo = Math.min(...seen), hi = Math.max(...seen);
    const mae = long ? lo : hi, mfe = long ? hi : lo;
    const pct = (p) => (long ? (p - e) / e : (e - p) / e) * 100;
    return { mae_price: mae, mae_pct: pct(mae), mfe_price: mfe, mfe_pct: pct(mfe) };
  }

  const api = {
    MAINT_PCT, TYPO_WARN_PCT, TYPO_FLAG_PCT, OPEN_FIELDS, CLOSED_FIELDS,
    localDate, parseDay, daysBetween, floorTo, r6,
    tradePnl, liqPrice, tradeLiq, positionSize, isFutures, tradeMargin, tradeFees, fundingEstimate, tradeNetLocal, tradeNetUsd, tradeRisk, tradeR,
    entryDistance, entryTypoWarning, tradeProblems, validateTrade,
    account, capQty, suggestQty, targetForRR, applyEdit, updateExcursions, excursions,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TJ_TRADE = api;
})(typeof window !== "undefined" ? window : globalThis);
