# Chart Journal — app rules (PersonalOS app, key `trading`)

Read `../CLAUDE.md` first: system-wide rules, the app registry, and `../docs/CONTRACT.md`. This file adds this app's rules.

## What it is
A local trading-practice journal: daily chart-watching checklist with a 5-minute timer, observations with screenshots and a next-week guess (graded after 7 days), a concept checklist, a journal, fake-money practice trades, and a 30-day challenge progress page. One of PersonalOS's separate apps; it must work on its own.

## Stack
Static HTML/CSS/JS, no build step: `index.html`, `app.js`, `seed.js`, `styles.css`. `supabase-js` v2 from a CDN. Data and login are in the shared PersonalOS Supabase project (anon key only, in the gitignored `config.js`; template in `config.example.js`). Served by `start.sh` / `start.bat` on **port 5173**; if the port is taken they stop with a message and never pick another.

## Rules
- Everything this app owns starts with **`trading_`** (tables, views, indexes) or **`trading-`** (storage bucket). Tables: `trading_assets`, `trading_observations`, `trading_concepts`, `trading_journal_entries`, `trading_paper_trades`, `trading_settings`. Bucket: `trading-screenshots`. Storage policies start with `trading:`.
- **Never create, change, read or write another app's objects** (`dsa_`, `os_`, …). The dashboard reads only our two views.
- SQL lives in `supabase/trading_schema.sql`: idempotent, safe to re-run, never drops user data. The old root `schema.sql` is only a pointer.
- Every table: `user_id` default `auth.uid()`, RLS on, `"own rows"` policy. Every view: `with (security_invoker = true)` + `grant select ... to authenticated`.
- **Dashboard views are an API** (`docs/DATA_CONTRACT.md`). Use `create or replace view` and only append columns at the end. Never rename, remove, reorder or change the meaning of one; if truly needed, bump `contract_version` and note it in `docs/DATA_CONTRACT.md` and `../docs/DECISIONS.md`.
- Days are local `YYYY-MM-DD` stored as `date` (America/Toronto); moments are `timestamptz`.
- Only the anon/publishable key goes in the app. Never the service_role key or DB password.
- **Never run git commands.** The user does all version control.
- Don't edit other apps' folders from here.
- When a table, view, port or prefix changes: update `docs/DATA_CONTRACT.md` and the registry in `../CLAUDE.md`, and add a dated line to `../docs/DECISIONS.md` for any design choice.
- At the end of each session, update `docs/BUILD_STATUS.md`.
