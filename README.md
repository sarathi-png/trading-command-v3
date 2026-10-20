# Trading Command

A private, personal trading intelligence terminal: CoinDCX Futures market data,
TradingView Lightweight Charts rendering, a modular strategy/signal engine, risk tooling,
paper trading and a trade journal — in one dark, low-clutter workspace.

It is **not** a TradingView/CoinDCX/OSIRIS clone. It is a personal command center that answers:
*Where is price? What is the market doing? What is my setup? What is my position? What is my risk?*

Three things it does that most retail terminals do not:

1. **No unexplained abbreviations.** Every overlay drawn on a chart is decoded in
   full words, both in a "WHAT IS ON THIS CHART" legend and by switching the
   price-axis labels from short tokens (`CD:D20-U`) to full names
   (`DONCHIAN 20 · UPPER BOUND`).
2. **Layouts that adapt to the screen, not just the width.** Grids reflow from
   the available space, and the shape of the viewport decides what sits side by
   side: two charts and a watchlist rail on a wide landscape monitor, a stacked
   single column on a phone or a tall split window.
3. **Predictions you can hold to account.** The AI panel (5-minute frame,
   Chandelier Exit + Donchian ribbon) writes a structured call on both the
   candlestick and Heikin-Ashi charts, and every call is recorded so its outcome
   can be scored against what price actually did.

> **Latest review (October 2026):** strategy correctness, runtime and interface audit —
> findings, fixes, design benchmark and the forward roadmap are in
> `docs/AUDIT_2026-10.md`. Headline items: Donchian windowing, backtest look-ahead and
> Heikin-Ashi fill bias, position sizing, the `demo`/`live` data-source path, and a
> readiness-first overview. A short plan (with a status note) lives in
> `docs/IMPROVEMENT_PLAN.md`. Interface benchmark (goods/bads from TradingView, Coinbase
> Advanced, Kraken Pro, Bybit, Binance, Zerodha Kite and Bloomberg Terminal, with an
> anti-pattern audit of this project): `docs/DESIGN_BENCHMARK.md`. Competitive gap analysis and
> the futuristic roadmap: `docs/FUTURE_ROADMAP.md`.

## Quick start

```bash
npm install
cp .env.example .env          # defaults run fully in demo mode
npx drizzle-kit push          # create tables
npm run dev
```

Private account data (balances, positions, orders) additionally needs
`COINDCX_API_KEY` / `COINDCX_API_SECRET` in the environment — see
`docs/COINDCX_SETUP.md`. Tests: `npm test` runs the quant suite, the v2 strategy/regression suite, the CoinDCX
adapter suite (signing vectors + a mock venue), the standalone gateway suite, a
production build, the paper-trading end-to-end test and the Vercel↔CoinDCX
boundary test.

Fonts (Inter, JetBrains Mono) are bundled via `@fontsource-variable/*`, so no build-time
font download is required.

Market data follows the **Data source** setting in Settings → Market data: `demo` uses the
deterministic simulator and `live` reads CoinDCX public REST. There is no silent fallback
between them — a failed live request surfaces as an error, never as fabricated data.

Open the app, complete the 5-step onboarding, done. Without any credentials the
workspace runs on a **clearly-labelled deterministic demo simulator** (candles print live
as time advances).

## Modes (progression of trust)

| Mode | What it does | How to reach it |
|---|---|---|
| **READ ONLY** (default) | Data, analysis, journal. No order entry. | Default |
| **PAPER** | Simulated orders/positions vs live-style prices, risk limits enforced, auto-journalled | Settings → Execution |
| **LIVE** | Order routing to CoinDCX Futures — only with `LIVE_EXECUTION_ENABLED=true`, LIVE mode, the master switch armed, and a verifiable daily P&L read from the venue (if it cannot be proven, submission stays blocked) | Env + Settings |

## CoinDCX Futures, and why there is no gateway any more

CoinDCX does not require an IP-bound API key for futures trading (Delta
Exchange India did), so private calls go **straight from the Vercel serverless
function to CoinDCX**, signed there:

```
Browser → /api/* (Vercel serverless functions, auth by proxy.ts)
                │  COINDCX_API_KEY / COINDCX_API_SECRET (server-side env only)
                ▼
        https://api.coindcx.com   — wallets, positions, orders, fills
        https://public.coindcx.com — candles, order book, live prices
```

- **Public data** needs no credentials at all.
- **Private data and orders** are signed in the same process that serves the
  request; nothing is stored in the database, nothing is exposed to the browser,
  and no second host exists to keep alive.
- `trading-gateway/` is still in the repository as a standalone, self-contained
  service for a Delta-era deployment, but **this application never calls it** —
  the end-to-end test asserts that it receives zero requests. It is not part of
  any deployment step.

### Live trading is off by default — and gated twice over

Live orders require `LIVE_EXECUTION_ENABLED=true`, LIVE mode armed with the
confirmation token in the UI, **and** a daily realised P&L that can actually be
proven from CoinDCX. `liveRealizedPnlToday()` reads the venue and returns `null`
whenever the figure is not verifiable; the risk layer treats `null` as unknown
and refuses. A daily-loss limit that assumes zero loss is not a limit.

### Order safety without a client order id

CoinDCX futures has no client order id, so idempotency is ours alone: the
request is claimed in Postgres (`live_orders.client_order_id`, unique) **before**
submission, sent **exactly once**, and an uncertain outcome is marked `unknown`
and **reconciled** — never retried. See `docs/COINDCX_SETUP.md` §6.

## Feature flags

All sensitive capabilities default OFF: `LIVE_EXECUTION_ENABLED`, `TRADINGVIEW_WEBHOOK_ENABLED`,
`TELEGRAM_ENABLED`. Paper trading, strategy engine, order book and auto-S/R default ON but can
be disabled. Full list in `.env.example`.

## Documentation

- `docs/COINDCX_SETUP.md` — API keys (no IP binding), signing, endpoints, verification, troubleshooting
- `docs/VERCEL_DEPLOYMENT.md` — Vercel-only deployment, environment, database, serverless constraints
- `docs/EXCHANGE_MIGRATION.md` — Delta → CoinDCX map, what was removed/kept, idempotency, rollback
- `docs/ARCHITECTURE.md` — components, request paths, order lifecycle
- `docs/SECURITY.md` — secrets handling, safety gates
- `docs/DELTA_SETUP.md` — Delta-era reference (superseded, kept for history)
- `docs/TRADING_GATEWAY_DEPLOYMENT.md` / `trading-gateway/README.md` — the retired gateway service (not used by this app)
- `docs/STRATEGY_ENGINE.md` — strategies, structure & S/R detection
- `docs/PAPER_TRADING.md` — paper engine semantics
- `docs/WEBHOOKS.md` — optional TradingView webhook (disabled by default)
- `docs/AI_PREDICTION.md` — AI signal prediction: 5m Chandelier/Donchian calls on both charts, free-tier keys, guard rails, scoring
- `docs/DESIGN_BENCHMARK.md` — premium-interface benchmark, anti-pattern audit, capability matrix
- `docs/FUTURE_ROADMAP.md` — competitive landscape, gap analysis, unique/futuristic roadmap
- `docs/DEPLOYMENT.md` — local verification, health checks, production guardrails
- `docs/LIMITS.md` — hosting/trading/data/backtest limits and honest capability map

## Keyboard

`Ctrl/⌘+K` command palette · `1/3/5/M/H/D` timeframes · `C` chart · `P` positions ·
`J` journal · `A` alerts · `?` all shortcuts.

## Attribution

Charting rendered by [TradingView Lightweight Charts](https://www.tradingview.com/lightweight-charts/)
(Apache-2.0). Market data courtesy CoinDCX.

CoinDCX is an Indian VDA exchange registered with FIU-IND as a reporting entity;
FIU-IND registration is not a SEBI licence and is not an endorsement of futures
trading risk. Nothing here is investment advice.

### Pattern reasoning and recorded memory

Both chart prediction panels now include **Pattern recognition · reasoning checks · memory**: 30 rule-based candle patterns, EMA/VWAP/RSI/ADX checklists, MACD and Bollinger context, and comparable completed calls from the saved ledger. No key is needed for this analysis. See [definitions, research and storage limits](docs/PATTERN_REASONING_MEMORY.md). Poster win-rate claims are not adopted.

### Day/night, messaging and market pulse

Use the top-bar sun/moon switch for upgraded light/dark surfaces and motion-aware controls. **Markets → Market Pulse** shows up to 10 gainers/losers in the available universe with independent 5m candidate/wait checks. **Settings → Signal Notifications** configures Telegram/WhatsApp delivery (server credentials required). See [setup, background scheduling and limitations](docs/STYLE_ALERTS_MOVERS.md).

### Automatic history, INR and messaging setup

See [automatic history/currency/provenance](docs/AUTOMATIC_HISTORY_CURRENCY_PROVENANCE.md) for the read-only journal, bounded CoinDCX pagination/coverage, paper fee correction, honest prior-AI context, INR conversion and audit exports. Chandelier now defaults to ATR **1 × 2**; saved preferences survive, with an explicit reset in the indicator tab. All dropdown symbols join the watchlist automatically; absent quotes remain unavailable. Telegram can be configured securely in Settings. WhatsApp QR requires a real configured business sender and opens an **opt-in chat**, not personal account pairing. No messaging or live execution is enabled automatically.
