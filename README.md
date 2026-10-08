# Trading Command

A private, personal trading intelligence terminal: CoinDCX Futures market data,
TradingView Lightweight Charts rendering, a modular strategy/signal engine, risk tooling,
paper trading and a trade journal — in one dark, low-clutter workspace.

It is **not** a TradingView/CoinDCX/OSIRIS clone. It is a personal command center that answers:
*Where is price? What is the market doing? What is my setup? What is my position? What is my risk?*

## Quick start

```bash
npm install
cp .env.example .env          # defaults run fully in demo mode
npx drizzle-kit push          # create tables
npm run dev
```

Private account data (balances, positions, orders) additionally needs
`COINDCX_API_KEY` / `COINDCX_API_SECRET` in the environment — see
`docs/COINDCX_SETUP.md`. Tests: `npm test` runs the quant suite, the CoinDCX
adapter suite (signing vectors + a mock venue), the standalone gateway suite, a
production build, the paper-trading end-to-end test and the Vercel↔CoinDCX
boundary test.

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
- `docs/DEPLOYMENT.md` — local, Docker, Cloudflare Tunnel

## Keyboard

`Ctrl/⌘+K` command palette · `1/3/5/M/H/D` timeframes · `C` chart · `P` positions ·
`J` journal · `A` alerts · `?` all shortcuts.

## Attribution

Charting rendered by [TradingView Lightweight Charts](https://www.tradingview.com/lightweight-charts/)
(Apache-2.0). Market data courtesy CoinDCX.

CoinDCX is an Indian VDA exchange registered with FIU-IND as a reporting entity;
FIU-IND registration is not a SEBI licence and is not an endorsement of futures
trading risk. Nothing here is investment advice.
