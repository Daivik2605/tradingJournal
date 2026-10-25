// Chart Journal: builds the readable practice-trade export files (rows only; app.js turns them into CSV and zips).
// Pure: no DOM, no network. window.TJ_EXPORT in the browser, require() in node (tests/trade.test.js).
(function (root) {
  const T = typeof require !== "undefined" ? require("./trade.js") : root.TJ_TRADE;
  const S = typeof require !== "undefined" ? require("./stats.js") : root.TJ_STATS;
  const TZ = "America/Toronto";
  const round = (n, dp = 2) => (n == null || !isFinite(n) ? "" : Math.round(n * 10 ** dp) / 10 ** dp);
  const blank = (v) => (v == null ? "" : v);

  // ISO moment → local date and time in America/Toronto
  function toronto(iso) {
    if (!iso) return { date: "", time: "" };
    const d = new Date(iso); if (isNaN(d)) return { date: "", time: "" };
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(d).map((x) => [x.type, x.value]));
    return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}:${p.second}` };
  }

  // net USD rows in closing order, for the stats and the curve
  const netRows = (trades, today) => trades.filter((t) => t.exit_price != null).map((t) => ({
    id: t.id, label: `${t.symbol} ${t.side} ${t.entry_price}→${t.exit_price}`, date: t.closed_on || t.opened_on, created: t.created_at,
    net: T.tradeNetUsd(t, today),
    fees: T.tradeFees(t) * (t.fx_to_usd != null ? Number(t.fx_to_usd) : 1),
    funding: (t.funding_est != null ? Number(t.funding_est) : T.fundingEstimate(t, today)) * (t.fx_to_usd != null ? Number(t.fx_to_usd) : 1),
    r: T.tradeR(t, today), tag: t.setup_tag || null, plan: t.followed_plan == null ? null : !!t.followed_plan,
  }));

  const TRADE_COLS = ["symbol", "status", "side", "mode", "leverage", "opened_at", "closed_at", "hold_time_hours", "entry", "exit", "qty", "currency", "fx_to_usd",
    "notional", "margin", "liquidation", "stop", "target", "risk_usd", "risk_pct", "planned_rr", "gross", "fees", "funding", "net_usd", "r_multiple", "return_on_margin_pct",
    "balance_after", "setup_tag", "checklist", "followed_plan", "mistakes", "rating", "emotion", "reason", "lessons",
    "mae_price", "mae_pct", "mfe_price", "mfe_pct", "observation_date", "observation_notes", "trade_id", "asset_id", "observation_id"];
  const FILL_COLS = ["Date", "Time", "Symbol", "Side", "Qty", "Price", "Fee", "Currency", "trade_id"];
  const STATS_COLS = ["group", "metric", "value"];
  const EQUITY_COLS = ["date", "trade", "balance", "drawdown_usd", "drawdown_pct", "trade_id"];

  // ctx: { start, assetsById, obsById, today }. `trades` = the rows to export; `all` = every trade (the running balance always covers the whole account).
  function tradeRows(trades, all, ctx) {
    const closedAll = all.filter((t) => t.exit_price != null);
    const E = S.equitySeries(ctx.start, netRows(all, ctx.today));
    const after = Object.fromEntries(E.points.filter((p) => p.id).map((p) => [p.id, p.balance]));
    const balBefore = (t) => ctx.start + closedAll.filter((c) => c.id !== t.id && (c.closed_at && t.opened_at ? c.closed_at <= t.opened_at : c.closed_on && c.closed_on < t.opened_on))
      .reduce((s, c) => s + T.tradeNetUsd(c, ctx.today), 0);
    return trades.map((t) => {
      const closed = t.exit_price != null, cur = t.currency || "USD";
      const fx = t.fx_to_usd != null ? Number(t.fx_to_usd) : cur === "USD" ? 1 : null;
      const fut = T.isFutures(t), notional = t.entry_price * t.quantity, margin = fut ? T.tradeMargin(t) : notional;
      const netL = closed ? T.tradeNetLocal(t, ctx.today) : null, riskL = T.tradeRisk(t), riskUsd = riskL != null && fx != null ? riskL * fx : null;
      const bb = balBefore(t), ex = T.excursions(t);
      const hold = closed ? (t.opened_at && t.closed_at ? (new Date(t.closed_at) - new Date(t.opened_at)) / 3600000 : t.closed_on ? T.daysBetween(t.opened_on, t.closed_on) * 24 : null) : null;
      const ck = t.checklist && typeof t.checklist === "object" ? ["stop_set", "risk_ok", "rr_ok", "htf_checked", "liq_map_checked", "reason_written"].filter((k) => t.checklist[k] != null) : null;
      const o = t.observation_id && ctx.obsById ? ctx.obsById[t.observation_id] : null;
      const a = t.asset_id && ctx.assetsById ? ctx.assetsById[t.asset_id] : null;
      return {
        symbol: t.symbol, status: closed ? "closed" : "open", side: t.side, mode: t.mode || "spot", leverage: blank(fut ? t.leverage : null),
        opened_at: blank(t.opened_at), closed_at: blank(t.closed_at), hold_time_hours: round(hold, 2),
        entry: t.entry_price, exit: blank(t.exit_price), qty: t.quantity, currency: cur, fx_to_usd: blank(t.fx_to_usd),
        notional: round(notional, 4), margin: round(margin, 4), liquidation: fut ? round(T.tradeLiq(t), 6) : "",
        stop: blank(t.stop_loss), target: blank(t.take_profit), risk_usd: round(riskUsd), risk_pct: riskUsd != null && bb > 0 ? round((riskUsd / bb) * 100) : "",
        planned_rr: t.take_profit != null && t.stop_loss != null && t.stop_loss !== t.entry_price ? round(Math.abs(t.take_profit - t.entry_price) / Math.abs(t.entry_price - t.stop_loss)) : "",
        gross: closed ? round(T.tradePnl(t), 4) : "", fees: closed ? round(T.tradeFees(t), 4) : "",
        funding: closed ? round(t.funding_est != null ? Number(t.funding_est) : T.fundingEstimate(t, ctx.today), 4) : "",
        net_usd: closed ? round(T.tradeNetUsd(t, ctx.today)) : "", r_multiple: closed ? round(T.tradeR(t, ctx.today)) : "",
        return_on_margin_pct: closed && margin > 0 ? round((netL / margin) * 100) : "",
        balance_after: closed ? round(after[t.id]) : "",
        setup_tag: blank(t.setup_tag), checklist: ck ? `${ck.filter((k) => t.checklist[k]).length}/${ck.length}` : "",
        followed_plan: t.followed_plan == null ? "" : t.followed_plan ? "yes" : "no", mistakes: (t.mistakes || []).join("; "), rating: blank(t.rating),
        emotion: blank(t.emotion), reason: blank(t.reason), lessons: blank(t.lessons),
        mae_price: ex ? round(ex.mae_price, 6) : "", mae_pct: ex ? round(ex.mae_pct) : "", mfe_price: ex ? round(ex.mfe_price, 6) : "", mfe_pct: ex ? round(ex.mfe_pct) : "",
        observation_date: o ? o.observed_on : "", observation_notes: o ? blank(o.notes) : "",
        trade_id: t.id, asset_id: blank(t.asset_id || (a && a.id)), observation_id: blank(t.observation_id),
      };
    });
  }

  // One row per entry and one per exit (an open trade has only the entry). Side is buy/sell: a long buys to enter and sells to exit; a short the reverse.
  function fillRows(trades) {
    const out = [];
    const mk = (t, iso, day, side, price) => {
      const tm = iso ? toronto(iso) : { date: day, time: "" };
      return { Date: tm.date, Time: tm.time, Symbol: t.symbol, Side: side, Qty: t.quantity, Price: price, Fee: round(((Number(t.fee_pct) || 0) / 100) * price * t.quantity, 6), Currency: t.currency || "USD", trade_id: t.id, _k: (iso || day || "") };
    };
    for (const t of trades) {
      const long = t.side !== "short";
      out.push(mk(t, t.opened_at, t.opened_on, long ? "buy" : "sell", t.entry_price));
      if (t.exit_price != null) out.push(mk(t, t.closed_at, t.closed_on, long ? "sell" : "buy", t.exit_price));
    }
    return out.sort((a, b) => (a._k < b._k ? -1 : a._k > b._k ? 1 : 0)).map(({ _k, ...r }) => r);
  }

  // Balance and drawdown after each closed trade (the whole account), limited to the exported trades. First row is the start.
  function equityRows(trades, all, ctx) {
    const E = S.equitySeries(ctx.start, netRows(all, ctx.today)), keep = new Set(trades.map((t) => t.id));
    let peak = ctx.start; const out = [];
    for (const p of E.points) {
      peak = Math.max(peak, p.balance);
      if (p.id && !keep.has(p.id)) continue;
      const dd = peak - p.balance;
      out.push({ date: p.date || "", trade: p.label, balance: round(p.balance), drawdown_usd: round(dd), drawdown_pct: peak > 0 ? round((dd / peak) * 100) : "", trade_id: blank(p.id) });
    }
    return out;
  }

  // The stats panel as rows: overall, by setup tag, by plan followed
  function statsRows(trades, all, ctx) {
    const rows = netRows(trades, ctx.today), s = S.computeStats(rows), E = S.equitySeries(ctx.start, netRows(all, ctx.today));
    const L = [], add = (group, metric, value) => L.push({ group, metric, value: value == null ? "" : value });
    add("overall", "closed_trades", s.n); add("overall", "wins", s.wins); add("overall", "losses", s.losses); add("overall", "breakeven", s.breakeven);
    add("overall", "win_rate_pct", round(s.winRate)); add("overall", "average_win_usd", round(s.avgWin)); add("overall", "average_loss_usd", round(s.avgLoss));
    add("overall", "expectancy_usd", round(s.expectancy)); add("overall", "average_r", round(s.avgR)); add("overall", "profit_factor", round(s.profitFactor));
    add("overall", "best_trade_usd", s.best ? round(s.best.net) : ""); add("overall", "worst_trade_usd", s.worst ? round(s.worst.net) : "");
    add("overall", "largest_losing_streak", s.maxLosingStreak); add("overall", "total_fees_usd", round(s.fees)); add("overall", "total_funding_est_usd", round(s.funding));
    add("account", "starting_balance_usd", round(ctx.start)); add("account", "balance_usd", round(E.final));
    add("account", "max_drawdown_usd", round(E.drawdown.abs)); add("account", "max_drawdown_pct", round(E.drawdown.pct));
    for (const g of s.byTag) { const k = "setup:" + (g.tag || "(none)"); add(k, "trades", g.n); add(k, "win_rate_pct", round(g.winRate)); add(k, "net_usd", round(g.net)); }
    for (const g of s.byPlan) { if (!g.n) continue; const k = "plan:" + g.label; add(k, "trades", g.n); add(k, "win_rate_pct", round(g.winRate)); add(k, "net_usd", round(g.net)); }
    return L;
  }

  // Data CSVs: drop columns (always user_id), put id and *_id columns last
  function tidyRow(row, drop = []) {
    const dropSet = new Set(["user_id", ...drop]), keys = Object.keys(row).filter((k) => !dropSet.has(k));
    const isId = (k) => k === "id" || k.endsWith("_id");
    const out = {}; for (const k of keys.filter((k) => !isId(k))) out[k] = row[k]; for (const k of keys.filter(isId)) out[k] = row[k];
    return out;
  }

  // The column list for a data CSV: every key that appears in any row (first-seen order), minus the dropped ones, with id and *_id columns last
  function tidyColumns(rows, drop = []) {
    const dropSet = new Set(["user_id", ...drop]), seen = [];
    for (const r of rows) for (const k of Object.keys(r)) if (!dropSet.has(k) && !seen.includes(k)) seen.push(k);
    const isId = (k) => k === "id" || k.endsWith("_id");
    return [...seen.filter((k) => !isId(k)), ...seen.filter(isId)];
  }

  const DICT = {
    "trades.csv": {
      symbol: "Ticker you traded.", status: "open or closed.", side: "long (bet on a rise) or short (bet on a fall).", mode: "spot (own it) or futures (leverage).", leverage: "Futures only, 1 to 50 (×).",
      opened_at: "When the trade was opened. ISO 8601, UTC. Older trades: the moment the row was saved.", closed_at: "When it was closed (UTC). Blank for open trades and for trades closed before this column existed.",
      hold_time_hours: "Hours between opened_at and closed_at; if closed_at is missing, whole days between the dates × 24. Blank while open.",
      entry: "Entry price, in the trade's currency.", exit: "Exit price, in the trade's currency.", qty: "Shares or coins.", currency: "Currency of every price and money column except those ending in _usd and balance_after.",
      fx_to_usd: "USD per 1 unit of currency, stored when the trade closed (1 for USD).", notional: "entry × qty, in the trade's currency.",
      margin: "Cash tied up. Futures: notional ÷ leverage. Spot: the whole notional.", liquidation: "Futures only: estimated liquidation price (isolated margin, maintenance margin below). An estimate, not an exchange's number.",
      stop: "Stop loss price.", target: "Target price.", risk_usd: "|entry − stop| × qty in USD. Fees not included.", risk_pct: "risk_usd as % of the balance just before the trade opened (closed trades only counted if closed before the open; same-day without timestamps is not counted).",
      planned_rr: "Planned reward/risk: |target − entry| ÷ |entry − stop|.", gross: "Price move × qty, before fees and funding, trade currency.",
      fees: "Entry fee + exit fee, trade currency. Fee % is the snapshot saved on the trade.", funding: "Estimated funding (futures): funding % per 8 h × entry notional × days held × 3. Assumed paid. An estimate.",
      net_usd: "Result in USD after fees and funding; a futures loss is capped at the margin.", r_multiple: "Net result ÷ risk (price risk in the trade's currency). +2 means twice what you risked.",
      return_on_margin_pct: "Net result ÷ margin × 100 (spot: ÷ notional).", balance_after: "Account balance in USD right after this trade closed (starting balance + net of all closed trades so far, in closing order).",
      setup_tag: "Your setup label.", checklist: "Pre-trade checklist items ticked at open, e.g. 5/6.", followed_plan: "yes / no / blank: your own review at close.",
      mistakes: "Mistakes you ticked at close, separated by ;.", rating: "Your 1 to 5 rating of the execution.", emotion: "How you felt.", reason: "Why you took it.", lessons: "What you learned.",
      mae_price: "Worst price seen against the trade (long: lowest, short: highest), tracked only while the app was open, extended to include entry and exit. Blank if the app never saw a live price.",
      mae_pct: "mae_price as % move from entry (zero or negative).", mfe_price: "Best price seen in your favour (long: highest, short: lowest), same limits as mae_price.", mfe_pct: "mfe_price as % move from entry (zero or positive).",
      observation_date: "Date of the linked observation.", observation_notes: "Notes of the linked observation.", trade_id: "Row id of the trade.", asset_id: "Row id of the watchlist asset.", observation_id: "Row id of the linked observation.",
    },
    "fills.csv": {
      Date: "Local date (America/Toronto) of the fill.", Time: "Local time (America/Toronto), HH:MM:SS. Blank when the trade has no timestamp.", Symbol: "Ticker.",
      Side: "buy or sell. A long buys to enter and sells to exit; a short sells to enter and buys to exit.", Qty: "Shares or coins.", Price: "Fill price (the entry or exit price), trade currency.",
      Fee: "Fee % snapshot × price × qty, trade currency.", Currency: "Currency of Price and Fee.", trade_id: "Row id of the trade.",
    },
    "stats.csv": { group: "overall, account, setup:<tag> or plan:<followed|not followed|not recorded>.", metric: "Name; money metrics end in _usd, percentages in _pct.", value: "The number. Win = net above 0, loss = below 0, breakeven neither. Profit factor blank when there are no losses." },
    "equity_curve.csv": {
      date: "Closing date (America/Toronto calendar date); blank on the Start row.", trade: "Trade label, or Start.", balance: "Account balance in USD after the trade (whole account, in closing order).",
      drawdown_usd: "Peak balance so far minus balance.", drawdown_pct: "drawdown_usd as % of the peak.", trade_id: "Row id of the trade.",
    },
  };
  function dictionaryText(ctx) {
    const L = ["PRACTICE TRADE FILES: DATA DICTIONARY", "",
      "Settings used:",
      `- Starting balance: ${ctx.start} USD`, `- Fee: ${ctx.fee_pct}% per side (each trade stores the fee it was opened with; this is the current Settings value)`,
      `- Funding estimate: ${ctx.funding_pct_8h}% per 8 hours (futures; days held × 3 periods; assumed paid)`, `- Liquidation maintenance margin: ${T.MAINT_PCT}% (isolated; an estimate)`, "",
      "Time and dates:",
      "- Dates (opened_on, closed_on, equity_curve date) are calendar dates in America/Toronto.",
      "- opened_at and closed_at are ISO 8601 in UTC. fills.csv Date and Time are converted to America/Toronto.",
      "- Money columns are in the trade's currency unless the name ends in _usd (or is balance_after / balance / the equity curve), which are USD.", ""];
    for (const [file, cols] of Object.entries(DICT)) { L.push(file, ...Object.entries(cols).map(([c, m]) => `  ${c}: ${m}`), ""); }
    return L.join("\n");
  }

  const api = { toronto, netRows, tradeRows, fillRows, equityRows, statsRows, tidyRow, tidyColumns, dictionaryText, DICT, TRADE_COLS, FILL_COLS, STATS_COLS, EQUITY_COLS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TJ_EXPORT = api;
})(typeof window !== "undefined" ? window : globalThis);
