# Architecture — Trading Command V3

```
Browser
   │  (HTTPS, session cookie)
   ▼
Vercel / Next.js  ─────────────────────────────────────────────────────────────
   │  UI · dashboard · charts · strategy engine · journal · analytics
   │  authentication (session cookie / API_PASSWORD, enforced by proxy.ts)
   │  PostgreSQL (settings, journal, paper orders/positions, live-order ledger,
   │              signals, drawings, alerts, audit log)
   │  Paper trading engine (local simulation — never touches the venue)
   │  Market data + private account access + order routing:
   │        PUBLIC  → public.coindcx.com  (candles, depth, live prices; no auth)
   │        PUBLIC  → api.coindcx.com/…/data/*  (instruments, trade tape)
   │        PRIVATE → api.coindcx.com/…/futures/*  (signed in this process with
   │                  COINDCX_API_KEY / COINDCX_API_SECRET from the environment)
   ▼
CoinDCX Futures
```

There is no middle hop: no gateway, no VPS, no static IP. See
`docs/EXCHANGE_MIGRATION.md` for the Delta → CoinDCX history and
`docs/COINDCX_SETUP.md` for the credentials.

## Why private calls run directly on Vercel now

The previous design routed private calls through a small always-on service with
a dedicated public IPv4, because **Delta Exchange India refuses signed requests
from an address it has not allowlisted** and Vercel has no fixed, published
egress address.

**CoinDCX imposes no such requirement on futures API keys** — IP binding is an
optional hardening feature in its dashboard. So the constraint that shaped the
old architecture does not exist here, and the application signs its own requests.
Removing the hop removes a host to pay for, a secret to distribute, a network
boundary to harden and a failure mode between the app and the venue.

If CoinDCX ever makes binding mandatory for a required operation, the response is
to keep live trading disabled and report it — **not** to reintroduce a gateway.
See the decision gate in `docs/EXCHANGE_MIGRATION.md` §1.

## Components

```
src/lib/exchange/              the only code that talks to a venue
  service.ts                   config, capabilities, all call sites' entry point
  types.ts                     normalised models (no venue shapes leak upward)
  symbols.ts                   "BTCUSD" ↔ "B-BTC_USDT" (+ validation)
  errors.ts                    ExchangeError codes; orderOutcomeKnown()
  coindcx/
    auth.ts                    body-only HMAC-SHA256, ms timestamp in the body
    client.ts                  read/mutate split, retry policy, error mapping
    market.ts account.ts positions.ts orders.ts
    parse.ts                   expectArray(): a 200 that is not a list ≠ "no data"
    websocket.ts               documents why streaming is not wired up
```

`src/lib/exchange/service.ts` is the single facade. Nothing else imports
`coindcx/*`, nothing in `src/app` or `src/components` imports either, and no
client component may: the modules read credentials from `process.env`.

## What stays where (and why)

| Concern | Where | Why |
|---|---|---|
| UI, charts, strategy, journal, analytics | Vercel | unchanged |
| Authentication/session for the operator | Vercel (`proxy.ts`) | the browser never authenticates to a venue |
| Paper trading | Vercel (local engine + PostgreSQL) | simulation must not touch the venue, and must work with no credentials configured at all |
| Public market data | Vercel → CoinDCX public REST | no credentials needed; no reason to add a hop |
| Wallet, positions, orders, fills, transactions | Vercel → CoinDCX private REST (signed per request) | the credential is an environment variable read by the server function |
| Order idempotency | PostgreSQL (`live_orders.client_order_id`, unique) | the venue has **no client order id**, so this is the only durable deduplication. No cross-request in-memory state exists |
| Market-data streaming | not used | a websocket needs a long-lived process; the dashboard polls REST. Documented in `coindcx/websocket.ts` |

## Order lifecycle (live path)

```
1  browser  POST /api/orders  (session cookie)
2  Vercel   gates: LIVE_EXECUTION_ENABLED · mode=live · liveArmed · credentials present
3  Vercel   local validation: supported symbol, positive size, no reduce_only
4  Vercel   reference price (limit price, or the public ticker for a market order)
5  Vercel   reads positions + balances, then risk evaluation (lib/risk.ts),
            including the fail-closed daily-P&L rule
6  Vercel   idempotency claim in PostgreSQL (unique client_order_id)
7  Vercel   reads the pair's position and aligns leverage ONLY if it differs
            (CoinDCX rejects an order whose leverage ≠ the position's)
8  Vercel   POST …/orders/create — signed, attempted EXACTLY ONCE
9  Vercel   records submitted | failed | unknown, audit-logs, answers the browser
```

Failure handling at step 8 is the part that matters most:

- **The venue answered and refused (4xx)** → nothing exists; reported as a plain
  failure.
- **No usable answer** (timeout, socket error, 5xx, 429) → the outcome is
  **UNKNOWN**. The route then reconciles by scanning the venue's recent orders:
  a single match confirms the order and records its id; a proven absence (the
  scan reached the end of the order history) marks it failed; anything ambiguous
  stays `unknown`. A retry with the same `client_order_id` is refused in the
  first two cases' favour and in the ambiguous case until it is resolved.

Reads (positions, wallets, order lists) retry with backoff; mutations never do.

## Related documents

- `docs/COINDCX_SETUP.md` — API keys, signing, endpoints used, verification, troubleshooting.
- `docs/VERCEL_DEPLOYMENT.md` — Vercel-only deployment, environment, database, serverless limits.
- `docs/EXCHANGE_MIGRATION.md` — the Delta → CoinDCX map, what was removed and kept, rollback.
- `docs/SECURITY.md` — secret handling, auth, risk layer, idempotency, logging.
- `docs/TRADING_GATEWAY_DEPLOYMENT.md` / `trading-gateway/README.md` — the retired standalone gateway (not used by this app).
