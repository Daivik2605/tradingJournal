-- Chart Journal (PersonalOS "trading") — Supabase schema (v3, shared project)
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Safe to run more than once, and never drops data. Every row belongs to the signed-in user; Row Level Security keeps it private.
-- This app only creates objects starting with trading_ / trading-. Never touch another app's objects.

-- ───────────── Watchlist ─────────────
create table if not exists public.trading_assets (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  symbol        text not null,
  name          text not null,
  category      text not null default 'other'
                check (category in ('crypto','resource','us','india','other')),
  tv_symbol     text,            -- TradingView symbol, e.g. NASDAQ:AAPL
  yahoo_symbol  text,            -- Yahoo Finance symbol, e.g. AAPL, BTC-USD, GC=F, RELIANCE.NS
  mc_url        text,            -- Moneycontrol page link (optional, mostly Indian stocks)
  why           text,            -- why it's on the list
  active        boolean not null default true,
  sort          int not null default 0,
  created_at    timestamptz not null default now(),
  unique (user_id, symbol)
);

-- ───────────── One row per chart you study ─────────────
create table if not exists public.trading_observations (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  asset_id       uuid not null references public.trading_assets(id) on delete cascade,
  observed_on    date not null,                 -- your local date
  created_at     timestamptz not null default now(),
  source         text check (source in ('tradingview','yahoo','moneycontrol','coinglass','other')),  -- where you looked
  timeframe      text not null default '1D',
  seconds_spent  int  not null default 0,
  price          numeric,
  trend          text check (trend in ('up','down','sideways')),
  support        numeric,
  resistance     numeric,
  volume         text check (volume in ('normal','rising','falling','spike')),
  patterns       text[] not null default '{}',
  notes          text,
  news           text,
  screenshots    text[] not null default '{}',  -- file paths in the "trading-screenshots" storage bucket
  prediction     text check (prediction in ('up','down','flat')),
  confidence     int  check (confidence between 1 and 5),
  check_price    numeric,                       -- price when you came back to grade the guess
  checked_on     date,                          -- when you graded it
  outcome        text check (outcome in ('right','wrong','mixed'))
);
create index if not exists trading_observations_user_day on public.trading_observations (user_id, observed_on desc);
create index if not exists trading_observations_asset on public.trading_observations (asset_id);

-- ───────────── Concept checklist ─────────────
create table if not exists public.trading_concepts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  phase       int  not null default 1,
  title       text not null,
  detail      text,
  learned     boolean not null default false,
  learned_at  timestamptz,
  notes       text,
  sort        int not null default 0,
  created_at  timestamptz not null default now(),
  unique (user_id, title)
);

-- ───────────── Journal ─────────────
create table if not exists public.trading_journal_entries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  entry_on    date not null,
  title       text,
  body        text not null,
  tags        text[] not null default '{}',
  confidence  int check (confidence between 1 and 5),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists trading_journal_user_day on public.trading_journal_entries (user_id, entry_on desc);

-- ───────────── Practice (fake-money) trades ─────────────
create table if not exists public.trading_paper_trades (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  asset_id      uuid references public.trading_assets(id) on delete set null,
  symbol        text not null,                 -- kept even if the asset is later deleted
  side          text not null default 'long' check (side in ('long','short')),
  opened_on     date not null,
  entry_price   numeric not null check (entry_price > 0),
  quantity      numeric not null check (quantity > 0),
  stop_loss     numeric,                       -- where you planned to get out if wrong
  take_profit   numeric,                       -- where you planned to take profit
  reason        text,                          -- why you took the trade
  closed_on     date,
  exit_price    numeric check (exit_price > 0),
  exit_reason   text check (exit_reason in ('target','stop','manual','time')),
  emotion       text,                          -- how you felt (calm, FOMO, scared…)
  lessons       text,
  screenshots   text[] not null default '{}',
  created_at    timestamptz not null default now()
);
create index if not exists trading_paper_trades_user on public.trading_paper_trades (user_id, opened_on desc);

-- ───────────── Per-user settings ─────────────
create table if not exists public.trading_settings (
  user_id         uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  paper_balance   numeric not null default 10000,  -- starting fake-money balance (USD)
  updated_at      timestamptz not null default now()
);

-- ───────────── Additive upgrades (round 2, phase 2): safe to re-run, nothing is dropped except one check constraint that is re-added at once ─────────────
alter table public.trading_assets       add column if not exists coinglass_url text;           -- optional override of the default Coinglass link
alter table public.trading_observations add column if not exists timeframes text[] not null default '{}';   -- every timeframe checked ("timeframe" keeps the first, for old views)
alter table public.trading_observations add column if not exists liq_above numeric;             -- liquidation cluster above price
alter table public.trading_observations add column if not exists liq_below numeric;             -- liquidation cluster below price
alter table public.trading_observations add column if not exists stops_note text;               -- where stop losses likely sit
alter table public.trading_observations add column if not exists liq_map_checked boolean;       -- looked at the liquidation map?
alter table public.trading_settings     add column if not exists seed_assets_v int;             -- newest default-watchlist version already offered to this account (null = before round 2)
-- allow source = 'coinglass' on existing tables (the check is dropped and re-added under the same name)
alter table public.trading_observations drop constraint if exists trading_observations_source_check;
alter table public.trading_observations add constraint trading_observations_source_check
  check (source in ('tradingview','yahoo','moneycontrol','coinglass','other'));

-- ───────────── Additive upgrades (round 2, phase 3): Learn "Start here" + "Words I don't understand" ─────────────
alter table public.trading_settings add column if not exists seed_concepts_v int;               -- newest default-concepts version already offered to this account (null = before phase 3)
create table if not exists public.trading_glossary (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  term        text not null,
  context     text,                                    -- where I heard it
  notes       text,
  asked       boolean not null default false,          -- asked Anikait
  understood  boolean not null default false,
  created_at  timestamptz not null default now()
);
-- one row per word per user; "Order book" and "order book" count as the same word
create unique index if not exists trading_glossary_user_term on public.trading_glossary (user_id, lower(term));

-- ───────────── Additive upgrades (round 2, phase 4): Settings page. Safe to re-run; one check constraint is dropped and re-added at once ─────────────
alter table public.trading_settings add column if not exists theme text not null default 'system';   -- light | dark | system
alter table public.trading_settings drop constraint if exists trading_settings_theme_check;
alter table public.trading_settings add constraint trading_settings_theme_check check (theme in ('light','dark','system'));
alter table public.trading_settings add column if not exists home_currency   text    default 'CAD';
alter table public.trading_settings add column if not exists risk_pct        numeric default 1;       -- % of balance risked per trade (read by phase 5)
alter table public.trading_settings add column if not exists fee_pct         numeric default 0.055;   -- taker fee, each side
alter table public.trading_settings add column if not exists funding_pct_8h  numeric default 0.01;    -- estimated futures funding per 8 hours
alter table public.trading_settings add column if not exists timeframe_chips text[];                  -- null = the app's default list (15m … 1Y)

-- ───────────── Additive upgrades (round 2, phase 5a): spot/futures, fees, currency. Safe to re-run; three check constraints are dropped and re-added at once ─────────────
alter table public.trading_assets       add column if not exists coingecko_id text;                      -- optional override for live crypto prices (null = built-in id table)
alter table public.trading_paper_trades add column if not exists mode            text not null default 'spot';   -- spot | futures (older trades are spot)
alter table public.trading_paper_trades add column if not exists leverage        numeric;                       -- futures only, 1 to 50
alter table public.trading_paper_trades add column if not exists maintenance_pct numeric;                       -- futures only, e.g. 0.5 (percent) used for the liquidation estimate
alter table public.trading_paper_trades add column if not exists fee_pct         numeric;                       -- taker fee per side, percent, snapshot of the Settings default at open (null = no fees, older trades)
alter table public.trading_paper_trades add column if not exists funding_pct_8h  numeric;                       -- funding estimate per 8 h, percent, snapshot at open
alter table public.trading_paper_trades add column if not exists funding_est     numeric;                       -- estimated funding cost in the trade's currency, set when the trade closes
alter table public.trading_paper_trades add column if not exists currency        text not null default 'USD';   -- prices on this trade are in this currency (ISO code)
alter table public.trading_paper_trades add column if not exists fx_to_usd       numeric;                       -- USD per 1 unit of `currency`, stored when the trade closes (1 for USD)
alter table public.trading_paper_trades add column if not exists net_pnl_usd     numeric;                       -- net result in USD (after fees and funding, loss capped at margin), set when the trade closes; null on older trades (they use gross P&L)
alter table public.trading_paper_trades drop constraint if exists trading_paper_trades_mode_check;
alter table public.trading_paper_trades add constraint trading_paper_trades_mode_check check (mode in ('spot','futures'));
alter table public.trading_paper_trades drop constraint if exists trading_paper_trades_leverage_check;
alter table public.trading_paper_trades add constraint trading_paper_trades_leverage_check check (leverage is null or leverage between 1 and 50);
alter table public.trading_paper_trades drop constraint if exists trading_paper_trades_currency_check;
alter table public.trading_paper_trades add constraint trading_paper_trades_currency_check check (currency ~ '^[A-Z]{3}$');

-- ───────────── Additive upgrades (round 2, phase 5b): setup tag, observation link, checklist. Safe to re-run; nothing is dropped ─────────────
alter table public.trading_paper_trades add column if not exists setup_tag       text;                           -- breakout, pullback, range… (list is editable in Settings)
alter table public.trading_paper_trades add column if not exists observation_id  uuid references public.trading_observations(id) on delete set null;   -- the observation this trade came from, if any
alter table public.trading_paper_trades add column if not exists checklist       jsonb;                          -- pre-trade ticks at open: {stop_set, risk_ok, rr_ok, htf_checked, liq_map_checked, reason_written, risk_pct, risk_limit_pct, rr}
alter table public.trading_settings     add column if not exists setup_tags      text[];                         -- null = the app's default list
create index if not exists trading_paper_trades_obs on public.trading_paper_trades (observation_id) where observation_id is not null;

-- ───────────── Additive upgrades (round 2, phase 5c): edit log, timestamps, review, price range seen, descriptions. Safe to re-run; one check constraint is dropped and re-added at once ─────────────
alter table public.trading_paper_trades add column if not exists edits         jsonb;            -- edit log: [{field, old, new, at}], oldest first
alter table public.trading_paper_trades add column if not exists opened_at     timestamptz;      -- the moment the trade was opened (the date column opened_on stays)
alter table public.trading_paper_trades add column if not exists closed_at     timestamptz;      -- the moment it was closed (null on open trades, and on trades closed before this column existed)
alter table public.trading_paper_trades add column if not exists followed_plan boolean;          -- review at close: did you follow your plan?
alter table public.trading_paper_trades add column if not exists mistakes      text[];           -- review at close: ticked mistakes
alter table public.trading_paper_trades add column if not exists rating        int;              -- review at close: 1 to 5
alter table public.trading_paper_trades add column if not exists mae_price     numeric;          -- worst live price seen against the trade while the app was open (long: lowest, short: highest)
alter table public.trading_paper_trades add column if not exists mfe_price     numeric;          -- best live price seen in the trade's favour while the app was open
alter table public.trading_paper_trades drop constraint if exists trading_paper_trades_rating_check;
alter table public.trading_paper_trades add constraint trading_paper_trades_rating_check check (rating is null or rating between 1 and 5);
alter table public.trading_settings     add column if not exists setup_tag_notes jsonb;          -- {tag: one-line description}; a missing tag uses the app's default text
alter table public.trading_settings     add column if not exists trade_mistakes  text[];         -- null = the app's default list
-- Existing trades: opened_at = the moment the row was saved (that is when they were opened). closed_at stays null on old trades.
-- Safe to re-run: only rows where opened_at is still null are touched.
update public.trading_paper_trades set opened_at = created_at where opened_at is null;

-- ───────────── Focus mode (phase 5d): practice trades are frozen and hidden by default. Safe to re-run ─────────────
alter table public.trading_settings add column if not exists show_practice boolean not null default false;   -- Settings → "Show practice trades"
-- Learn: the old "Paper trading" row pushed fake-money practice here. Reword it only while it is still the original text (an edited row is left alone; re-running changes nothing).
update public.trading_concepts
   set detail = 'Practise with fake money in TradingView Paper Trading or Bybit Demo, and journal the lesson here.'
 where title = 'Paper trading' and detail = 'Practise with fake money until your results are consistent.';

-- ───────────── One-time data fix (phase 4b): confidence only means something next to a prediction ─────────────
-- Older saves stored the slider's default (3) even with no guess. Safe to re-run: after the first run no row matches.
update public.trading_observations set confidence = null where prediction is null and confidence is not null;

-- ───────────── Row Level Security: each user only ever sees their own rows ─────────────
do $$
declare t text;
begin
  foreach t in array array['trading_assets','trading_observations','trading_concepts','trading_journal_entries','trading_paper_trades','trading_settings','trading_glossary'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format(
      'create policy "own rows" on public.%I for all to authenticated
         using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- ───────────── Screenshot storage (private, max 5 MB per image) ─────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('trading-screenshots', 'trading-screenshots', false, 5242880, array['image/png','image/jpeg','image/webp'])
on conflict (id) do nothing;

-- Files live under <your user id>/…, and only you can read or write that folder
drop policy if exists "trading: screenshots own folder read"   on storage.objects;
drop policy if exists "trading: screenshots own folder write"  on storage.objects;
drop policy if exists "trading: screenshots own folder delete" on storage.objects;
create policy "trading: screenshots own folder read" on storage.objects for select to authenticated
  using (bucket_id = 'trading-screenshots' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "trading: screenshots own folder write" on storage.objects for insert to authenticated
  with check (bucket_id = 'trading-screenshots' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "trading: screenshots own folder delete" on storage.objects for delete to authenticated
  using (bucket_id = 'trading-screenshots' and (storage.foldername(name))[1] = auth.uid()::text);

-- ═════════════ Dashboard views (contract: ../../docs/CONTRACT.md, ours: ../docs/DATA_CONTRACT.md) ═════════════
-- Append-only: use "create or replace" and only ever ADD columns at the end. Never rename/remove/reorder.
-- Day = America/Toronto calendar date. security_invoker keeps RLS in force.

-- One row per user per day with any activity (chart, journal entry, trade opened or closed).
create or replace view public.trading_dashboard_daily
with (security_invoker = true) as
with obs as (
  select user_id, observed_on as day,
         count(distinct asset_id) as charts, sum(seconds_spent) as secs, max(created_at) as ts
  from public.trading_observations group by 1, 2
), jr as (
  select user_id, entry_on as day, count(*) as n, max(greatest(created_at, updated_at)) as ts
  from public.trading_journal_entries group by 1, 2
), op as (
  select user_id, opened_on as day, count(*) as n, max(created_at) as ts
  from public.trading_paper_trades group by 1, 2
), cl as (
  select user_id, closed_on as day, count(*) as n, max(created_at) as ts
  from public.trading_paper_trades where closed_on is not null group by 1, 2
), days as (
  select user_id, day from obs union select user_id, day from jr
  union select user_id, day from op union select user_id, day from cl
), runs as (            -- consecutive observation days share the same grp
  select user_id, day, day - (row_number() over (partition by user_id order by day))::int as grp from obs
), streaks as (
  select user_id, day, (row_number() over (partition by user_id, grp order by day))::int as streak from runs
), planned as (
  select user_id, count(*)::int as n from public.trading_assets where active group by 1
)
select
  d.user_id,
  d.day,
  'trading'::text                                         as app,
  coalesce(round(o.secs / 60.0), 0)::int                  as active_minutes,
  coalesce(o.charts, 0)::int                              as items_done,
  coalesce(p.n, 0)::int                                   as items_planned,
  coalesce(s.streak, s2.streak, 0)::int                   as streak_current,   -- no observation today: carry yesterday's streak forward, else 0 (broken)
  concat_ws(' · ',
    case when o.charts > 0 then o.charts || ' chart' || case when o.charts <> 1 then 's' else '' end end,
    case when j.n > 0 then j.n || ' journal' || case when j.n <> 1 then 's' else '' end end,
    case when a.n > 0 then a.n || ' opened' end,
    case when c.n > 0 then c.n || ' closed' end
  )                                                       as headline,
  greatest(o.ts, j.ts, a.ts, c.ts)                        as updated_at,
  coalesce(j.n, 0)::int                                   as journal_entries,
  coalesce(a.n, 0)::int                                   as trades_opened,
  coalesce(c.n, 0)::int                                   as trades_closed
from days d
left join obs o     on o.user_id = d.user_id and o.day = d.day
left join jr j      on j.user_id = d.user_id and j.day = d.day
left join op a      on a.user_id = d.user_id and a.day = d.day
left join cl c      on c.user_id = d.user_id and c.day = d.day
left join streaks s  on s.user_id = d.user_id and s.day = d.day
left join streaks s2 on s2.user_id = d.user_id and s2.day = d.day - 1
left join planned p on p.user_id = d.user_id;

-- One row per user (anyone who has a watchlist, which the app creates on first sign-in).
create or replace view public.trading_dashboard_now
with (security_invoker = true) as
with t as (
  select (now() at time zone 'America/Toronto')::date as d
), u as (
  select distinct user_id from public.trading_assets
), ob as (
  select o.user_id,
         count(*) filter (where o.prediction is not null and o.outcome is null and o.observed_on <= t.d - 7)::int as ready,
         count(*) filter (where o.outcome is not null)  as graded,
         count(*) filter (where o.outcome = 'right')    as right_n,
         min(o.observed_on)                             as first_day,
         max(o.created_at)                              as last_ts,
         count(distinct o.asset_id) filter (where o.observed_on = t.d)::int as done_today
  from public.trading_observations o cross join t group by o.user_id
), asx as (
  select user_id, count(*) filter (where active)::int as planned from public.trading_assets group by 1
), cn as (
  select user_id, count(*) filter (where learned)::int as learned, count(*)::int as total,
         max(learned_at) as last_ts
  from public.trading_concepts group by 1
), jn as (
  select user_id, max(greatest(created_at, updated_at)) as last_ts from public.trading_journal_entries group by 1
), tr as (
  select user_id,
         count(*) filter (where exit_price is null)::int as open_n,
         coalesce(sum(case when exit_price is null then 0
                           else coalesce(net_pnl_usd,   -- net USD set at close (phase 5a); older trades have none and use gross, which is what they always had
                                         (case when side = 'short' then entry_price - exit_price else exit_price - entry_price end) * quantity)
                      end), 0) as pnl,
         max(created_at) as last_ts
  from public.trading_paper_trades group by 1
), od as (
  select distinct user_id, observed_on as day from public.trading_observations
), odr as (            -- streak position of every observation day (same gaps-and-islands as the daily view)
  select user_id, day, (row_number() over (partition by user_id, grp order by day))::int as streak
  from (select user_id, day, day - (row_number() over (partition by user_id order by day))::int as grp from od) x
), st as (            -- app logic: streak ends today, or yesterday if today has no observation
  select u.user_id,
         coalesce(
           (select x.streak from odr x where x.user_id = u.user_id and x.day = t.d),
           (select x.streak from odr x where x.user_id = u.user_id and x.day = t.d - 1),
           0)::int as streak
  from u cross join t
)
select
  u.user_id,
  'trading'::text                                         as app,
  1                                                       as contract_version,
  concat_ws(' · ',
    coalesce(ob.done_today, 0) || '/' || coalesce(asx.planned, 0) || ' charts today',
    case when st.streak > 0 then st.streak || '-day streak' end
  )                                                       as status_line,
  coalesce(ob.ready, 0)::int                              as needs_attention,
  'guesses to grade'::text                                as attention_label,
  greatest(ob.last_ts, cn.last_ts, jn.last_ts, tr.last_ts) as last_activity_at,
  now()                                                   as updated_at,
  coalesce(cn.learned, 0)::int                            as concepts_learned,
  coalesce(cn.total, 0)::int                              as concepts_total,
  case when ob.graded > 0 then round(100.0 * ob.right_n / ob.graded)::int end as guess_accuracy_pct,
  coalesce(tr.open_n, 0)::int                             as open_trades,
  coalesce(tr.pnl, 0)                                     as paper_pnl_closed,
  coalesce(se.paper_balance, 10000) + coalesce(tr.pnl, 0) as paper_balance,
  case when ob.first_day is not null then (t.d - ob.first_day + 1)::int end as challenge_day
from u
cross join t
left join ob  on ob.user_id  = u.user_id
left join asx on asx.user_id = u.user_id
left join cn  on cn.user_id  = u.user_id
left join jn  on jn.user_id  = u.user_id
left join tr  on tr.user_id  = u.user_id
left join st  on st.user_id  = u.user_id
left join public.trading_settings se on se.user_id = u.user_id;

grant select on public.trading_dashboard_daily to authenticated;
grant select on public.trading_dashboard_now   to authenticated;
