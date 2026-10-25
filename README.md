# Chart Journal

A local app for learning to read charts. It saves everything to your shared PersonalOS Supabase project (tables start with `trading_`), so when you close it and start it again, your checked concepts, observations, screenshots and journal are all still there.

**What's inside**

Tabs, left to right: **Progress · Watchlist · Today · Learn**, plus **⚙ Settings** on the far right. (A **Practice trades** tab exists but is frozen and hidden; turn it on in Settings → *Show practice trades* if you ever want it.)

Paper trade in TradingView Paper Trading or Bybit Demo; journal the lesson here.

- **Progress**: one page with three sections.
  - *Overview*: 30-day challenge counter, streak, minutes watched, guess accuracy, which sites you use, and a heatmap of which charts you looked at each day.
  - *Journal*: daily entries with tags, confidence and search.
  - *History*: every observation, with screenshots. 7 days after a guess, type the price now and the app works out the % move and grades it (right / mixed / wrong). A badge on the Progress tab shows how many are ready.
- **Watchlist**: add, edit, reorder (inside a group), or switch assets on/off. Each asset has its TradingView symbol, Yahoo symbol and (optionally) a Moneycontrol link, plus a Coinglass link for crypto. Leave a symbol empty to hide that button; an asset with no symbols at all shows "Not listed yet" (e.g. pre-IPO companies). New default assets are added to your existing list automatically, without touching anything you changed or deleted. Aim for 10–20 active.
- **Today**: your watchlist as a daily checklist. Open an asset → a 5-minute timer starts → open the chart in **TradingView, Yahoo Finance or Moneycontrol** (crypto also gets **Coinglass** and **Heatmap** buttons) → note where you looked, the **timeframes you checked**, the trend, support/resistance, volume, notes, news, **screenshots**, and a guess for next week → save. That asset gets ticked off and the next one opens. For crypto there are also fields for the liquidation clusters above and below price, where stop losses likely sit, and whether you checked the liquidation map. (A small built-in TradingView chart is there if you want it, and **All timeframes** opens one small chart per timeframe you ticked; click ⤢ on a tile to enlarge it. The free TradingView widget can't show 8h or 12h, so those show 4h with a note, and 1Y shows daily candles over 12 months.)
- **Learn**: 52 concepts in 6 phases. **Phase 0 · Start here (from Anikait)** comes first (spot vs futures, leverage, liquidation maps, order book, market makers, BTC.D…), then Foundations through Going deeper. Tick them off and keep your own notes. The **Words I don't understand** card at the top collects terms to ask Anikait about (tick Asked / Understood, or promote one to a concept); **＋ Word** in the header adds one from any tab.
- **Practice trades** (frozen, hidden by default): the old fake-money trade tracker is still in the app with all its data. Settings → *Show practice trades* brings the tab back; while it is off nothing runs for it (no price requests, alerts or notifications). Exports still include practice trades if you have any.
- **⚙ Settings**: your account and Sign out (more options coming).

Assets are always grouped **US market → Resources → Crypto → India → Other**.

---

## Setup (about 10 minutes, once)

### 1. Use the shared PersonalOS Supabase project
All PersonalOS apps share **one** Supabase project; don't create a second one.
1. If it doesn't exist yet: sign up at https://supabase.com and create a **new project** (free plan is fine). Save the database password somewhere.
2. Wait for it to finish provisioning.

### 2. Create the tables, views and screenshot storage
1. In the left sidebar open **SQL Editor** → **New query**.
2. Open `supabase/trading_schema.sql` from this folder, copy everything, paste, click **Run**. You should see "Success. No rows returned".
3. Check: **Table Editor** shows 7 tables (`trading_assets`, `trading_observations`, `trading_concepts`, `trading_journal_entries`, `trading_paper_trades`, `trading_settings`, `trading_glossary`), 2 views (`trading_dashboard_daily`, `trading_dashboard_now`), and **Storage** shows a private bucket called `trading-screenshots`.

Running the file again later is safe; it only adds what's missing and never deletes data. This app only touches `trading_` objects.

### 3. Make sign-up easy
This app uses a normal email + password login so only you can see your data. It is the **same login for every PersonalOS app**: create the account once, then sign in with it in each app.
- Easiest: **Authentication → Sign In / Providers → Email** and switch **off** "Confirm email". Then "Create account" signs you straight in.
- Or keep it on, and set **Authentication → URL Configuration → Site URL** to `http://localhost:5173` so the confirmation link brings you back to the app.

### 4. Connect the app
1. Go to **Project Settings → API** (called **API Keys** in newer dashboards).
2. Copy the **Project URL** and the **anon** (or **publishable**) key.
3. Copy `config.example.js` to `config.js` (it is gitignored so your keys stay out of git), open it in a text editor, and paste them between the quotes. Save.

> Never paste the `service_role` / secret key into this app.

### 5. Start it
- **Mac / Linux:** open Terminal in this folder and run `sh start.sh`.
- **Windows:** double-click `start.bat`.

Your browser opens **http://localhost:5173**. The first time, click **Create account**; on later apps and visits, just sign in with the same account. The watchlist and concept list are loaded automatically on first sign-in.

To stop: press `Ctrl+C` in the terminal (or close the window on Windows). Start it again the same way; you stay signed in.

If port 5173 is already in use, the script stops with a message instead of picking another port (PersonalOS gives every app a fixed port).

`start.sh` / `start.bat` run `serve.py`, a tiny server that tells the browser never to keep a copy of the app files (`Cache-Control: no-store`), so after an update you always get the new version. **Settings → Account** shows the app version your browser is running; if it doesn't match `docs/BUILD_STATUS.md`, reload with Cmd/Ctrl+Shift+R.

The start scripts need **Python 3** (on a Mac, accept the "install developer tools" prompt if it appears) or **Node.js** as a fallback.

---

## Screenshots
- **On a Mac:** press **⌘⇧⌃4** (Cmd+Shift+Control+4), drag over the chart, then click in the app and press **⌘V**. Or use **Add screenshot**, or drag an image file onto the box.
- Screenshots upload when you click **Save observation**. You can add more later from the **＋** tile on any card in History.
- They're shrunk to a sensible size before uploading, so the free 1 GB of Supabase storage lasts years.

## Grading guesses
Save the **current price** with your guess. A week later, open **History** (the badge shows how many are ready), type the **price now**, and press **Check guess**:
- Guessed **up**: right if it rose 1% or more, wrong if it fell 1% or more, otherwise mixed.
- Guessed **down**: the opposite.
- Guessed **flat**: right if it moved less than 1%, wrong if it moved more than 3%.
You can always override with the Right / Mixed / Wrong buttons.

## Tips
- **Moneycontrol** pages don't have simple symbol links, so the button runs a search until you paste the exact page link into **Watchlist → Edit**.
- Symbol formats: TradingView `EXCHANGE:TICKER` (`NASDAQ:AMZN`, `NSE:RELIANCE`); Yahoo `AMZN`, `BTC-USD`, `GC=F` (gold), `RELIANCE.NS`.
- Your data is plain Postgres: browse it any time in Supabase → **Table Editor**.

## Files
| File | What it is |
|---|---|
| `index.html`, `app.js`, `styles.css` | The app |
| `seed.js` | Default watchlist, patterns and concept checklist |
| `config.js` | Your Supabase URL + key (gitignored; copy from `config.example.js`) |
| `supabase/trading_schema.sql` | Tables, dashboard views, screenshot storage and security rules |
| `docs/DATA_CONTRACT.md` | The two views the PersonalOS dashboard reads |
| `CLAUDE.md`, `docs/BUILD_STATUS.md` | Rules and status for Claude Code sessions |
| `start.sh`, `start.bat`, `serve.py`, `serve.json` | Local launchers and the no-cache server (`serve.json` does the same for the `npx serve` fallback) |
| `trade.js`, `stats.js`, `tradeexport.js`, `tests/` | Practice-trade maths, stats and export builders (pure, run in the browser and in node). Run the tests with `node tests/stats.test.js` and `node tests/trade.test.js` |
