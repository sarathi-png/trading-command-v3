# Trading Command

A private, personal trading intelligence terminal: Delta Exchange India market data,
TradingView Lightweight Charts rendering, a modular strategy/signal engine, risk tooling,
paper trading and a trade journal — in one dark, low-clutter workspace.

It is **not** a TradingView/Delta/OSIRIS clone. It is a personal command center that answers:
*Where is price? What is the market doing? What is my setup? What is my position? What is my risk?*

## Quick start

```bash
npm install
cp .env.example .env          # defaults run fully in demo mode
npx drizzle-kit push          # create tables
npm run dev
```

Private Delta data additionally needs the gateway (see below). Tests:
`npm test` runs the quant suite, the gateway suite (76 tests), a production
build, the paper-trading end-to-end test and the Vercel↔gateway boundary test.

Open the app, complete the 5-step onboarding, done. Without any Delta credentials the
workspace runs on a **clearly-labelled deterministic demo simulator** (candles print live
as time advances).

## Modes (progression of trust)

| Mode | What it does | How to reach it |
|---|---|---|
| **READ ONLY** (default) | Data, analysis, journal. No order entry. | Default |
| **PAPER** | Simulated orders/positions vs live-style prices, risk limits enforced, auto-journalled | Settings → Execution |
| **LIVE** | Order routing to Delta via the static-IP gateway — only with `LIVE_EXECUTION_ENABLED=true` on both deployments, LIVE mode, the master switch armed, and a verifiable daily P&L (not implemented, so this stays blocked) | Env + Settings |

## Delta Exchange India, and the static-IP Trading Gateway

Delta India rejects signed requests from addresses it has not allowlisted, and
Vercel has no dedicated outbound IP. The application therefore splits into:

```
Browser → Vercel (UI, database, paper trading, PUBLIC market data)
              │  Bearer TRADING_GATEWAY_SECRET (server-side only)
              ▼
        Static-IP Trading Gateway  ← holds DELTA_API_KEY / DELTA_API_SECRET
              │  fixed outbound IPv4 (the address Delta allowlists)
              ▼
        Delta Exchange India
```

- **Public data** (tickers, candles, order book, trades) needs no credentials and
  stays on the application — it is not routed through the gateway.
- **Private data and orders** (wallet, positions, fills, order create/cancel) go
  through the gateway, which is the only component holding Delta credentials.
- Deploy it with `docs/TRADING_GATEWAY_DEPLOYMENT.md`; the architecture and the
  reasoning are in `docs/ARCHITECTURE.md`.

The gateway is a separate small service:

```bash
cd trading-gateway
npm install && npm run build && npm start     # see trading-gateway/README.md
```

### Live trading is off by default — and blocked twice

Live orders require `LIVE_EXECUTION_ENABLED=true` **on both** deployments, LIVE
mode armed in the UI, *and* a verifiable daily realised P&L, which is
deliberately not implemented (`trading-gateway/src/risk/dailyPnl.ts` returns
`null`, and both risk layers refuse rather than assume zero loss). Putting a real
order on the exchange is a change to that file, made on purpose.

## Feature flags

All sensitive capabilities default OFF: `LIVE_EXECUTION_ENABLED`, `TRADINGVIEW_WEBHOOK_ENABLED`,
`TELEGRAM_ENABLED`. Paper trading, strategy engine, order book and auto-S/R default ON but can
be disabled. Full list in `.env.example`.

## Documentation

- `docs/ARCHITECTURE.md` — components, why private Delta calls moved off Vercel, order lifecycle
- `docs/TRADING_GATEWAY_DEPLOYMENT.md` — gateway deployment, static IP, Delta allowlist, verification
- `trading-gateway/README.md` — gateway API reference, safety model, operations
- `docs/DELTA_SETUP.md` — API keys, endpoints used, WebSocket channels
- `docs/STRATEGY_ENGINE.md` — strategies, structure & S/R detection
- `docs/PAPER_TRADING.md` — paper engine semantics
- `docs/WEBHOOKS.md` — optional TradingView webhook (disabled by default)
- `docs/SECURITY.md` — secrets handling, safety gates
- `docs/DEPLOYMENT.md` — local, Docker, Cloudflare Tunnel

## Keyboard

`Ctrl/⌘+K` command palette · `1/3/5/M/H/D` timeframes · `C` chart · `P` positions ·
`J` journal · `A` alerts · `?` all shortcuts.

## Attribution

Charting rendered by [TradingView Lightweight Charts](https://www.tradingview.com/lightweight-charts/)
(Apache-2.0). Market data courtesy Delta Exchange India.
