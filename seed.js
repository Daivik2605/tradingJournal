// Default watchlist + concept checklist. Loaded into Supabase the first time you sign in.
// After that, edit everything from inside the app (Watchlist / Concepts tabs).
window.TJ_SEED = {
  // Bump when ASSETS gains entries with a higher `since`. Each account remembers the version it has been offered (trading_settings.seed_assets_v).
  ASSETS_VERSION: 2,
  // Same idea for concepts (trading_settings.seed_concepts_v). Bump when CONCEPTS gains entries with a higher `since`, or `moved` rows.
  CONCEPTS_VERSION: 2,

  // Display order everywhere (Today, Watchlist, heatmap, trade dropdown): US → Resources → Crypto → India → Other
  CATEGORIES: [
    ["us", "US market"],
    ["resource", "Resources"],
    ["crypto", "Crypto"],
    ["india", "India"],
    ["other", "Other"],
  ],

  ASSETS: [
    // Crypto — trades 24/7
    { symbol: "BTC", name: "Bitcoin", category: "crypto", tv_symbol: "BITSTAMP:BTCUSD", yahoo_symbol: "BTC-USD", yahoo_symbol: "BTC-USD", active: true,
      why: "The leader. Most of crypto follows its direction, so read this one first." },
    { symbol: "ETH", name: "Ethereum", category: "crypto", tv_symbol: "BITSTAMP:ETHUSD", yahoo_symbol: "ETH-USD", yahoo_symbol: "ETH-USD", active: true,
      why: "#2 crypto. Compare it to BTC: is it moving more, less, or differently?" },
    { symbol: "SOL", name: "Solana", category: "crypto", tv_symbol: "COINBASE:SOLUSD", yahoo_symbol: "SOL-USD", yahoo_symbol: "SOL-USD", active: true,
      why: "Higher-risk crypto. Usually exaggerates BTC's moves in both directions." },

    // Resources
    { symbol: "GOLD", name: "Gold (spot, USD/oz)", category: "resource", tv_symbol: "TVC:GOLD", yahoo_symbol: "GC=F", yahoo_symbol: "GC=F", active: true,
      why: "Classic safe haven. Watch how it reacts to fear, interest rates and the US dollar." },
    { symbol: "SILVER", name: "Silver (spot)", category: "resource", tv_symbol: "TVC:SILVER", yahoo_symbol: "SI=F", yahoo_symbol: "SI=F", active: true,
      why: "Gold's jumpier cousin: part precious metal, part industrial metal." },
    { symbol: "WTI", name: "Crude oil (WTI)", category: "resource", tv_symbol: "TVC:USOIL", yahoo_symbol: "CL=F", yahoo_symbol: "CL=F", active: true,
      why: "The parent of petrol and diesel prices. Very sensitive to news and geopolitics." },
    { symbol: "URA", name: "Uranium (URA miners ETF)", category: "resource", tv_symbol: "AMEX:URA", yahoo_symbol: "URA", yahoo_symbol: "URA", active: true,
      why: "Uranium has no liquid spot chart; this ETF of uranium miners is the easiest proxy." },

    // US market
    { symbol: "SPY", name: "S&P 500 (SPY ETF)", category: "us", tv_symbol: "AMEX:SPY", yahoo_symbol: "SPY", yahoo_symbol: "SPY", active: true,
      why: "The whole US market in one chart. Your baseline for judging every US stock." },
    { symbol: "QQQ", name: "Nasdaq-100 (QQQ ETF)", category: "us", tv_symbol: "NASDAQ:QQQ", yahoo_symbol: "QQQ", yahoo_symbol: "QQQ", active: true,
      why: "Tech-heavy index. Compare with SPY to see whether tech is leading or lagging." },
    { symbol: "AAPL", name: "Apple", category: "us", tv_symbol: "NASDAQ:AAPL", yahoo_symbol: "AAPL", yahoo_symbol: "AAPL", active: true,
      why: "Mega-cap, steady trender. Watch how it moves around earnings." },
    { symbol: "MSFT", name: "Microsoft", category: "us", tv_symbol: "NASDAQ:MSFT", yahoo_symbol: "MSFT", yahoo_symbol: "MSFT", active: true,
      why: "Mega-cap tech. Often moves with QQQ; spot the days it doesn't." },
    { symbol: "GOOGL", name: "Alphabet (Google)", category: "us", tv_symbol: "NASDAQ:GOOGL", yahoo_symbol: "GOOGL", yahoo_symbol: "GOOGL", active: true,
      why: "Mega-cap tech. Compare its swings with AAPL and MSFT." },
    { symbol: "NVDA", name: "Nvidia", category: "us", tv_symbol: "NASDAQ:NVDA", yahoo_symbol: "NVDA", yahoo_symbol: "NVDA", active: true,
      why: "The AI bellwether. Big, fast moves make momentum and volume easy to see." },
    { symbol: "LMT", name: "Lockheed Martin", category: "us", tv_symbol: "NYSE:LMT", yahoo_symbol: "LMT", yahoo_symbol: "LMT", active: true,
      why: "Defense stock. Moves on contracts and geopolitics, often unlike tech." },

    // India (light focus)
    { symbol: "RELIANCE", name: "Reliance Industries", category: "india", tv_symbol: "BSE:RELIANCE", yahoo_symbol: "RELIANCE.NS", yahoo_symbol: "RELIANCE.NS", active: true,
      why: "India's largest company. One chart to keep a pulse on Indian markets." },

    // Optional extras — switch on in the Watchlist tab when you're ready
    { symbol: "TCS", name: "Tata Consultancy Services", category: "india", tv_symbol: "BSE:TCS", yahoo_symbol: "TCS.NS", yahoo_symbol: "TCS.NS", active: false,
      why: "Largest Tata group company. Add once Reliance feels familiar." },
    { symbol: "GASOLINE", name: "RBOB gasoline futures (petrol)", category: "resource", tv_symbol: "NYMEX:RB1!", yahoo_symbol: "RB=F", yahoo_symbol: "RB=F", active: false,
      why: "Mostly follows crude. Compare it with WTI once crude makes sense." },
    { symbol: "DIESEL", name: "Heating oil / ULSD futures (diesel)", category: "resource", tv_symbol: "NYMEX:HO1!", yahoo_symbol: "HO=F", yahoo_symbol: "HO=F", active: false,
      why: "The diesel benchmark. Also mostly follows crude." },
    { symbol: "CCJ", name: "Cameco (uranium miner)", category: "resource", tv_symbol: "NYSE:CCJ", yahoo_symbol: "CCJ", yahoo_symbol: "CCJ", active: false,
      why: "Single biggest listed uranium miner. An alternative to URA." },

    // ── Added in round 2 (since: 2). Existing accounts get these on next sign-in, matched by symbol; nothing already there is touched.
    { since: 2, symbol: "TSLA", name: "Tesla", category: "us", tv_symbol: "NASDAQ:TSLA", yahoo_symbol: "TSLA", active: true,
      why: "Big, volatile US stock that many traders follow. Good for watching how news moves price." },
    { since: 2, symbol: "SPCX", name: "SpaceX", category: "us", tv_symbol: "NASDAQ:SPCX", yahoo_symbol: "SPCX", active: true,
      why: "Listed on Nasdaq since 12 Jun 2026. A recent IPO: watch how price settles after the hype." },
    { since: 2, symbol: "DJI", name: "Dow Jones Industrial Average", category: "us", tv_symbol: "TVC:DJI", yahoo_symbol: "^DJI", active: true,
      why: "Index of 30 big US companies. Can't be traded directly (the ETF is DIA). Compare it with SPY and QQQ." },
    { since: 2, symbol: "HYPE", name: "Hyperliquid", category: "crypto", tv_symbol: "COINBASE:HYPEUSD", yahoo_symbol: "HYPE32196-USD", active: true,
      why: "Token of the Hyperliquid perpetuals exchange. Compare its moves with BTC and SOL." },
    { since: 2, symbol: "BTC.D", name: "Bitcoin dominance", category: "crypto", tv_symbol: "CRYPTOCAP:BTC.D", active: true,
      why: "BTC's share of total crypto market cap, not a price. It shows whether money is flowing into Bitcoin or into altcoins." },
    { since: 2, symbol: "ANTHROPIC", name: "Anthropic (pre-IPO)", category: "us", active: false,
      why: "Not public yet (IPO expected around late Nov 2026). Fill in the symbols in Watchlist → Edit when it lists, then switch it on." },
    { since: 2, symbol: "OPENAI", name: "OpenAI (pre-IPO)", category: "us", active: false,
      why: "Not public yet (IPO not expected before 2027). Fill in the symbols in Watchlist → Edit when it lists, then switch it on." },
  ],

  PATTERNS: [
    "Higher highs & higher lows", "Lower highs & lower lows", "Range / chop",
    "Bounced off support", "Rejected at resistance", "Breakout above resistance",
    "Breakdown below support", "Volume spike", "Gap up", "Gap down",
    "Above 200-day MA", "Below 200-day MA", "Double top", "Double bottom",
    "Big single candle", "Moving with its group", "Moving against its group",
  ],

  EMOTIONS: ["Calm", "Confident", "Excited", "FOMO", "Nervous", "Bored", "Revenge"],
  EXIT_REASONS: ["Hit target", "Hit stop loss", "Changed my mind", "Time limit", "News", "Other"],

  PHASES: [
    { n: 0, title: "Start here (from Anikait)", hint: "Learn these first. They're the words Anikait uses when he talks about crypto and liquidation maps." },
    { n: 1, title: "Foundations", hint: "Learn these in week 1, before or while you start watching charts." },
    { n: 2, title: "Reading charts", hint: "Weeks 2–4. Names for the things you're already noticing." },
    { n: 3, title: "What moves markets", hint: "Month 2+. Why charts move, not just how." },
    { n: 4, title: "Risk & trading mechanics", hint: "Before any real money. This is what keeps traders alive." },
    { n: 5, title: "Going deeper", hint: "Later in your 5-year path." },
  ],

  CONCEPTS: [
    // Phase 0 (round 2, phase 3). `since: 2` = new rows existing accounts are offered once. `moved: 2` = the row already exists in
    // phase 1/4; accounts that have not seen version 2 get it moved here by title (notes and ticks untouched). New accounts get all of them.
    { phase: 0, sort: 0,  since: 2, title: "Spot vs futures (perpetuals)", detail: "Spot = you own the coin. A futures or perpetual contract is a bet on its price, so you can go long or short with leverage and never hold the coin." },
    { phase: 0, sort: 1,  moved: 2, title: "Long vs short", detail: "Profiting from rises vs falls, and why shorting has unlimited risk." },
    { phase: 0, sort: 2,  moved: 2, title: "Leverage, margin & liquidation", detail: "Especially in crypto: how small moves wipe out leveraged accounts." },
    { phase: 0, sort: 3,  since: 2, title: "Stop losses: your exit, and other people's", detail: "Your stop is the exit you plan before you enter. Price is often drawn towards levels where lots of other traders' stops sit." },
    { phase: 0, sort: 4,  moved: 2, title: "Support & resistance", detail: "Price 'floors' where buyers step in and 'ceilings' where sellers do." },
    { phase: 0, sort: 5,  since: 2, title: "Flags (chart pattern)", detail: "A short pause (a small tilted box) in a strong move, often before it continues the same way." },
    { phase: 0, sort: 6,  since: 2, title: "Liquidation map (Coinglass)", detail: "Shows where leveraged positions would be wiped out, and the price levels price might get pulled to." },
    { phase: 0, sort: 7,  since: 2, title: "Liquidation heatmap & liquidation history", detail: "The heatmap shows clusters over time; the history shows what actually got liquidated. Bright bands = many positions." },
    { phase: 0, sort: 8,  since: 2, title: "How to read these maps", detail: "Compare current price with the nearest big clusters above and below. Check the 48-hour view and the weekly view, higher timeframes first." },
    { phase: 0, sort: 9,  since: 2, title: "Order book", detail: "The list of waiting buy and sell orders at each price. A 'wall' is a very large order that can stall price." },
    { phase: 0, sort: 10, since: 2, title: "Market makers", detail: "Firms that keep buy and sell orders on the book so others can trade: Wintermute or Jump in crypto, Citadel Securities or Virtu in stocks, plus the exchanges themselves (e.g. Binance)." },
    { phase: 0, sort: 11, since: 2, title: "Bitcoin dominance (BTC.D)", detail: "BTC's share of the whole crypto market. Falling dominance often means money is moving into altcoins; rising means it's hiding in Bitcoin." },

    // Phase 1
    { phase: 1, title: "Stocks, indexes, ETFs, commodities & crypto", detail: "What you actually own (or don't) with each, and why SPY is a stock-like ETF that tracks an index." },
    { phase: 1, title: "Exchanges & market hours", detail: "NYSE/Nasdaq 9:30am–4:00pm ET on weekdays, pre/after-hours, crypto 24/7, NSE/BSE in India time." },
    { phase: 1, title: "Tickers & reading a quote", detail: "Ticker symbols, bid/ask, spread, daily volume, market cap." },
    { phase: 1, title: "Candlesticks (OHLC)", detail: "Each candle = open, high, low, close for one period. Body vs wick, green vs red." },
    { phase: 1, title: "Timeframes", detail: "Same asset, different stories on 1W, 1D, 4H, 1H. Start with daily." },
    { phase: 1, title: "Trend: uptrend, downtrend, sideways", detail: "Higher highs + higher lows = up; lower highs + lower lows = down." },
    { phase: 1, title: "Volume", detail: "How much traded. Big moves on big volume mean more than big moves on thin volume." },
    { phase: 1, title: "Linear vs log price scale", detail: "Why long-term BTC charts are shown on log scale." },

    // Phase 2
    { phase: 2, title: "Moving averages (20 / 50 / 200)", detail: "SMA vs EMA, price above/below the 200-day, golden & death crosses." },
    { phase: 2, title: "Candlestick patterns", detail: "Doji, hammer, shooting star, engulfing. Signals, not guarantees." },
    { phase: 2, title: "Chart patterns", detail: "Double top/bottom, head & shoulders, triangles, flags, channels." },
    { phase: 2, title: "Breakouts vs fakeouts", detail: "Why many breakouts fail, and what volume tells you." },
    { phase: 2, title: "Gaps", detail: "Why stocks jump overnight (earnings, news) and crypto rarely gaps." },
    { phase: 2, title: "RSI & momentum", detail: "Overbought/oversold, and divergence between price and momentum." },
    { phase: 2, title: "MACD", detail: "Trend + momentum indicator built from moving averages." },
    { phase: 2, title: "Volatility & ATR", detail: "How much an asset normally moves per day. SOL vs SPY is a huge difference." },
    { phase: 2, title: "Multi-timeframe analysis", detail: "Weekly for direction, daily for structure, lower timeframes for timing." },

    // Phase 3
    { phase: 3, title: "Correlation", detail: "BTC–ETH–SOL, SPY–QQQ–big tech, gold–silver, oil–energy stocks." },
    { phase: 3, title: "Interest rates & the Fed", detail: "Why rate decisions move stocks, gold and crypto at the same time." },
    { phase: 3, title: "Inflation (CPI) & jobs reports", detail: "The monthly data releases that cause big market days." },
    { phase: 3, title: "The US dollar (DXY)", detail: "Strong dollar often pressures gold, oil and crypto." },
    { phase: 3, title: "Earnings season", detail: "How and why stocks gap on quarterly results and guidance." },
    { phase: 3, title: "Risk-on vs risk-off", detail: "When money runs to safety (gold, bonds) vs chases growth (tech, crypto)." },
    { phase: 3, title: "Sentiment & Fear/Greed", detail: "Crowd emotion as a contrarian signal." },
    { phase: 3, title: "Market cycles", detail: "Bull/bear markets, corrections, and crypto's 4-year halving cycle." },
    { phase: 3, title: "Oil supply & geopolitics", detail: "OPEC+, inventories, wars and sanctions as oil drivers." },

    // Phase 4
    { phase: 4, title: "Order types", detail: "Market, limit, stop, stop-limit, trailing stop." },
    { phase: 4, title: "Position sizing (the 1–2% rule)", detail: "Never risk more than a small slice of your account on one trade." },
    { phase: 4, title: "Stop losses & risk/reward", detail: "Decide your exit before you enter. Aim for reward ≥ 2× risk." },
    { phase: 4, title: "Fees, spreads & slippage", detail: "The hidden costs that kill frequent trading." },
    { phase: 4, title: "Trading psychology", detail: "FOMO, revenge trading, overconfidence, and sticking to a plan." },
    { phase: 4, title: "Paper trading", detail: "Practise with fake money until your results are consistent." },
    { phase: 4, title: "Trade journaling", detail: "Record entry, exit, reason and emotion for every trade. You're already practising this." },
    { phase: 4, title: "Backtesting a simple strategy", detail: "Test a rule on past data before trusting it." },

    // Phase 5
    { phase: 5, title: "Fundamental analysis basics", detail: "Revenue, earnings, P/E, margins, what makes a business worth more." },
    { phase: 5, title: "Futures contracts", detail: "How oil, gold and index futures work, expiries and rollover." },
    { phase: 5, title: "Options basics", detail: "Calls, puts, premium, expiry. Powerful and easy to lose money with." },
    { phase: 5, title: "Crypto specifics", detail: "Exchanges vs wallets, custody, stablecoins, on-chain data, ETF flows." },
    { phase: 5, title: "Taxes on trading where you live", detail: "Capital gains, tax-advantaged accounts, and when trading counts as business income." },
    { phase: 5, title: "Building your own strategy & rules", detail: "Turn everything you've learned into a written, testable plan." },
  ],
};
