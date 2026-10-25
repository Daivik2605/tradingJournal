// Run with: node tests/stats.test.js   (no installs; uses only node's built-in assert)
const assert = require("assert");
const S = require("../stats.js");
let n = 0;
const t = (name, fn) => { fn(); n++; console.log("ok -", name); };
const close = (a, b, d = 1e-9) => assert.ok(Math.abs(a - b) < d, `${a} is not within ${d} of ${b}`);
const row = (i, net, extra = {}) => ({ id: "t" + i, label: "T" + i, date: `2026-10-${String(10 + i).padStart(2, "0")}`, created: "", net, fees: 0, funding: 0, r: null, tag: null, ...extra });
const seq = (nets, extra) => nets.map((v, i) => row(i, v, extra && extra(i)));

t("worked example: nets +100 +50 -40 -20 0", () => {
  const s = S.computeStats(seq([100, 50, -40, -20, 0]));
  assert.equal(s.n, 5); assert.equal(s.wins, 2); assert.equal(s.losses, 2); assert.equal(s.breakeven, 1);
  close(s.winRate, 40);                 // 2 wins / 5 closed
  close(s.avgWin, 75);                  // (100 + 50) / 2
  close(s.avgLoss, -30);                // (-40 + -20) / 2
  close(s.expectancy, 18);              // 90 / 5, and 0.4 × 75 + 0.4 × (-30) + 0.2 × 0 = 18
  close(s.profitFactor, 2.5);           // 150 / 60
  assert.equal(s.best.net, 100); assert.equal(s.worst.net, -40);
  assert.equal(s.maxLosingStreak, 2);   // -40, -20 then the breakeven ends it
});

t("expectancy equals win% × avg win + loss% × avg loss", () => {
  const s = S.computeStats(seq([30, 30, 30, -20, -20, -20, -20, -20, -20, -20]));   // 3 wins, 7 losses
  close(s.winRate, 30); close(s.avgWin, 30); close(s.avgLoss, -20);
  close(s.expectancy, 0.3 * 30 + 0.7 * -20);   // 9 - 14 = -5
  close(s.expectancy, -5);
  close(s.profitFactor, 90 / 140);
});

t("no losing trades: profit factor is null, not infinity", () => {
  const s = S.computeStats(seq([10, 20]));
  assert.equal(s.profitFactor, null); close(s.winRate, 100); assert.equal(s.avgLoss, null); assert.equal(s.maxLosingStreak, 0);
});

t("no trades and all-breakeven", () => {
  const e = S.computeStats([]);
  assert.equal(e.n, 0); assert.equal(e.winRate, null); assert.equal(e.expectancy, null); assert.equal(e.best, null); assert.deepEqual(e.byTag, []);
  const z = S.computeStats(seq([0, 0]));
  close(z.winRate, 0); close(z.expectancy, 0); assert.equal(z.profitFactor, null);
});

t("largest losing streak", () => {
  assert.equal(S.computeStats(seq([-1, -1, 1, -1, -1, -1, 0, -1])).maxLosingStreak, 3);
  // order is by closing date, not by array order
  const a = [row(3, -5), row(1, -5), row(2, 5)];
  assert.equal(S.computeStats(a).maxLosingStreak, 1);
});

t("average R ignores trades with no R", () => {
  const s = S.computeStats(seq([10, -5, 3], (i) => ({ r: [2, -1, null][i] })));
  close(s.avgR, 0.5);
});

t("fees and funding are summed separately", () => {
  const s = S.computeStats(seq([10, -5], (i) => ({ fees: [1.5, 2.25][i], funding: [0, 0.75][i] })));
  close(s.fees, 3.75); close(s.funding, 0.75);
});

t("win rate by setup tag", () => {
  const tags = ["breakout", "breakout", "breakout", "range", "range", null];
  const s = S.computeStats(seq([10, -5, 7, -3, -4, 2], (i) => ({ tag: tags[i] })));
  const b = Object.fromEntries(s.byTag.map((x) => [x.tag, x]));
  assert.equal(b.breakout.n, 3); close(b.breakout.winRate, (2 / 3) * 100); close(b.breakout.net, 12);
  assert.equal(b.range.n, 2); close(b.range.winRate, 0); close(b.range[ "net"], -7);
  assert.equal(b[""].n, 1); close(b[""].winRate, 100);
  assert.equal(s.byTag[0].tag, "breakout");   // most trades first
});

t("equity series and max drawdown: start 10,000, nets +100 -40 -20 +50", () => {
  const e = S.equitySeries(10000, seq([100, -40, -20, 50]));
  assert.deepEqual(e.points.map((p) => p.balance), [10000, 10100, 10060, 10040, 10090]);
  close(e.drawdown.abs, 60); close(e.drawdown.pct, (60 / 10100) * 100); assert.equal(e.drawdown.peak, 10100); assert.equal(e.drawdown.trough, 10040);
  close(e.drawdown.pct, 0.594059, 1e-5);   // 0.59%
  assert.equal(e.final, 10090);
});

t("max drawdown keeps the largest fall, not the latest", () => {
  const e = S.equitySeries(1000, seq([-100, 50, 400, -50, -50, 20]));   // 900, 950, 1350, 1300, 1250, 1270
  close(e.drawdown.abs, 100); close(e.drawdown.pct, 10); assert.equal(e.drawdown.peak, 1000);   // two falls of $100 tie in dollars (10% from 1000, 7.4% from 1350): the first is kept
});

t("drawdown with no trades or only wins is zero", () => {
  assert.equal(S.equitySeries(500, []).drawdown.abs, 0);
  assert.equal(S.equitySeries(500, seq([5, 5])).drawdown.abs, 0);
});

t("levelsHit: long and short", () => {
  const L = { stop: 95, target: 110, liq: 90.5 };
  assert.deepEqual(S.levelsHit("long", L, 100), []);
  assert.deepEqual(S.levelsHit("long", L, 95), ["stop"]);                 // touching counts
  assert.deepEqual(S.levelsHit("long", L, 90), ["stop", "liq"]);
  assert.deepEqual(S.levelsHit("long", L, 111), ["target"]);
  const Sh = { stop: 105, target: 90, liq: 109.5 };
  assert.deepEqual(S.levelsHit("short", Sh, 100), []);
  assert.deepEqual(S.levelsHit("short", Sh, 105.01), ["stop"]);
  assert.deepEqual(S.levelsHit("short", Sh, 89), ["target"]);
  assert.deepEqual(S.levelsHit("short", Sh, 110), ["stop", "liq"]);
  assert.deepEqual(S.levelsHit("long", { stop: null, target: null, liq: null }, 1), []);
  assert.deepEqual(S.levelsHit("long", L, null), []);
});

t("ladder: order, distances and colour state (10x long at 100, liq 90.50)", () => {
  let l = S.ladder("long", 100, 90.5, 95, 110);
  assert.deepEqual(l.rungs.map((r) => r.key), ["target", "entry", "stop", "liq"]);
  close(l.rungs[0].pct, 10); close(l.rungs[2].pct, -5); close(l.rungs[3].pct, -9.5); assert.equal(l.state, "ok");
  assert.equal(S.ladder("long", 100, 90.5, 90, 110).state, "bad");        // stop beyond liquidation
  assert.equal(S.ladder("long", 100, 90.5, 90.5, 110).state, "bad");      // at liquidation
  assert.equal(S.ladder("long", 100, 90.5, 91, 110).state, "warn");       // 0.55% above liq
  assert.equal(S.ladder("long", 100, 90.5, 92, 110).state, "ok");         // 1.66% above liq
  l = S.ladder("short", 100, 109.5, 110, 90);
  assert.deepEqual(l.rungs.map((r) => r.key), ["stop", "liq", "entry", "target"]);
  assert.equal(l.state, "bad");                                           // short stop above liq
  assert.equal(S.ladder("short", 100, 109.5, 108.5, 90).state, "warn");   // 0.91% below liq
  assert.equal(S.ladder("long", 100, null, 95, 110).state, "ok");         // spot: no liquidation
  assert.equal(S.ladder("long", 0, null, 95, 110), null);
  assert.deepEqual(S.ladder("long", 100, null, null, null).rungs.map((r) => r.key), ["entry"]);
});

t("ladder: warn boundary is 1% of the liquidation price", () => {
  // liq 90.5 → 1% = 0.905, so a stop at 91.405 is exactly on the line (warn), 91.41 is outside (ok)
  assert.equal(S.ladder("long", 100, 90.5, 91.405, 110).state, "warn");
  assert.equal(S.ladder("long", 100, 90.5, 91.41, 110).state, "ok");
});

t("checklist: only the stop blocks; others warn", () => {
  const ok = { stop: 95, riskPct: 1, riskLimit: 1, rr: 1.5, htf: true, liqMap: true, reason: "bounce" };
  let c = S.checklist(ok);
  assert.equal(c.missing.length, 0); assert.equal(c.blocked, false); assert.equal(c.items.length, 6);
  c = S.checklist({ ...ok, stop: null, riskPct: null, rr: null });
  assert.equal(c.blocked, true); assert.deepEqual(c.missing.map((x) => x.key), ["stop_set", "risk_ok", "rr_ok"]);
  c = S.checklist({ ...ok, riskPct: 1.01 }); assert.deepEqual(c.missing.map((x) => x.key), ["risk_ok"]); assert.equal(c.blocked, false);
  c = S.checklist({ ...ok, rr: 1.49 }); assert.deepEqual(c.missing.map((x) => x.key), ["rr_ok"]);
  c = S.checklist({ ...ok, htf: false, reason: "  " }); assert.deepEqual(c.missing.map((x) => x.key), ["htf_checked", "reason_written"]);
  c = S.checklist({ ...ok, liqMap: null }); assert.equal(c.items.length, 5); assert.equal(c.missing.length, 0);   // not crypto: that item isn't shown
  c = S.checklist({ ...ok, liqMap: false }); assert.deepEqual(c.missing.map((x) => x.key), ["liq_map_checked"]);
});

t("checklist record saved with the trade", () => {
  const r = S.checklistRecord({ stop: 95, riskPct: 0.98765432, riskLimit: 1, rr: 2, htf: true, liqMap: null, reason: "x" });
  assert.deepEqual(r, { stop_set: true, risk_ok: true, rr_ok: true, htf_checked: true, reason_written: true, liq_map_checked: null, risk_pct: 0.9877, risk_limit_pct: 1, rr: 2 });
});

console.log(`\n${n} tests passed`);
