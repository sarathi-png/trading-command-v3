# Architecture — Trading Command V3

```
Browser
   │  (HTTPS, session cookie)
   ▼
Vercel / Next.js  ─────────────────────────────────────────────────────────────
   │  UI · dashboard · charts · strategy engine · journal · analytics
   │  authentication (session cookie / API_PASSWORD)
   │  PostgreSQL (settings, journal, paper orders/positions, live-order ledger,
   │              signals, drawings, alerts, audit log)
   │  Paper trading engine (local simulation — never touches the gateway)
   │  PUBLIC Delta market data (tickers, candles, order book, trades)
   │        DELTA_MARKET_ENABLED → api.india.delta.exchange (no credentials)
   │        browser ticker socket → socket.india.delta.exchange (no credentials)
   │
   └── authenticated server-to-server request
       (Authorization: Bearer TRADING_GATEWAY_SECRET, X-Request-Id)
             │
             ▼
      Static-IP Trading Gateway  ──────────────────────────────────────────────
             │  dedicated public IPv4 (the only address Delta allowlists)
             │  DELTA_API_KEY / DELTA_API_SECRET live here and nowhere else
             │  HMAC-SHA256 signing (method + timestamp + path + query + body)
             │  idempotency ledger (append-only journal)
             │  risk guard (same rules as the app, plus its own ceilings)
             │  single-attempt order submission, reconciliation on unknown
             │
             ▼
      Delta Exchange India
             api.india.delta.exchange (private + public REST)
```

## Why private Delta calls no longer run on Vercel

Delta Exchange India rejects signed requests that do not originate from an
allowlisted IP. Vercel serverless functions do not have a dedicated outbound
IPv4: they egress from a shared, rotating pool, so there is no stable address to
allowlist, and allowlisting such a pool would be both impossible and unsafe
(everyone sharing it would be inside the allowance).

The gateway therefore runs on a host with one static IPv4, and that address
alone is allowlisted at Delta. Two further consequences follow, and both are
improvements rather than costs:

1. **The Delta secret leaves the application entirely.** The Vercel deployment
   no longer stores, reads or can even decrypt `DELTA_API_SECRET`; the only
   component that can sign a Delta request is the gateway, which is a small
   service with a single job.
2. **Risk enforcement happens twice.** The application still evaluates every
   order against `src/lib/risk.ts` before it leaves, and the gateway evaluates
   the same rules again with values it reads from the exchange itself. A bug, a
   bypass or a compromised app process still cannot produce an unrestricted
   order.

## What stays where (and why)

| Concern | Where | Why |
|---|---|---|
| UI, charts, strategy, journal, analytics | Vercel | unchanged from before |
| Authentication/session for the operator | Vercel (`proxy.ts`) | the browser never authenticates to the gateway |
| Paper trading | Vercel (local engine + PostgreSQL) | simulation must not touch the exchange, and must keep working when the gateway is down |
| Public market data | Vercel → Delta public REST/WS | no credentials, no static IP, no reason to add a hop or a failure mode |
| Wallet, positions, open orders, fills, transactions | Gateway | requires the Delta secret + allowlisted IP |
| Order create / cancel / close-position / reconcile | Gateway | same, plus the authority to enforce risk at the last hop |
| PostgreSQL | Vercel only | the gateway is stateless apart from its idempotency journal, so no database credentials are needed there |
| Gateway secret (`TRADING_GATEWAY_SECRET`) | Vercel (secret env) + gateway | shared bearer credential; never sent to a browser |

## Order lifecycle (live path)

```
1  browser  POST /api/orders  (session cookie)
2  Vercel   gates: LIVE_EXECUTION_ENABLED · mode=live · liveArmed · gateway configured
3  Vercel   idempotency claim in PostgreSQL (live_orders, unique client_order_id)
4  Vercel   risk evaluation (lib/risk.ts) — includes the fail-closed daily-P&L rule
5  Vercel   POST gateway /api/orders (Bearer gateway secret, X-Request-Id)
6  gateway  validates schema + symbol allowlist
7  gateway  claims the same client_order_id in its durable journal
8  gateway  reads positions/equity from Delta and re-runs the risk guard
9  gateway  POST /v2/orders — signed, attempted exactly once
10 gateway  records submitted | rejected | unknown, then answers
11 Vercel   records the outcome, audit-logs it, answers the browser
```

Failure handling at step 9/10 is the part that matters most:

- **Delta answered with a rejection** → nothing exists; the same
  `client_order_id` may be retried.
- **No usable answer** (timeout, socket error, 5xx, 408, 429) → the outcome is
  **UNKNOWN**, it is recorded as such, and both layers refuse to resubmit that
  id until `GET /api/orders/status?clientOrderId=…` reconciles it against the
  exchange.

## Related documents

- `docs/TRADING_GATEWAY_DEPLOYMENT.md` — deploy the gateway, find the static IP, allowlist it at Delta.
- `docs/SECURITY.md` — secret handling, auth, risk layer, idempotency, logging.
- `trading-gateway/README.md` — gateway API reference and operations.
- `docs/DELTA_SETUP.md` — Delta account/key setup.
- `docs/VERCEL_ENV.md` — environment variables and troubleshooting.
