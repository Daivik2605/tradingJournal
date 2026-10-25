# Phase 5c: test checklist for your real account

Before you start
1. **Run the SQL.** Supabase → your project → SQL Editor → New query → paste all of `supabase/trading_schema.sql` → Run. You should see "Success". Running it a second time is safe.
2. **Restart the app so it uses the new server.** In the terminal where it runs press Ctrl+C, then `sh start.sh` (or in PersonalOS Home: Stop, then Start). The terminal must say `serving http://127.0.0.1:5173 (Cache-Control: no-store)`.
3. Open http://localhost:5173, sign in, press Cmd+Shift+R (Windows: Ctrl+Shift+R). **⚙ Settings → Account** must say **App version 5c.1**. If it says "unknown" or the number is missing, your browser is still showing an old copy.

A. Bugs
- **A1 + typo guard on existing trades.** Practice trades → Open trades. An old trade with the red "check values" badge now lists what's wrong in red under its title (wrong-side target, or "Entry … is 97% lower than the live price"). Within a minute the red/green bar at the top of the page says the price reached its target/stop, with **Fix values first** and **no** "Close at this price". Click **Fix values first**: a window titled "Edit …" opens, listing the problems.
- **A2 Edit.** In that window press **Save changes** without changing anything: a red message names the bad field and nothing is saved. Fix the values (for example target above entry for a long) and Save: the window closes, the badge disappears, and the card shows "✎ edited 4×" (hover it to see old → new for each field). Then on a futures trade press ✎ and type a stop beyond the liquidation price: it's refused with a message. Press ✎ on a *closed* trade: you only get feeling, plan, mistakes, rating and "what you learned", not prices.
- **Delete the bad closed trade.** Closed trades → find the one with the huge profit (+$7,867,500) → click **×** → a window shows "Balance $… → $…" and "available $… → $…" → **Delete trade**. The Balance card, Stats ("closed trades" count) and the equity curve all change straight away.
- **A3 Cache.** Settings → Account shows the version (step 3 above). In the terminal, `curl -I http://127.0.0.1:5173/app.js` shows `Cache-Control: no-store`.
- **A4 Equity colour.** The "equity" card is green when the number is above your starting balance (Settings → Defaults) and red when below, whatever the unrealised line says.
- **A5 Draft.** In the "Open a practice trade" form choose BTC, type Entry 100, Quantity 2, tick "I checked the higher timeframe", write a reason. Press Cmd+R. Click **Practice trades**: everything you typed is back. Click **Clear form** (top right of the form): it empties.
- **Entry typo guard.** In the form choose a crypto asset, type an Entry about ten times smaller than the live price shown under the asset (for example 8007 when it says $80,652), Quantity 0.01, Stop a bit below, then **Open trade**. A window says "BTC is $80,652.00 now; your entry 8,007 is 90% lower. Missing a digit?" **Go back** saves nothing; **Open anyway** would save it.

B. Money
- **B6.** The top cards now read: Balance, In trades, Available (then profit/loss, win rate, …, equity). Available = Balance − In trades. Type a Quantity so big that the position costs more than Available and press **Open trade**: a window "More than your available cash" explains the numbers. **Go back**.
- **B7.** Choose asset GOLD, Entry 2000, Stop 1999, Risk % 1. Under the form the Size helper says "quantity … **capped by available cash**" and shows "risk alone would be 31.2…" if you have about $10,000 free. The suggested quantity times the price (+0.055% fee) is never more than Available. With $10,000 and nothing else open it is 4.9972.

C. Help for a beginner
- **C8.** Choose Setup "breakout": the line "price breaks through a level it kept failing at" shows under the menu. Settings → Setup tags: each tag has a description box; edit "news", click away (a "saved" message appears), go back to the form and choose "news": your text shows.
- **C9.** Entry 100, Stop 95, Target 103: under "Reward/risk is at least 1.5" it says "Reward/risk is 0.60 now. Set target ≥ 107.5 to make it 1.5." For a crypto asset, "I checked the liquidation map" has a link "Open BTC on Coinglass ↗". Type a Quantity too big for your risk %: the risk line says "Lower the quantity to … or tighten your stop." Items that are ticked lose their help line.
- **C10.** Open a trade on gold, oil, DJI or an India stock (no live price). Its card has "Price now" with a box in the top line: "type the current price from TradingView to see your P&L". Type a price: unrealised P&L and equity update (labelled "typed HH:MM"). It's never saved and never triggers alerts.

D. Review and export
- **D11.** On an open card press **Close this trade**. New: "Did you follow your plan?", "Mistakes" (tick several), "Rating" 1–5. Close it. The closed card shows "followed plan"/"didn't follow plan", red mistake tags and stars. In the Stats panel a table "Win rate by plan followed" appears. Settings → Trade mistakes lets you add or remove mistakes.
- **D12.** Keep the app open (page visible) for a few minutes with an open crypto trade. The card shows "Price range seen: worst … best … only covers time the app was open". Closed trades keep it.
- **D13.** Settings → **Download everything (.zip)**: the zip has a `practice` folder with `trades.csv`, `fills.csv`, `stats.csv`, `equity_curve.csv`, a `README.txt` that lists every column, and the `data` folder CSVs have no `user_id` and end with the id columns. Practice trades → **⬇ Export trades** → Download: a `practice_….zip` with the same four files + README. Watchlist → **⬇ CSV** on a stock you traded: a zip containing `metrics.csv` and the four trade files; on a stock with no trades: a plain CSV as before.
