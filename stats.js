// Chart Journal: pure practice-trade statistics and rules (no DOM, no network).
// Loaded as window.TJ_STATS in the browser and with require() in node, so tests/stats.test.js can run with plain `node`.
(function (root) {
  const EPS = 1e-9;
  const sum = (a) => a.reduce((s, x) => s + x, 0);

  // Closing order: by closed date, then when the row was created, then id (stable).
  const byClose = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.created || "") < (b.created || "") ? -1 : (a.created || "") > (b.created || "") ? 1 : String(a.id) < String(b.id) ? -1 : 1);

  // rows: [{ id, label, date (closed_on), created, net (USD, after fees and funding), fees (USD), funding (USD), r (R multiple or null), tag (string or null), plan (true/false/null) }]
  // win = net > 0, loss = net < 0, breakeven (net = 0) is neither.
  function computeStats(rows) {
    const R = rows.slice().sort(byClose), n = R.length;
    const wins = R.filter((x) => x.net > 0), losses = R.filter((x) => x.net < 0);
    const grossWin = sum(wins.map((x) => x.net)), grossLoss = sum(losses.map((x) => x.net));   // grossLoss is <= 0
    const rs = R.map((x) => x.r).filter((v) => v != null && isFinite(v));
    let streak = 0, maxStreak = 0;
    for (const x of R) { if (x.net < 0) { streak++; if (streak > maxStreak) maxStreak = streak; } else streak = 0; }
    const tags = new Map();
    for (const x of R) {
      const k = x.tag || "";
      const t = tags.get(k) || { tag: k, n: 0, wins: 0, net: 0 };
      t.n++; if (x.net > 0) t.wins++; t.net += x.net; tags.set(k, t);
    }
    const byTag = [...tags.values()].map((t) => ({ ...t, winRate: (t.wins / t.n) * 100 })).sort((a, b) => b.n - a.n || (a.tag < b.tag ? -1 : 1));
    // win rate with the plan followed / not followed / not recorded (row.plan is true, false or null)
    const byPlan = [[true, "followed"], [false, "not followed"], [null, "not recorded"]].map(([k, label]) => {
      const g = R.filter((x) => (x.plan === undefined ? null : x.plan) === k);
      const w = g.filter((x) => x.net > 0).length;
      return { plan: k, label, n: g.length, wins: w, winRate: g.length ? (w / g.length) * 100 : null, net: sum(g.map((x) => x.net)) };
    });
    const avgWin = wins.length ? grossWin / wins.length : null, avgLoss = losses.length ? grossLoss / losses.length : null;
    return {
      n, wins: wins.length, losses: losses.length, breakeven: n - wins.length - losses.length,
      winRate: n ? (wins.length / n) * 100 : null,
      avgWin, avgLoss,
      expectancy: n ? sum(R.map((x) => x.net)) / n : null,        // mean net per trade = win% × avg win + loss% × avg loss
      avgR: rs.length ? sum(rs) / rs.length : null,
      profitFactor: losses.length ? grossWin / Math.abs(grossLoss) : null,   // null = no losing trades (shown as "no losses")
      best: n ? R.reduce((a, b) => (b.net > a.net ? b : a)) : null,
      worst: n ? R.reduce((a, b) => (b.net < a.net ? b : a)) : null,
      maxLosingStreak: maxStreak,
      fees: sum(R.map((x) => x.fees || 0)),
      funding: sum(R.map((x) => x.funding || 0)),
      byTag, byPlan,
    };
  }

  // Balance after each closed trade. points[0] is the starting balance (before any trade).
  // Max drawdown = largest peak-to-trough fall of the balance, in USD and as % of that peak.
  function equitySeries(start, rows) {
    const R = rows.slice().sort(byClose);
    const points = [{ i: 0, date: null, label: "Start", balance: start, net: 0 }];
    let bal = start, peak = start, peakAt = 0, dd = { abs: 0, pct: 0, peak: start, trough: start };
    R.forEach((x, k) => {
      bal += x.net;
      points.push({ i: k + 1, id: x.id, date: x.date, label: x.label, balance: bal, net: x.net });
      if (bal > peak) { peak = bal; peakAt = k + 1; }
      const fall = peak - bal;
      if (fall > dd.abs + EPS) dd = { abs: fall, pct: peak > 0 ? (fall / peak) * 100 : 0, peak, trough: bal };
    });
    return { points, drawdown: dd, final: bal };
  }

  // Which of a trade's levels the live price is on or past. levels: { stop, target, liq } (numbers or null), all in the same currency as price.
  // Long: stop and liquidation are below, target is above. Short mirrors it.
  function levelsHit(side, levels, price) {
    const out = [];
    if (!(price > 0)) return out;
    const long = side !== "short";
    const has = (v) => v != null && isFinite(v);
    if (has(levels.stop) && (long ? price <= levels.stop : price >= levels.stop)) out.push("stop");
    if (has(levels.target) && (long ? price >= levels.target : price <= levels.target)) out.push("target");
    if (has(levels.liq) && (long ? price <= levels.liq : price >= levels.liq)) out.push("liq");
    return out;
  }

  // Price ladder for the form: rungs from the highest price to the lowest, each with % distance from entry.
  // state: "bad" = stop beyond (or at) liquidation, "warn" = stop within 1% of liquidation (|stop − liq| ÷ liq), else "ok".
  function ladder(side, entry, liq, stop, target) {
    if (!(entry > 0)) return null;
    const long = side !== "short";
    const rungs = [];
    const add = (key, price) => { if (price != null && isFinite(price) && price > 0) rungs.push({ key, price, pct: ((price - entry) / entry) * 100 }); };
    add("liq", liq); add("stop", stop); add("entry", entry); add("target", target);
    const order = { liq: 0, stop: 1, entry: 2, target: 3 };
    rungs.sort((a, b) => b.price - a.price || order[a.key] - order[b.key]);
    let state = "ok";
    if (liq != null && stop != null && liq > 0 && stop > 0) {
      const beyond = long ? stop <= liq : stop >= liq;
      if (beyond) state = "bad";
      else if ((Math.abs(stop - liq) / liq) * 100 <= 1 + EPS) state = "warn";
    }
    return { rungs, state };
  }

  // Pre-trade checklist. Only "stop set" is required (blocks); the rest warn.
  // in: { stop, riskPct (% of balance the trade risks, or null if it can't be worked out), riskLimit, rr (reward/risk or null), htf, liqMap (null when not crypto), reason }
  const MIN_RR = 1.5;
  function checklist(i) {
    const items = [
      { key: "stop_set", label: "Stop loss is set", ok: i.stop != null && isFinite(i.stop), required: true, auto: true },
      { key: "risk_ok", label: `Risk is within your ${i.riskLimit}% limit`, ok: i.riskPct != null && i.riskLimit != null && i.riskPct <= i.riskLimit + EPS, auto: true },
      { key: "rr_ok", label: `Reward/risk is at least ${MIN_RR}`, ok: i.rr != null && i.rr >= MIN_RR - EPS, auto: true },
      { key: "htf_checked", label: "I checked the higher timeframe", ok: !!i.htf, auto: false },
    ];
    if (i.liqMap !== null && i.liqMap !== undefined) items.push({ key: "liq_map_checked", label: "I checked the liquidation map", ok: !!i.liqMap, auto: false });
    items.push({ key: "reason_written", label: "I wrote a reason", ok: !!(i.reason && String(i.reason).trim()), auto: true });
    return { items, missing: items.filter((x) => !x.ok), blocked: !items[0].ok };
  }
  // What gets saved with the trade (trading_paper_trades.checklist)
  function checklistRecord(i) {
    const c = checklist(i), rec = {};
    c.items.forEach((x) => { rec[x.key] = x.ok; });
    if (i.liqMap === null || i.liqMap === undefined) rec.liq_map_checked = null;   // not crypto: not applicable
    rec.risk_pct = i.riskPct == null ? null : Math.round(i.riskPct * 1e4) / 1e4;
    rec.risk_limit_pct = i.riskLimit;
    rec.rr = i.rr == null ? null : Math.round(i.rr * 1e4) / 1e4;
    return rec;
  }

  const api = { computeStats, equitySeries, levelsHit, ladder, checklist, checklistRecord, MIN_RR };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TJ_STATS = api;
})(typeof window !== "undefined" ? window : globalThis);
