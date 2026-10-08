# Security model

## Where the secrets are

| Secret | Lives on | Never appears in |
|---|---|---|
| `DELTA_API_KEY`, `DELTA_API_SECRET` | the static-IP trading gateway's environment | Vercel, the browser bundle, the database, logs, git |
| `TRADING_GATEWAY_SECRET` | Vercel (server env) + the gateway's environment | the browser bundle, logs, git |
| `API_PASSWORD`, `SESSION_SECRET` | Vercel (server env) | the browser bundle, logs, git |

Rules that are enforced by code, not by convention:

- The application has no function that returns a Delta credential.
  `resolveDeltaCredentials()` and `saveDeltaCredentials()` were removed in the
  migration; `src/lib/market/delta.ts` throws if any caller attempts an
  authenticated Delta request, so a future edit cannot quietly reintroduce
  signing inside Vercel.
- The Delta key/secret are never sent to Vercel. Only the gateway signs.
- Neither gateway variable is prefixed `NEXT_PUBLIC_`, so neither can reach the
  client bundle. `tests/live-gateway.test.mjs` downloads the served client
  bundles and fails if a secret value or a server-only marker appears in one.
- The gateway's logger redacts sensitive field names (`authorization`,
  `signature`, `api-key`, `secret`, `token`, `cookie`, …) and additionally
  scrubs the literal values of the configured secrets from every line.
- No audit-log entry, API error or health endpoint contains a credential, a
  signature or a full account dump.

## Authentication

**Operator → application.** Every route under `/api` is authenticated by
`src/proxy.ts`. Two credentials are accepted:

- a signed session cookie (`tc_session`, HttpOnly, SameSite=Strict, 12 h) issued
  by `POST /api/auth/login`, and
- `Authorization: Bearer <API_PASSWORD>` for scripts and smoke tests.

The password is compared in constant time and the cookie is an HMAC-SHA256
signature over its own expiry. **Fail closed:** with no `API_PASSWORD` the API
returns 503 on every protected route rather than serving it.

**Application → gateway.** `Authorization: Bearer <TRADING_GATEWAY_SECRET>`,
server-to-server only. The gateway:

- refuses everything with 503 when its own secret is unset (never falls open),
- compares the presented token against the configured secret in constant time
  over SHA-256 digests (so neither the value nor its length leaks via timing),
- rate limits per caller and gateway-wide, with a much tighter bucket on the
  order routes,
- validates the request schema before touching a credential,
- never emits CORS headers unless `CORS_ALLOWED_ORIGINS` names an origin
  explicitly — `Access-Control-Allow-Origin: *` is impossible by construction,
- returns normalised errors (`{success:false,error:{code,message,requestId}}`)
  and never a stack trace, a header echo or an upstream body.

**The browser never authenticates to the gateway.** It has no gateway URL and no
secret; it only talks to `/api/*` on Vercel, which proxies through.

## Execution gates

All of these must pass for a live order:

1. `LIVE_EXECUTION_ENABLED=true` on Vercel,
2. `settings.mode === "live"`,
3. `settings.liveArmed === true` (master switch, server-verified confirmation
   token `ARM-LIVE-TRADING`),
4. the trading gateway is configured,
5. `LIVE_EXECUTION_ENABLED=true` **on the gateway** as well,
6. the gateway's own risk guard passes.

Gate failures return 403 and are audit-logged (`live_order_rejected`,
`live_order_blocked_unknown`, `risk_block_triggered`). The default configuration
— both flags false — cannot place an order at all.

## The daily-P&L gate (unchanged, and deliberately still closed)

`liveRealizedPnlToday()` in `src/app/api/orders/route.ts` returns `null`, and the
risk layer treats `null` as "cannot be verified" and refuses the order. A
daily-loss limit that silently assumes zero loss is not a limit, so the answer is
to refuse, not to guess. The gateway enforces the identical rule in
`trading-gateway/src/risk/dailyPnl.ts`, which also returns `null`.

Consequences to be explicit about:

- **Live order submission is blocked today at both layers.** That is the
  intended state of this codebase, not a bug to work around.
- Implementing the figure requires reading today's fills from Delta and summing
  realised P&L with an explicit UTC day boundary, caching for a few seconds, and
  returning `null` (never `0`) whenever any part of that cannot be done. The
  procedure and its preconditions are documented in
  `trading-gateway/src/risk/dailyPnl.ts`.
- Implementing it in one layer only is not enough, and is intentionally not
  enough: both layers must be satisfied before an order can leave.

## Risk layer

`src/lib/risk.ts` is the single implementation used by both the paper engine and
the live route, so paper and live limits cannot drift. The gateway carries a
deliberate copy (`trading-gateway/src/risk/riskGuard.ts`) with the same limits,
the same block codes and the same fail-closed daily-P&L rule, plus its own
server-side ceilings (`GATEWAY_MAX_*`) that clamp whatever the caller asks for.

| Limit | Check |
|---|---|
| `maxOrderValue` | `qty × price` above the cap |
| `maxDailyLoss` | realised P&L since UTC midnight at or below `-limit` |
| `maxOpenPositions` | opening a **new** symbol at the cap (adding to an existing one is allowed) |
| `maxLeverage` | `(existing notional + order value) / equity` above the cap |

Limits are re-normalised on every evaluation, so a nonsense value written into
settings cannot disable a cap. On the gateway, all risk inputs except the
daily-P&L come from Delta itself (positions, equity, reference price) — a request
body can never widen a limit, and an unreadable position set or an unknown equity
blocks the order rather than assuming a flat book.

## Order idempotency and uncertain outcomes

- Every live order carries a `client_order_id` (≤ 32 characters, Delta's
  documented limit). The application used to generate a 53-character id, which
  Delta would have rejected — this is fixed in
  `src/lib/tradingGateway/orders.ts#newClientOrderId`.
- Two independent ledgers key on it: `live_orders` in PostgreSQL (claimed before
  the gateway is called) and the gateway's append-only journal (claimed before
  Delta is called, and reloaded on restart). If the journal cannot be written,
  submission is refused.
- A repeated id resolves to `submitted` → the stored result is returned with
  `deduplicated: true`; `in_flight` or `unknown` → **409**, with the
  reconciliation endpoint in the error body; `rejected` → a retry is allowed
  because Delta definitively refused.
- A burst guard additionally refuses an identical
  (symbol, side, size) order within 5 s when the caller generated a *fresh* id —
  the double-click/retry pattern that idempotency alone cannot catch.
- **Order mutations are attempted exactly once.** Read-only GETs may be retried;
  a `POST`/`DELETE` is not, and any uncertain result becomes
  `ORDER_STATUS_UNKNOWN` with an explicit instruction to reconcile rather than
  resubmit.

## Logging

The gateway logs one JSON object per line: timestamp, `requestId`, endpoint,
operation, symbol, side, quantity, latency, Delta status and success/failure —
enough to audit and debug an order, and nothing more. It never logs the Delta
secret, the gateway secret, authorization headers, signatures, or raw account
payloads.

## Transport / deployment

Run the gateway behind HTTPS (Caddy/nginx with a real certificate), keep its port
firewalled from the internet, and let only the Vercel deployment hold the gateway
secret. PostgreSQL stays private (never expose 5432) and only the application
connects to it — the gateway needs no database.

## Data integrity

Every market object carries `source` and timestamps; stale data is labelled,
never silently substituted. Demo data can never masquerade as live, and a failure
of the gateway degrades private account views to a readable error instead of
fabricated numbers.
