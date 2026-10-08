# Security model

## Where the secrets are

| Secret | Lives on | Never appears in |
|---|---|---|
| `COINDCX_API_KEY`, `COINDCX_API_SECRET` | this deployment's server environment (Vercel env vars) | the browser bundle, the database, logs, git |
| `API_PASSWORD`, `SESSION_SECRET` | the server environment | the browser bundle, logs, git |

Rules that are enforced by code, not by convention:

- **No endpoint accepts a credential.** `POST
  /api/settings/exchange-credentials` returns 409 and explains that credentials
  are environment-only; there is no `saveCredentials()` anywhere, and no code
  path that writes a key or secret to the database. (An older build stored an
  encrypted Delta row; `DELETE` on the same route purges it.)
- Credentials are read in exactly one place, `src/lib/exchange/service.ts`, from
  `process.env`. Signing lives in `src/lib/exchange/coindcx/auth.ts`, which
  returns a signature and never a secret.
- No `NEXT_PUBLIC_*` variable is used for anything sensitive, so a secret cannot
  reach the client bundle. `tests/live-exchange.test.mjs` downloads the served
  client bundles and fails if a secret value or a server-only marker appears in
  one. That test also proves the retired static-IP gateway receives **zero**
  requests, so a secret cannot leak through a hop that no longer exists.
- Error messages are normalised: `ExchangeError` carries an HTTP status, the
  endpoint path and the venue's own message — never a header, a signature or a
  key. The end-to-end test asserts the secret string appears in no response.
- No audit-log entry, API error or status endpoint contains a credential, a
  signature or a full account dump. `/api/system` and the credential-status
  route report variable **names** and host names only.

## Authentication

**Operator → application.** Every route under `/api` is authenticated by
`src/proxy.ts`. Two credentials are accepted:

- a signed session cookie (`tc_session`, HttpOnly, SameSite=Strict, 12 h) issued
  by `POST /api/auth/login`, and
- `Authorization: Bearer <API_PASSWORD>` for scripts and smoke tests.

The password is compared in constant time and the cookie is an HMAC-SHA256
signature over its own expiry. **Fail closed:** with no `API_PASSWORD` the API
returns 503 on every protected route rather than serving it.

**Application → CoinDCX.** Every private request is signed with
`X-AUTH-APIKEY` + `X-AUTH-SIGNATURE` (HMAC-SHA256 over the exact JSON body) and
sent over HTTPS to `api.coindcx.com`. The signing key never leaves the process
that makes the call, and no request is made at all when the credentials are
absent (`EXCHANGE_NOT_CONFIGURED`, HTTP 503).

**There is no middle tier any more.** The retired gateway required a shared
bearer secret, a rate limiter, a CORS policy and an HTTPS terminator; that whole
attack surface is gone, and with it a second place a second copy of the
credential could leak from. The standalone service is still in
`trading-gateway/` and still tested, but no request in this application's path
reaches it — asserted by `tests/live-exchange.test.mjs`.

**The browser never talks to the venue.** It has no API key, no signature and no
CoinDCX URL; it only talks to `/api/*` on Vercel.

## Execution gates

All of these must pass for a live order:

1. `LIVE_EXECUTION_ENABLED=true`,
2. `settings.mode === "live"`,
3. `settings.liveArmed === true` (master switch, server-verified confirmation
   token `ARM-LIVE-TRADING`),
4. `COINDCX_API_KEY` **and** `COINDCX_API_SECRET` present,
5. the symbol is a supported instrument (validated *before* any network call),
6. the order is not `reduce_only` (unsupported on CoinDCX — sending it could
   *increase* exposure),
7. the risk layer passes, including the fail-closed daily-P&L rule.

Gate failures return 403/422 and are audit-logged (`live_order_rejected`,
`live_order_blocked_unknown`, `risk_block_triggered`). The default configuration
— flag false, mode not live, switch disarmed — cannot place an order at all.

## The daily-P&L gate (implemented, and still fail-closed)

`liveRealizedPnlToday()` in `src/app/api/orders/route.ts` delegates to
`realizedPnlTodayUtc()` (`src/lib/exchange/service.ts`), which reads CoinDCX's
`POST /positions/transactions` and sums the documented `amount` field for today's
non-funding transactions since the UTC day boundary. Funding is excluded because
it is a separately-billed cost, not a trade result.

**It returns `null` — never `0` — whenever the figure cannot be proven:**

- the request fails, or the payload is not a list;
- a page comes back full (`size` rows), so the window may be truncated;
- a transaction's `created_at` is unparseable, so its day is unknown;
- a transaction's `amount` is not a number.

The risk layer treats `null` as "cannot be verified" and refuses the order
(`daily_pnl_unavailable`). A daily-loss limit that silently assumes zero loss is
not a limit, so the answer is to refuse, not to guess.

Since the gateway is no longer on the request path, **this is now the only
enforcement point** — which is exactly why the fail-closed rules above are
stricter than "read a number and sum it". Previously the gateway re-applied the
same rule in its own process; today there is no second process, so the rules are
enforced by refusing to interpret anything as zero.

One related guard was also tightened for the same reason: `parse.ts#expectArray`
throws when a list endpoint answers with anything that is not a JSON array. A
non-list payload must never be read as "no positions", "no orders" (which would
let reconciliation declare an order absent) or "no transactions" (which would
read as zero P&L).

## Risk layer

`src/lib/risk.ts` is the single implementation used by both the paper engine and
the live route, so paper and live limits cannot drift. (The retired gateway
carried its own copy in `trading-gateway/src/risk/riskGuard.ts`; it is no longer
consulted.)

| Limit | Check |
|---|---|
| `maxOrderValue` | `qty × price` above the cap |
| `maxDailyLoss` | realised P&L since UTC midnight at or below `-limit` |
| `maxOpenPositions` | opening a **new** symbol at the cap (adding to an existing one is allowed) |
| `maxLeverage` | `(existing notional + order value) / equity` above the cap |

Limits are re-normalised on every evaluation, so a nonsense value written into
settings cannot disable a cap. Every risk input except the daily P&L comes from
CoinDCX itself (positions, balances, reference price) — a request body can never
widen a limit, and an unreadable position set or an unknown equity blocks the
order rather than assuming a flat book (the route answers 502 and sends nothing).

## Order idempotency and uncertain outcomes

CoinDCX futures has **no client order id**, so there is no venue-side
deduplication. Correctness rests on our own ledger plus a strict reconciliation
rule:

- `live_orders.client_order_id` is UNIQUE in PostgreSQL and is claimed **before**
  the submission; a concurrent claim that loses the unique race is treated as a
  duplicate, not as a failure.
- The submission is attempted **exactly once**. Reads retry with backoff;
  mutations never do (a request never sent is never a network failure, and a
  request whose answer was lost is never a safe retry).
- A repeated id resolves to `submitted` → the stored result is returned with
  `deduplicated: true`; `unknown` → **409** with the reconciliation endpoint in
  the error body; `failed` → the stored failure is returned.
- An uncertain submission is reconciled against the venue: exactly one matching
  order (pair + side + size ±0.5 % inside the submission window) → confirmed;
  provably none, with the scan reaching the end of the venue's order history →
  nothing was created; anything else → `unknown`, and an operator decides. A
  retry then requires a **new** `client_order_id`.
- **Order mutations are attempted exactly once**, in the transport itself: reads
  retry with backoff (`maxReadRetries`, default 2); mutations are given exactly
  one attempt and any uncertain result becomes `EXCHANGE_UNKNOWN_RESULT` (HTTP
  409 outward) with an explicit instruction to reconcile rather than resubmit.
  A request that was never sent (unconfigured, unsupported, invalid) is never
  reported as a network failure.

## Logging

Structured audit events only: rejections, risk blocks, placements,
reconciliation outcomes, position closures, credential-status attempts. A live
order's audit entry carries the client order id, the venue order id, symbol,
side, size and the outcome — enough to reconstruct an order and nothing more.
Neither a key, a secret, a signature nor an authorization header is ever
written. `ExchangeError` messages contain a status, an endpoint path and the
venue's own message text, and the end-to-end test asserts the secret string
appears in no response.

The standalone gateway keeps its own logging for its own operations (one JSON
line per request, sensitive field names redacted, configured secret values
scrubbed from every line).

## Transport / deployment

Everything runs over HTTPS on Vercel: the browser → `/api/*` (session cookie or
`Bearer API_PASSWORD`), and the server → `api.coindcx.com`. PostgreSQL stays
private (never expose 5432) and only the application connects to it. There is no
longer a second service to firewall or tunnel: the static-IP gateway is not part
of the request path, so removing it removed a network boundary.

## Data integrity

Every market object carries `source` and timestamps; stale data is labelled,
never silently substituted. Demo data can never masquerade as live: a venue
failure degrades private account views to a readable error, or falls back to
**explicitly labelled** demo candles — never fabricated live numbers. A venue
payload the parser does not recognise raises an error rather than being read as
zero (`parse.ts#expectArray`), and an unprovable daily P&L blocks trading rather
than counting as zero.
