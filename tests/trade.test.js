// Run with: node tests/trade.test.js   (no installs; uses only node's built-in assert)
const assert = require("assert");
const T = require("../trade.js"), S = require("../stats.js"), X = require("../tradeexport.js");
let n = 0;
const t = (name, fn) => { fn(); n++; console.log("ok -", name); };
const close = (a, b, d = 1e-9) => assert.ok(Math.abs(a - b) < d, `${a} is not within ${d} of ${b}`);
const closed = (o) => ({ id: "c" + Math.random(), symbol: "BTC", side: "long", mode: "spot", currency: "USD", opened_on: "2026-10-01", closed_on: "2026-10-02", entry_price: 100, quantity: 1, exit_price: 100, fee_pct: null, ...o });

t("available balance: 10,000 start, +250 closed, 2×1,000 spot, 10× futures 0.5×3,000", () => {
  const trades = [
    closed({ net_pnl_usd: 250, exit_price: 350 }),
    { id: "s", symbol: "AAPL", side: "long", mode: "spot", currency: "USD", entry_price: 1000, quantity: 2, opened_on: "2026-10-05" },
    { id: "f", symbol: "BTC", side: "long", mode: "futures", leverage: 10, currency: "USD", entry_price: 3000, quantity: 0.5, opened_on: "2026-10-05" },
  ];
  const a = T.account(10000, trades);
  close(a.balance, 10250); close(a.inTrades, 2150);   // 2000 spot + margin 1500 / 10 = 150
  close(a.available, 8100); assert.equal(a.open, 2); assert.equal(a.uncounted, 0);
});

t("available balance: another currency uses its rate; an unknown rate is left out and counted", () => {
  const inr = { id: "i", symbol: "TCS", side: "long", mode: "spot", currency: "INR", entry_price: 4000, quantity: 10, opened_on: "2026-10-05" };   // 40,000 INR
  let a = T.account(10000, [inr], (c) => (c === "INR" ? 0.012 : null));
  close(a.inTrades, 480); close(a.available, 9520); assert.equal(a.uncounted, 0);
  a = T.account(10000, [inr], () => null);
  close(a.inTrades, 0); assert.equal(a.uncounted, 1);
});

t("available balance: closing a trade frees its cash and adds its net", () => {
  const open = { id: "s", symbol: "AAPL", side: "long", mode: "spot", currency: "USD", entry_price: 1000, quantity: 2, opened_on: "2026-10-05" };
  assert.equal(T.account(10000, [open]).available, 8000);
  const done = { ...open, exit_price: 1100, closed_on: "2026-10-06", net_pnl_usd: 200 };
  const a = T.account(10000, [done]); close(a.balance, 10200); close(a.available, 10200); close(a.inTrades, 0);
});

t("size helper cap: $10,000, GOLD entry 2000, stop 1999, fee 0.055%: risk says 31.26, cash caps it at 4.9973", () => {
  const s = T.suggestQty({ balance: 10000, riskPct: 1, entry: 2000, stop: 1999, feePct: 0.055, available: 10000, lev: null });
  close(s.riskQty, 31.2554, 1e-3); assert.equal(Math.round(s.riskQty * 100) / 100, 31.26);
  close(s.cap, 10000 / (2000 * 1.00055), 1e-9); close(s.cap, 4.99726, 1e-5); assert.equal(s.capped, true);
  close(s.qty, s.cap); assert.equal(T.floorTo(s.qty, 4), 4.9972); assert.ok(T.floorTo(s.qty, 4) * 2000 * 1.00055 <= 10000);   // never more than Available
});

t("size helper cap: futures 10× and the no-cash cases", () => {
  const f = T.suggestQty({ balance: 10000, riskPct: 1, entry: 2000, stop: 1999, feePct: 0.055, available: 10000, lev: 10 });
  close(f.cap, 10000 / (2000 * (0.1 + 0.00055)), 1e-9); close(f.cap, 49.7265, 1e-3); assert.equal(f.capped, false);   // risk qty 31.26 is below the 49.73 cap, so the risk size stands
  close(f.qty, f.riskQty);
  const tight = T.suggestQty({ balance: 10000, riskPct: 1, entry: 2000, stop: 1999, feePct: 0.055, available: 5000, lev: 10 }); close(tight.cap, 24.8633, 1e-3); assert.equal(tight.capped, true); close(tight.qty, tight.cap);
  const none = T.suggestQty({ balance: 10000, riskPct: 1, entry: 2000, stop: 1999, feePct: 0.055, available: 0, lev: null });
  assert.equal(none.qty, null); assert.equal(none.capped, true);
  assert.equal(T.suggestQty({ balance: 10000, riskPct: 1, entry: 2000, stop: 1999, feePct: 0.055, available: -50, lev: null }).qty, null);
  const roomy = T.suggestQty({ balance: 10000, riskPct: 1, entry: 100, stop: 90, feePct: 0.055, available: 10000, lev: null });
  assert.equal(roomy.capped, false); close(roomy.qty, roomy.riskQty);
});

t("r_multiple: entry 100, exit 110, qty 10, fee 0.055% → net 98.845 (fees 0.55 + 0.605), R = +1.98", () => {
  const tr = closed({ entry_price: 100, exit_price: 110, quantity: 10, stop_loss: 95, fee_pct: 0.055 });
  close(T.tradePnl(tr), 100); close(T.tradeFees(tr), 1.155);
  close(T.tradeNetLocal(tr), 98.845);   // exact
  close(T.tradeRisk(tr), 50); close(T.tradeR(tr), 1.9769);
  assert.equal(Math.round(T.tradeR(tr) * 100) / 100, 1.98);
});

t("r_multiple: short, loss, futures with funding, and no stop", () => {
  const short = closed({ side: "short", entry_price: 200, exit_price: 190, quantity: 1, stop_loss: 210, fee_pct: 0.055 });
  close(T.tradeNetLocal(short), 10 - 0.00055 * 390); close(T.tradeR(short), (10 - 0.2145) / 10);
  const loss = closed({ entry_price: 100, exit_price: 95, quantity: 10, stop_loss: 95, fee_pct: 0 });
  close(T.tradeR(loss), -1);
  const fut = closed({ side: "short", mode: "futures", leverage: 5, entry_price: 200, exit_price: 190, quantity: 1, stop_loss: 210, fee_pct: 0.055, funding_pct_8h: 0.01, opened_on: "2026-10-05", closed_on: "2026-10-06" });
  close(T.fundingEstimate(fut), 0.0001 * 200 * 1 * 1 * 3); close(T.tradeNetLocal(fut), 10 - 0.2145 - 0.06); assert.equal(Math.round(T.tradeR(fut) * 100) / 100, 0.97);
  assert.equal(T.tradeR(closed({ stop_loss: null })), null);
  const wipe = closed({ mode: "futures", leverage: 10, entry_price: 100, exit_price: 50, quantity: 1, stop_loss: 90 });   // a loss can't pass the 10 margin
  close(T.tradeNetLocal(wipe), -10);
});

t("typo guard: BTC live 80,652 and entry 8,007 → '90% lower' warning, and flagged", () => {
  assert.equal(T.entryTypoWarning("BTC", 8007, 80652), "BTC is $80,652 now; your entry 8,007 is 90% lower. Missing a digit?");
  const trade = { side: "long", mode: "spot", entry_price: 8007, quantity: 1, stop_loss: 7500, take_profit: 9000 };
  const p = T.tradeProblems(trade, 80652); assert.ok(p.some((x) => x.field === "entry_price")); assert.match(p.find((x) => x.field === "entry_price").msg, /90% lower than the live price/);
  assert.deepEqual(T.tradeProblems(trade).filter((x) => x.field === "entry_price"), []);   // no live price → no typo flag
});

t("typo guard boundaries: warning above 10%, flag above 50%, both directions", () => {
  assert.equal(T.entryTypoWarning("BTC", 72586.8, 80652), null);          // exactly 10% lower
  assert.match(T.entryTypoWarning("BTC", 72000, 80652), /11% lower/);     // 10.7%
  assert.match(T.entryTypoWarning("BTC", 90000, 80652), /12% higher/);
  assert.match(T.entryTypoWarning("ETH", 8000, 2000), /300% higher/);
  assert.equal(T.entryTypoWarning("BTC", null, 80652), null); assert.equal(T.entryTypoWarning("BTC", 100, null), null);
  const mk = (e) => ({ side: "long", mode: "spot", entry_price: e, quantity: 1 });
  assert.equal(T.tradeProblems(mk(40326), 80652).length, 0);   // exactly 50%: not flagged
  assert.equal(T.tradeProblems(mk(40000), 80652).length, 1);   // 50.4%: flagged
  assert.equal(T.tradeProblems(mk(130000), 80652).length, 1);  // 61% higher: flagged too
});

t("edit an open trade: only the allowed fields, the log records field/old/new/at, same hard blocks as opening", () => {
  const open = { id: "o", symbol: "BTC", side: "long", mode: "spot", currency: "USD", opened_on: "2026-10-01", entry_price: 100, quantity: 10, stop_loss: 95, take_profit: 110, reason: "a", setup_tag: null };
  const NOW = "2026-10-25T15:00:00.000Z";
  const r = T.applyEdit(open, { entry_price: 101, take_profit: 112, setup_tag: "breakout" }, NOW);
  assert.equal(r.ok, true); assert.equal(r.row.entry_price, 101); assert.deepEqual(r.patch, { entry_price: 101, take_profit: 112, setup_tag: "breakout" });
  assert.deepEqual(r.edits, [{ field: "entry_price", old: 100, new: 101, at: NOW }, { field: "take_profit", old: 110, new: 112, at: NOW }, { field: "setup_tag", old: null, new: "breakout", at: NOW }]);
  const r2 = T.applyEdit({ ...open, edits: r.edits }, { quantity: 20 }, "2026-10-26T00:00:00.000Z");
  assert.equal(r2.edits.length, 4); assert.deepEqual(r2.edits[3], { field: "quantity", old: 10, new: 20, at: "2026-10-26T00:00:00.000Z" });   // appended to the old log
  assert.equal(T.applyEdit(open, { quantity: 10, reason: "a" }, NOW).changed, false);   // nothing changed → nothing logged
  // hard blocks, same as opening
  assert.deepEqual(T.applyEdit(open, { stop_loss: null }, NOW).errors.map((e) => e.field), ["stop_loss"]);
  assert.deepEqual(T.applyEdit(open, { stop_loss: 105 }, NOW).errors.map((e) => e.field), ["stop_loss"]);          // above entry for a long
  assert.deepEqual(T.applyEdit(open, { take_profit: 90 }, NOW).errors.map((e) => e.field), ["take_profit"]);       // below entry for a long
  assert.deepEqual(T.applyEdit(open, { quantity: 0 }, NOW).errors.map((e) => e.field), ["quantity"]);
  assert.deepEqual(T.applyEdit(open, { entry_price: -1 }, NOW).errors.map((e) => e.field), ["entry_price"]);
  const fut = { ...open, mode: "futures", leverage: 10, entry_price: 100, stop_loss: 95 };                        // liquidation 90.5
  assert.deepEqual(T.applyEdit(fut, { stop_loss: 90 }, NOW).errors.map((e) => e.field), ["stop_loss"]);            // beyond liquidation
  assert.equal(T.applyEdit(fut, { stop_loss: 91 }, NOW).ok, true);
  assert.deepEqual(T.applyEdit(open, { exit_price: 5 }, NOW).errors.map((e) => e.field), ["exit_price"]);          // not an editable field
  assert.deepEqual(open.edits, undefined); assert.equal(open.entry_price, 100);                                    // the input is never changed
});

t("edit: the old bad trade (long, entry 2000, qty 100, target 20) is fixed by editing the target", () => {
  const bad = { id: "b", symbol: "GOLD", side: "long", mode: "spot", currency: "USD", opened_on: "2026-10-01", entry_price: 2000, quantity: 100, stop_loss: 1950, take_profit: 20 };
  assert.ok(T.tradeProblems(bad).some((p) => p.field === "take_profit"));
  assert.equal(T.applyEdit(bad, { entry_price: 2001 }, "x").ok, false);                    // still invalid, still blocked
  const fixed = T.applyEdit(bad, { take_profit: 2100 }, "x"); assert.equal(fixed.ok, true); assert.deepEqual(T.tradeProblems(fixed.row), []);
});

t("edit a closed trade: review fields only", () => {
  const c = closed({ stop_loss: 95, entry_price: 100, exit_price: 110, quantity: 10 });
  const r = T.applyEdit(c, { emotion: "calm", lessons: "wait", followed_plan: true, mistakes: ["early exit"], rating: 4 }, "NOW");
  assert.equal(r.ok, true); assert.equal(r.edits.length, 5); assert.deepEqual(r.patch.mistakes, ["early exit"]);
  for (const f of ["entry_price", "quantity", "stop_loss", "take_profit", "exit_price", "reason", "setup_tag"]) assert.equal(T.applyEdit(c, { [f]: 1 }, "NOW").ok, false, f);
  assert.equal(T.applyEdit(c, { rating: 6 }, "NOW").ok, false); assert.equal(T.applyEdit(c, { rating: 0 }, "NOW").ok, false); assert.equal(T.applyEdit(c, { rating: 2.5 }, "NOW").ok, false);
  assert.equal(T.applyEdit(c, { rating: null }, "NOW").ok, true);
});

t("delete a closed trade: balance, stats and equity curve are recomputed", () => {
  const mk = (id, net, day, tag) => closed({ id, net_pnl_usd: net, closed_on: day, created_at: day, exit_price: 100 + net, setup_tag: tag });
  const all = [mk("a", 100, "2026-10-10", "breakout"), mk("b", -40, "2026-10-11", "range"), mk("c", 7867500, "2026-10-12", "breakout"), mk("d", 50, "2026-10-13", "range")];
  const before = T.account(10000, all); close(before.balance, 10000 + 100 - 40 + 7867500 + 50);
  const sBefore = S.computeStats(X.netRows(all)); assert.equal(sBefore.n, 4); close(sBefore.expectancy, (100 - 40 + 7867500 + 50) / 4);
  const remaining = all.filter((x) => x.id !== "c");                                 // delete the bad +$7,867,500 trade
  const after = T.account(10000, remaining); close(after.balance, 10110); close(after.available, 10110);
  const s = S.computeStats(X.netRows(remaining)); assert.equal(s.n, 3); close(s.winRate, (2 / 3) * 100); close(s.expectancy, 110 / 3); close(s.best.net, 100); assert.equal(s.maxLosingStreak, 1);
  const E = S.equitySeries(10000, X.netRows(remaining)); assert.deepEqual(E.points.map((p) => p.balance), [10000, 10100, 10060, 10110]);
  close(E.drawdown.abs, 40); close(E.drawdown.pct, (40 / 10100) * 100);
  assert.deepEqual(s.byTag.map((g) => [g.tag, g.n]).sort(), [["breakout", 1], ["range", 2]]);
});

t("target for reward/risk 1.5", () => {
  close(T.targetForRR("long", 100, 95, 1.5), 107.5); close(T.targetForRR("short", 100, 105, 1.5), 92.5);
  assert.equal(T.targetForRR("long", 100, 105, 1.5), null); assert.equal(T.targetForRR("short", 100, 95, 1.5), null); assert.equal(T.targetForRR("long", 100, null, 1.5), null);
});

t("MAE / MFE: tracked extremes, direction-aware, entry and exit count as seen", () => {
  let long = { side: "long", entry_price: 100 };
  let p = T.updateExcursions(long, 102); assert.deepEqual(p, { mae_price: 102, mfe_price: 102 }); long = { ...long, ...p };
  assert.equal(T.updateExcursions(long, 102), null);
  p = T.updateExcursions(long, 97); assert.deepEqual(p, { mae_price: 97 }); long = { ...long, ...p };
  p = T.updateExcursions(long, 108); assert.deepEqual(p, { mfe_price: 108 }); long = { ...long, ...p };
  assert.equal(T.updateExcursions(long, 100), null); assert.equal(T.updateExcursions(long, null), null);
  const e = T.excursions({ ...long, exit_price: 105 }); close(e.mae_pct, -3); close(e.mfe_pct, 8); assert.equal(e.mae_price, 97); assert.equal(e.mfe_price, 108);
  let short = { side: "short", entry_price: 100 }; short = { ...short, ...T.updateExcursions(short, 98) };
  short = { ...short, ...T.updateExcursions(short, 104) }; short = { ...short, ...T.updateExcursions(short, 95) };
  assert.equal(short.mae_price, 104); assert.equal(short.mfe_price, 95);   // worst = highest, best = lowest
  const es = T.excursions(short); close(es.mae_pct, -4); close(es.mfe_pct, 5);
  const calm = T.excursions({ side: "long", entry_price: 100, mae_price: 103, mfe_price: 110 }); assert.equal(calm.mae_price, 100); close(calm.mae_pct, 0);   // never went below entry
  assert.equal(T.excursions({ side: "long", entry_price: 100 }), null);
});

t("trades.csv rows: columns, balances, risk, R, return on margin, hold time", () => {
  const a = { id: "a", asset_id: "a1", symbol: "BTC", side: "long", mode: "spot", currency: "USD", opened_on: "2026-10-01", opened_at: "2026-10-01T14:00:00Z", closed_on: "2026-10-03", closed_at: "2026-10-03T14:00:00Z",
    entry_price: 100, quantity: 10, stop_loss: 95, take_profit: 110, exit_price: 110, fee_pct: 0.055, net_pnl_usd: 98.845, fx_to_usd: 1, setup_tag: "breakout", observation_id: "ob1",
    checklist: { stop_set: true, risk_ok: true, rr_ok: true, htf_checked: false, liq_map_checked: null, reason_written: true }, followed_plan: true, mistakes: ["early exit", "oversized"], rating: 4, emotion: "calm", reason: "r", lessons: "l", created_at: "2026-10-01T14:00:00Z" };
  const b = { id: "b", symbol: "ETH", side: "short", mode: "futures", leverage: 5, currency: "USD", opened_on: "2026-10-05", closed_on: "2026-10-06", entry_price: 200, quantity: 1, stop_loss: 210, take_profit: 180, exit_price: 190,
    fee_pct: 0.055, funding_pct_8h: 0.01, net_pnl_usd: 9.7255, fx_to_usd: 1, created_at: "2026-10-05T14:00:00Z" };
  const o = { id: "c", symbol: "SOL", side: "long", mode: "spot", currency: "USD", opened_on: "2026-10-07", entry_price: 50, quantity: 2, stop_loss: 45, created_at: "2026-10-07T14:00:00Z" };
  const all = [a, b, o], ctx = { start: 10000, today: "2026-10-25", assetsById: { a1: { id: "a1" } }, obsById: { ob1: { observed_on: "2026-09-30", notes: "range break" } } };
  const rows = X.tradeRows(all, all, ctx);
  assert.deepEqual(Object.keys(rows[0]), X.TRADE_COLS);
  assert.equal(Object.keys(rows[0]).slice(-3).join(), "trade_id,asset_id,observation_id");   // ids last
  const A = rows[0]; assert.equal(A.status, "closed"); close(A.hold_time_hours, 48); close(A.notional, 1000); close(A.margin, 1000); assert.equal(A.liquidation, "");
  close(A.risk_usd, 50); close(A.risk_pct, 0.5); close(A.planned_rr, 2); close(A.gross, 100); close(A.fees, 1.155); close(A.funding, 0); close(A.net_usd, 98.845, 0.006);
  close(A.r_multiple, 1.98); close(A.return_on_margin_pct, 9.88, 0.006); close(A.balance_after, 10098.845, 0.006);
  assert.equal(A.checklist, "4/5"); assert.equal(A.followed_plan, "yes"); assert.equal(A.mistakes, "early exit; oversized"); assert.equal(A.rating, 4);
  assert.equal(A.observation_date, "2026-09-30"); assert.equal(A.observation_notes, "range break"); assert.equal(A.mae_price, "");
  const B = rows[1]; assert.equal(B.mode, "futures"); close(B.hold_time_hours, 24); close(B.margin, 40); close(B.liquidation, 200 * (1 + 0.2 - 0.005), 1e-6);
  close(B.risk_usd, 10); close(B.risk_pct, 0.1, 0.006); close(B.funding, 0.06); close(B.net_usd, 9.73, 0.006); close(B.r_multiple, 0.97); close(B.return_on_margin_pct, 24.31, 0.006); close(B.balance_after, 10108.5705, 0.006);
  const O = rows[2]; assert.equal(O.status, "open"); assert.equal(O.exit, ""); assert.equal(O.net_usd, ""); assert.equal(O.balance_after, ""); assert.equal(O.hold_time_hours, "");
  close(O.risk_usd, 10);
  // an export of just one trade still reports the whole-account balance
  assert.equal(X.tradeRows([b], all, ctx)[0].balance_after, B.balance_after);
});

t("fills.csv: a long buys then sells, a short sells then buys; Toronto time with daylight saving", () => {
  assert.deepEqual(X.toronto("2026-10-25T14:03:11Z"), { date: "2026-10-25", time: "10:03:11" });   // EDT, UTC−4
  assert.deepEqual(X.toronto("2026-12-01T15:00:00Z"), { date: "2026-12-01", time: "10:00:00" });   // EST, UTC−5
  assert.deepEqual(X.toronto("2026-10-26T02:30:00Z"), { date: "2026-10-25", time: "22:30:00" });   // the Toronto date differs from the UTC date
  const L = { id: "l", symbol: "BTC", side: "long", currency: "USD", opened_on: "2026-10-01", opened_at: "2026-10-01T14:00:00Z", closed_on: "2026-10-03", closed_at: "2026-10-03T14:00:00Z", entry_price: 100, quantity: 10, exit_price: 110, fee_pct: 0.055 };
  const Sh = { id: "s", symbol: "ETH", side: "short", currency: "USD", opened_on: "2026-10-02", entry_price: 200, quantity: 1, exit_price: 190, closed_on: "2026-10-04", fee_pct: 0.055 };
  const open = { id: "o", symbol: "SOL", side: "long", currency: "USD", opened_on: "2026-10-05", entry_price: 50, quantity: 2, fee_pct: 0 };
  const f = X.fillRows([L, Sh, open]);
  assert.deepEqual(Object.keys(f[0]), X.FILL_COLS); assert.equal(f.length, 5);
  assert.deepEqual(f.map((r) => r.Symbol + ":" + r.Side), ["BTC:buy", "ETH:sell", "BTC:sell", "ETH:buy", "SOL:buy"]);
  close(f[0].Fee, 0.55); close(f[2].Fee, 0.605); assert.equal(f[0].Time, "10:00:00"); assert.equal(f[1].Time, ""); assert.equal(f[1].Date, "2026-10-02");
});

t("equity_curve.csv and stats.csv rows", () => {
  const mk = (id, net, day) => closed({ id, net_pnl_usd: net, closed_on: day, created_at: day, symbol: "S" + id });
  const all = [mk("a", 100, "2026-10-10"), mk("b", -40, "2026-10-11"), mk("c", -20, "2026-10-12"), mk("d", 50, "2026-10-13")];
  const ctx = { start: 10000 };
  const eq = X.equityRows(all, all, ctx);
  assert.deepEqual(eq.map((r) => r.balance), [10000, 10100, 10060, 10040, 10090]); assert.deepEqual(eq.map((r) => r.drawdown_usd), [0, 0, 40, 60, 10]);
  assert.deepEqual(Object.keys(eq[0]), X.EQUITY_COLS); close(eq[3].drawdown_pct, 0.59, 0.006);
  const sub = X.equityRows([all[3]], all, ctx); assert.deepEqual(sub.map((r) => r.balance), [10000, 10090]);   // a subset keeps the true balances
  const st = X.statsRows(all, all, ctx); const g = (grp, m) => st.find((r) => r.group === grp && r.metric === m).value;
  assert.equal(g("overall", "closed_trades"), 4); close(g("overall", "win_rate_pct"), 50); close(g("account", "max_drawdown_usd"), 60); close(g("account", "balance_usd"), 10090);
  assert.deepEqual(Object.keys(st[0]), X.STATS_COLS);
});

t("data dictionary covers every column of every file", () => {
  assert.deepEqual(X.TRADE_COLS.filter((c) => !(c in X.DICT["trades.csv"])), []); assert.deepEqual(X.FILL_COLS.filter((c) => !(c in X.DICT["fills.csv"])), []);
  assert.deepEqual(X.STATS_COLS.filter((c) => !(c in X.DICT["stats.csv"])), []); assert.deepEqual(X.EQUITY_COLS.filter((c) => !(c in X.DICT["equity_curve.csv"])), []);
  const txt = X.dictionaryText({ start: 10000, fee_pct: 0.055, funding_pct_8h: 0.01 });
  assert.match(txt, /Fee: 0\.055%/); assert.match(txt, /America\/Toronto/); assert.match(txt, /maintenance margin: 0\.5%/); assert.match(txt, /mae_price:/);
});

t("data CSVs: user_id dropped, ids last, legacy timeframe dropped", () => {
  const row = { id: "1", user_id: "u", asset_id: "a", observed_on: "2026-10-01", timeframe: "1D", timeframes: ["1D"], note: "x", checked_id: "z" };
  assert.deepEqual(Object.keys(X.tidyRow(row, ["timeframe"])), ["observed_on", "timeframes", "note", "id", "asset_id", "checked_id"]);
  assert.deepEqual(Object.keys(X.tidyRow({ user_id: "u", paper_balance: 1 })), ["paper_balance"]);
  // columns come from every row, so a row that gains a column later can't push an id column out of the last place
  const ragged = [{ id: "1", user_id: "u", a: 1, asset_id: "x" }, { id: "2", user_id: "u", a: 2, asset_id: "y", b: 3, timeframe: "1D" }];
  assert.deepEqual(X.tidyColumns(ragged, ["timeframe"]), ["a", "b", "id", "asset_id"]);
  assert.deepEqual(X.tidyColumns([]), []);
});

t("win rate with the plan followed vs not", () => {
  const rows = [[100, true], [50, true], [-40, true], [-20, false], [-30, false], [10, null]].map(([net, plan], i) => ({ id: "r" + i, label: "L", date: "2026-10-1" + i, created: "", net, plan }));
  const s = S.computeStats(rows), by = Object.fromEntries(s.byPlan.map((g) => [g.label, g]));
  assert.equal(by.followed.n, 3); close(by.followed.winRate, (2 / 3) * 100); assert.equal(by["not followed"].n, 2); close(by["not followed"].winRate, 0); assert.equal(by["not recorded"].n, 1); close(by["not recorded"].winRate, 100);
});

console.log(`\n${n} tests passed`);
