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
| 13 | `paper_pnl_closed` | numeric | sum over closed trades of (exit − entry) × qty, sign flipped for shorts |
| 14 | `paper_balance` | numeric | starting balance (`trading_settings`, default 10000) + `paper_pnl_closed` |
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

