# Trading Gateway

Small, single-purpose Node.js/TypeScript service that owns the Delta Exchange
India private API for Trading Command V3.

It exists for two reasons:

1. **Static outbound IPv4.** Delta India requires signed requests to originate
   from an allowlisted address. Vercel serverless functions share and rotate
   their egress addresses, so they cannot be allowlisted. This gateway runs on a
   host with one dedicated IPv4, and that address is what Delta allowlists.
2. **Secret containment.** `DELTA_API_KEY` / `DELTA_API_SECRET` exist only in
   this process's environment. The Vercel application authenticates to the
   gateway with its own shared secret and never sees a Delta credential.

```
Vercel (application)  ──Bearer TRADING_GATEWAY_SECRET──▶  Gateway  ──signed──▶  Delta India
```

## Design constraints

- **Zero runtime dependencies.** Node's standard library only: no framework, no
  ORM, no HTTP client library. Small attack surface, no transitive supply chain,
  trivial to audit and to deploy.
- **No database.** The only local state is the append-only idempotency journal,
  which must live on persistent disk.
- **Fail closed.** No shared secret → everything refuses with 503. No Delta
  credentials → private routes refuse. Unreadable positions/equity → orders
  refuse. Unknown submission outcome → the id is blocked from resubmission.
- **Never retry an order.** Reads may be retried; mutations are attempted once.

## Layout

```
src/
  server.ts                  HTTP server, route table, request pipeline
  config.ts                  environment parsing + safe /ready description
  context.ts, errors.ts, http.ts, logger.ts
  auth/gatewayAuth.ts        credential primitives (bearer parsing, constant-time compare)
  middleware/
    authentication.ts        pipeline stage: 503 unconfigured / 401 bad bearer
    validation.ts            body + query schemas
    rateLimit.ts             read / order buckets, per client
  delta/
    client.ts                signed fetch, single-attempt mutations, error mapping
    signing.ts               HMAC-SHA256(payload) -> api-key / timestamp / signature
    account.ts, orders.ts, positions.ts, products.ts, types.ts
  risk/
    riskGuard.ts             symbol / size / value / leverage / loss / position limits
    dailyPnl.ts              realized P&L for the day (null when unknown -> block)
    accountContext.ts        venue context (equity + open positions) before ordering
  idempotency/ledger.ts      append-only order journal (crash-safe dedupe)
  routes/
    health.ts                /health, /ready
    account.ts               balance, transactions, fills
    positions.ts             positions, open orders
    orders.ts                create, cancel, close-position, status lookup
  tests/                     signing, auth, validation, risk, ledger, HTTP
```

There is deliberately **no `routes/market.ts`**: public market data (tickers,
candles, orderbook, trades, WebSocket) is unauthenticated and never transits the
gateway, so proxying it here would add a hop and a failure mode for nothing.
No database and no scheduler either — the gateway is a request/response process
plus one journal file.

## Quick start

```bash
cd trading-gateway
npm install
cp .env.example .env      # set TRADING_GATEWAY_SECRET + DELTA_API_KEY/SECRET
npm run build
npm start                 # listens on 0.0.0.0:8787

npm test                  # 76 tests: signing, auth, validation, risk, ledger, HTTP
npm run typecheck
```

Smoke test:

```bash
curl -s localhost:8787/health
curl -s -H "Authorization: Bearer $TRADING_GATEWAY_SECRET" \
     localhost:8787/api/account/balance
```

## API

Public (no auth, no configuration detail):

| Route | Purpose |
|---|---|
| `GET /health` | liveness: process is up |
| `GET /ready` | 200 when configuration is complete, 503 otherwise. With a valid bearer it also lists missing variable NAMES (never values). |

Authenticated (`Authorization: Bearer <TRADING_GATEWAY_SECRET>`):

| Route | Delta call | Notes |
|---|---|---|
| `GET /api/account/balance` | `GET /v2/wallet/balances` | raw rows in `result` |
| `GET /api/account/transactions?page_size=` | `GET /v2/wallet/transactions` | capped at 500 |
| `GET /api/account/fills?page_size=` | `GET /v2/fills` | capped at 500 |
| `GET /api/account/positions?underlying_asset_symbol=BTC` | `GET /v2/positions` | required query: Delta has no all-positions endpoint |
| `GET /api/account/orders` | `GET /v2/orders` | open orders |
| `GET /api/orders/status?clientOrderId=` | `GET /v2/orders/client_order_id/{id}` | reconciliation; updates the ledger, read-only at Delta |
| `POST /api/orders` | `POST /v2/orders` | create; requires `client_order_id` ≤ 32 chars |
| `POST /api/orders/cancel` | `DELETE /v2/orders` | allowed even when live execution is disabled |
| `POST /api/orders/close-position` | `GET /v2/positions` + `POST /v2/orders` | reduce-only market order, size read from the exchange |

Envelopes:

```json
{ "success": true, "requestId": "gw_…", "result": [ … ] }

{ "success": false,
  "error": { "code": "RISK_BLOCKED", "message": "Blocked by risk limit: …",
             "requestId": "gw_…", "detail": { "code": "daily_pnl_unavailable" } } }
```

### POST /api/orders body

```json
{
  "symbol": "BTCUSD",
  "side": "buy",
  "order_type": "market_order",
  "size": 0.01,
  "client_order_id": "tc-0123456789abcdef0123",
  "reduce_only": false,
  "limit_price": 60000,
  "underlying_assets": ["BTC", "ETH"],
  "risk_limits": { "maxOrderValue": 5000, "maxDailyLoss": 200,
                   "maxLeverage": 10, "maxOpenPositions": 4 }
}
```

`risk_limits` is a request for *tighter* limits only: the gateway clamps
everything to its own `GATEWAY_MAX_*` ceilings and never takes equity, positions,
reference price or the daily P&L from the body.

Responses to expect when safety checks fire:

| Status | Code | Meaning |
|---|---|---|
| 403 | `LIVE_EXECUTION_DISABLED` | gateway flag is off (default) |
| 403 | `RISK_BLOCKED` | risk limit; `detail.code` says which (`daily_pnl_unavailable` today) |
| 409 | `DUPLICATE_ORDER` | in-flight id, or an identical order seconds ago |
| 409 | `ORDER_STATUS_UNKNOWN` | previous attempt unresolved → reconcile |
| 422 | `VALIDATION_ERROR` | `detail.field` names the offending input |
| 429 | `RATE_LIMITED` | `Retry-After` header set |
| 502 | `ORDER_STATUS_UNKNOWN` | submission outcome unknown → **do not resubmit** |

## Safety model

Order creation passes, in order: authentication → rate limit → gateway live flag
→ schema validation → symbol allowlist → durable idempotency claim →
identical-burst guard → venue-derived risk guard (which includes the fail-closed
daily-P&L rule) → single signed submission → outcome classification.

`liveRealizedPnlToday()` (see `src/risk/dailyPnl.ts`) returns `null` **by
design**: a daily-loss limit that assumes zero realised loss is not a limit, so
live submission stays blocked at the last hop, independently of the application.
Implementing that file is a prerequisite for enabling live trading, and it must
never return `0` as a fallback.

## Operations

- **Logs**: one JSON object per line on stdout — `ts`, `level`, `event`,
  `requestId`, plus order context (`clientOrderId`, `symbol`, `side`, `size`,
  `latencyMs`, `success`) and reconciliation flags. Secrets, signatures,
  authorization headers and raw account payloads are never logged.
- **Correlation**: pass `X-Request-Id` (or read the generated one from the
  response) to join a Vercel log line to a gateway log line.
- **Idempotency journal**: `IDEMPOTENCY_STORE` (default
  `./data/order-ledger.jsonl`), compacted to one record per order on startup,
  entries expire after `IDEMPOTENCY_TTL_HOURS` (default 14 days). Keep it on
  persistent storage: it is what stops a restarted gateway from resubmitting an
  order it already sent.
- **Clock**: signatures expire in ~5 s, so keep NTP enabled on the host.
- **Health**: `GET /health` for liveness; `GET /ready` for configuration.

Deployment (Docker and systemd), finding the static IPv4, the Delta allowlist and
the full verification checklist: `../docs/TRADING_GATEWAY_DEPLOYMENT.md`.

## Environment

See `.env.example` for the annotated list. Required: `TRADING_GATEWAY_SECRET`,
`DELTA_API_KEY`, `DELTA_API_SECRET`. Defaults are safe: `LIVE_EXECUTION_ENABLED=false`,
no CORS origins, rate limiting on, retries only for reads.

## Deliberate limitations

- Live order execution is disabled by default and blocked by the daily-P&L gate
  even when enabled — by design, see above.
- The risk guard's exposure maths covers the underlyings the caller declares
  plus the ordered symbol's own base asset. The application supplies its
  watchlist; the gateway additionally refuses when it cannot read positions or
  equity at all.
- No WebSocket/streaming: private data is REST-only, polled by the dashboard,
  which is what the application already did before the migration.
