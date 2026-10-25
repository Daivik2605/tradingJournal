# Data contract — Chart Journal (`trading`)

Contract version: **1**. Defined by `../../docs/CONTRACT.md`; SQL in `../supabase/trading_schema.sql`.
Both views are `security_invoker`, granted to `authenticated`, and the dashboard reads only these, never the `trading_*` tables.
**Append-only:** use `create or replace view` and add new columns only at the end. Never rename, remove, reorder or change the meaning of a column without bumping `contract_version` here and in `../../docs/DECISIONS.md`.

"Day" and "today" = `(now() at time zone 'America/Toronto')::date`.

## `trading_dashboard_daily`: one row per user per day with any activity
A day exists if there is an observation, a journal entry, a trade opened, or a trade closed that day.

| # | Column | Type | How it is computed |
|---|---|---|---|
| 1 | `user_id` | uuid | owner |
| 2 | `day` | date | `observed_on` / `entry_on` / `opened_on` / `closed_on` |
| 3 | `app` | text | `'trading'` |
| 4 | `active_minutes` | int | `round(sum(seconds_spent) / 60)` over that day's observations; 0 if none |
| 5 | `items_done` | int | distinct assets observed that day; 0 if none |
| 6 | `items_planned` | int | count of currently **active** assets (see caveats) |
| 7 | `streak_current` | int | the streak as of that day, using the app's rule: consecutive observation days ending that day, or ending the day before if that day has no observation (journal/trade-only days carry the streak forward). **0** once a day has gone by with no observation (streak broken). |
| 8 | `headline` | text | e.g. `4 charts · 1 journal · 1 opened · 1 closed` (zero parts omitted; "opened" / "closed" = practice trades opened / closed that day) |
| 9 | `updated_at` | timestamptz | newest timestamp from any source that day |
| 10 | `journal_entries` | int | journal entries dated that day |
| 11 | `trades_opened` | int | trades with `opened_on` that day |
| 12 | `trades_closed` | int | trades with `closed_on` that day |

## `trading_dashboard_now`: one row per user (anyone with a watchlist)

| # | Column | Type | How it is computed |
|---|---|---|---|
| 1 | `user_id` | uuid | owner |
| 2 | `app` | text | `'trading'` |
| 3 | `contract_version` | int | `1` |
| 4 | `status_line` | text | `4/6 charts today · 12-day streak` (streak part omitted at 0) |
| 5 | `needs_attention` | int | guesses to grade: prediction set, no outcome, observed 7+ days ago (same as `readyToGrade` in `app.js`) |
| 6 | `attention_label` | text | `'guesses to grade'` |
| 7 | `last_activity_at` | timestamptz | newest of: observation `created_at`, journal `created_at`/`updated_at`, practice trade `created_at`, concept `learned_at`. Seeding the watchlist/concepts does not count. |
| 8 | `updated_at` | timestamptz | `now()` |
| 9 | `concepts_learned` | int | concepts with `learned = true` |
| 10 | `concepts_total` | int | all concepts |
| 11 | `guess_accuracy_pct` | int, null | `round(100 * right / graded)`, graded = outcome set (mixed counts as graded, not right); null if nothing graded |
| 12 | `open_trades` | int | trades with no `exit_price` |
| 13 | `paper_pnl_closed` | numeric | sum over closed trades of the net result in USD: `coalesce(net_pnl_usd, gross)`, where gross = (exit − entry) × qty (sign flipped for shorts). `net_pnl_usd` is set when a trade closes (after fees and funding, loss capped at margin, converted to USD). Trades closed before phase 5a have no `net_pnl_usd`, so they still use gross: existing values did not change. |
| 14 | `paper_balance` | numeric | starting balance (`trading_settings`, default 10000) + `paper_pnl_closed` (so it is net of fees and funding) |
| 15 | `challenge_day` | int, null | days since the first observation + 1; null before the first observation. Not capped at 30. |

`streak` in `status_line` follows the app: it ends today, or yesterday if today has no observation yet.

## Known caveats (by design, the app's behaviour is unchanged)
- **`items_planned` is today's number, not historical.** It is the current count of active assets repeated on every row. Past days do not reflect the watchlist as it was then, and `items_done` can exceed it if an asset was deactivated after being observed.
- **1000-row cap in the app.** `app.js` loads only the latest 1000 observations, so its own Progress page drifts from these views after about 1000 observations. The views read everything and are the correct numbers.
- **Browser date vs Toronto.** The app writes `observed_on` from the browser's local clock; the views define "today" as Toronto. They agree while the computer is in Toronto's timezone; when travelling, a day's data can land a day off between the app and the views.
- **Trade closing time.** Trades store only `closed_on` (a date), so `updated_at` for a closing day uses the trade's `created_at`.
- A brand-new user appears in `trading_dashboard_now` only after the app has seeded their watchlist (first sign-in).

## Change log
- Round 2, phase 2 (2026-10-24): no change to either view. New observation columns (`timeframes`, `liq_above`, `liq_below`, `stops_note`, `liq_map_checked`) and `trading_assets.coinglass_url` are not exposed in the views.
- Round 2, phase 3 (2026-10-24): no change to either view. New table `trading_glossary` and `trading_settings.seed_concepts_v` are not exposed. Note: `concepts_total` rises by 9 for existing accounts (new Phase 0 concepts), so `concepts_learned / concepts_total` drops a little; no meaning change.
- v1 (2026-10-24): initial views.
- v1, 2026-10-24 (round 2, phase 1): `streak_current` on days with no observation now carries the streak forward instead of showing 0, as long as the previous day had an observation; otherwise 0. `headline` says `N opened` instead of `N trade(s)`. Column names, order and types are unchanged, so `contract_version` stays 1. The `trading_dashboard_now` streak is now computed straight from observation days (same value as before).

## Settings columns (round 2, phase 4): not part of the dashboard contract
Neither dashboard view changed, so the contract version stays **1**. `trading_settings` gained: `theme` (`light|dark|system`, default `system`), `home_currency`, `risk_pct`, `fee_pct`, `funding_pct_8h`, `timeframe_chips text[]` (null = default list). The dashboard must not read them. "Reset to day one" deletes this user's observations, journal entries, words, practice trades, concepts and assets, and the files under `<user_id>/` in `trading-screenshots`; it keeps the settings row and only sets `seed_assets_v` and `seed_concepts_v` to null. After a reset the daily view is empty until new activity.

## CSV exports (round 2, phase 4b): file formats, not part of the dashboard contract
Header rows always present (also when there are no rows); UTF-8 with BOM; dates are local `YYYY-MM-DD`; no `user_id` or internal ids except `asset_id` last.

**`metrics.csv`** (one row per observation, oldest first; a lone stock is downloaded as `<SYMBOL>_metrics_<from>_<to>.csv`): `date, symbol, name, category, source, timeframes, minutes_watched, price, trend, support, resistance, volume, liq_above, liq_below, liq_map_checked, stops_note, notes, news, prediction, confidence, check_price, checked_on, move_pct, outcome, screenshot_count, screenshot_files, asset_id`.
- `category` and `source` are the readable labels; `timeframes` joins `timeframes[]` with `; `, falling back to the old `timeframe`; `liq_map_checked` is `yes`/`no`/blank; `confidence` is blank when there is no prediction; `move_pct` = (check_price − price) / price × 100, 2 dp, blank if either price is missing or price is 0; `screenshot_files` are file names (the images are in the full export).

**`summary.csv`** (one row per stock; groups and selections are zips with `metrics.csv`, `summary.csv`, `README.txt`): `symbol, name, category, days_watched, observations, total_minutes, first_seen, last_seen, guesses_made, guesses_graded, right, mixed, wrong, accuracy_pct, trades_opened, trades_closed, realised_pnl`. `accuracy_pct` = right ÷ graded, 1 dp ("mixed" is not right); trades are matched by `asset_id` (or by symbol when a trade has none), opened by `opened_on`, closed by `closed_on`, both within the range.

**Trades CSV** (`[<SYMBOL>_]trades_<from>_<to>.csv`): `opened_on, closed_on, status, symbol, side, quantity, entry_price, stop_loss, take_profit, exit_price, exit_reason, pnl, pnl_pct, r_multiple, risk_amount, emotion, reason, lessons, screenshot_count, screenshot_files, asset_id`.

**Full export** `data/trading_observations.csv` additionally has `symbol` and `name` after `asset_id`; its JSON is the raw rows.

**Data fix:** `trading_schema.sql` sets `trading_observations.confidence = null` where `prediction is null` (confidence is only meaningful with a guess). No view reads `confidence`, so the dashboard views are unchanged.

## Practice-trade columns (round 2, phase 5a): not part of the dashboard contract
`trading_paper_trades` gained: `mode` (`spot|futures`, default `spot`), `leverage` (1–50), `maintenance_pct`, `fee_pct`, `funding_pct_8h` (snapshots of the Settings defaults at open), `funding_est` (estimate in the trade's currency, set at close), `currency` (ISO code, default `USD`), `fx_to_usd` (USD per 1 unit of `currency`, set at close), `net_pnl_usd` (see `paper_pnl_closed` above). `trading_assets.coingecko_id` is an optional override for live crypto prices. The dashboard must read none of these directly.

**Trades CSV** (`[<SYMBOL>_]trades_<from>_<to>.csv`) is now: `opened_on, closed_on, status, symbol, side, quantity, entry_price, stop_loss, take_profit, exit_price, exit_reason, pnl, pnl_pct, r_multiple, risk_amount, emotion, reason, lessons, screenshot_count, screenshot_files, mode, leverage, liquidation_price, currency, fx_to_usd, fees, funding_est, net_pnl, net_pnl_usd, asset_id` (phase 5b inserts `setup_tag, observation_id, checklist` before `asset_id`, see below). Money columns are in the trade's currency except `net_pnl_usd`; `pnl` is gross; `r_multiple` uses the net result; `summary.csv` `realised_pnl` is net USD. `minutes_watched` (metrics.csv) and `total_minutes` (summary.csv) are minutes with one decimal place.

## Practice-trade columns (round 2, phase 5b): not part of the dashboard contract
`trading_paper_trades` gained: `setup_tag text` (breakout, pullback, range, reversal, news, other, or your own; the list lives in `trading_settings.setup_tags text[]`, null = the default list), `observation_id uuid` (references `trading_observations(id)`, `on delete set null`), and `checklist jsonb` (the pre-trade ticks saved at open: `stop_set, risk_ok, rr_ok, htf_checked, liq_map_checked` (null when the asset isn't crypto), `reason_written`, plus `risk_pct`, `risk_limit_pct`, `rr` at the moment of opening). Neither dashboard view changed, so the contract version stays **1**. The dashboard must read none of these directly. Live unrealised P&L, equity and the typed "Price now" are never stored.

**Trades CSV** (`[<SYMBOL>_]trades_<from>_<to>.csv`) now ends: `…, net_pnl, net_pnl_usd, setup_tag, observation_id, checklist, asset_id` (`checklist` is the JSON text). The full export's `trading_paper_trades.csv` / `.json` carry the new columns automatically; the single-trade `summary.md` lists mode, setup, linked observation and checklist.

## Practice-trade columns (round 2, phase 5c): not part of the dashboard contract
`trading_paper_trades` gained: `edits jsonb` (edit log, oldest first: `[{field, old, new, at}]`; open trades log entry, quantity, stop, target, setup, observation and reason; closed trades log emotion, lessons, followed plan, mistakes and rating), `opened_at timestamptz` (the moment it was opened; existing rows were set to `created_at` by a re-runnable `UPDATE … where opened_at is null`), `closed_at timestamptz` (the moment it was closed; null on open trades and on trades closed before 5c), `followed_plan boolean`, `mistakes text[]`, `rating int` (1–5, check constraint `trading_paper_trades_rating_check`), `mae_price numeric` and `mfe_price numeric` (the worst and best live price seen while the app was open: for a long the lowest and highest, for a short the highest and lowest; they only cover time the app was open and the page visible). `trading_settings` gained `setup_tag_notes jsonb` (`{tag: one-line description}`; a tag with no entry uses the app's default text) and `trade_mistakes text[]` (null = default list: moved stop, FOMO entry, early exit, late exit, oversized, no stop, revenge trade). The dates `opened_on` / `closed_on` stay and still drive both dashboard views, which did not change (contract version stays **1**). The dashboard must read none of these directly.

**Account figures (the app, not the database):** Balance = starting balance + net USD of closed trades; In trades = spot: entry × qty, futures: margin (entry × qty ÷ leverage), converted to USD; Available = Balance − In trades; Equity = Balance + unrealised. `trading_dashboard_now.paper_balance` is still Balance (cash after closed trades), unchanged.

**Practice export files** (Settings full export under `practice/`, the Practice trades "⬇ Export trades" zip `[SYMBOL_]practice_<from>_<to>.zip`, and the group/selection/stock zips whenever a stock has trades opened in the range; a single stock with no trades is still a plain `…_metrics_….csv`). `README.txt` in each is a data dictionary of every column, the fee/funding/maintenance settings used, and timezone notes.
- **`trades.csv`**: `symbol, status, side, mode, leverage, opened_at, closed_at, hold_time_hours, entry, exit, qty, currency, fx_to_usd, notional, margin, liquidation, stop, target, risk_usd, risk_pct, planned_rr, gross, fees, funding, net_usd, r_multiple, return_on_margin_pct, balance_after, setup_tag, checklist, followed_plan, mistakes, rating, emotion, reason, lessons, mae_price, mae_pct, mfe_price, mfe_pct, observation_date, observation_notes, trade_id, asset_id, observation_id`. Prices, notional, margin, liquidation, gross, fees and funding are in the trade's currency; `risk_usd`, `net_usd` and `balance_after` are USD. `margin` for spot is the whole notional. `risk_usd` = |entry − stop| × qty × fx (fees not included); `risk_pct` = `risk_usd` ÷ the balance just before the trade opened; `r_multiple` = net ÷ price risk (both in the trade currency); `return_on_margin_pct` = net ÷ margin × 100; `balance_after` = the whole account's balance right after this trade closed, in closing order (an export of a subset still shows true balances); `hold_time_hours` from the timestamps, else whole days × 24; `checklist` = ticked/total, e.g. `5/6`. `mae_*` / `mfe_*` treat the entry (and the exit once closed) as prices seen, so a long's MAE is never above entry; blank if the app never saw a live price. Open trades are included (`status = open`, results blank).
- **`fills.csv`**: `Date, Time, Symbol, Side, Qty, Price, Fee, Currency, trade_id`. One row per entry and exit (open trades only the entry); a long buys to enter and sells to exit, a short the reverse; `Fee` = the trade's fee % × price × qty; `Date`/`Time` are America/Toronto (blank time when the trade has no timestamp).
- **`stats.csv`**: `group, metric, value` (overall, account, `setup:<tag>`, `plan:<followed|not followed|not recorded>`). **`equity_curve.csv`**: `date, trade, balance, drawdown_usd, drawdown_pct, trade_id` (first row `Start`).

**Data CSVs in the full export** (`data/<table>.csv`) no longer contain `user_id`, put `id` and every `*_id` column last, and `trading_observations.csv` drops the legacy single `timeframe` column (`timeframes` stays); `data/<table>.json` stays raw. The old single-sheet trades CSV (with `pnl`, `risk_amount`, `screenshot_files`…) is replaced by `trades.csv`; screenshots are in the full export only.

