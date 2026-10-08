# CoinDCX migration — completion report

**Date:** 2026-10-08
**Branch:** `arena/1adf09d9-trading-command-v3` — commit `ec0df78` (migration) on top of `98cb113`
**Scope:** replace Delta Exchange India with CoinDCX Futures, deployable on Vercel alone
**Status:** complete; live execution intentionally **OFF**

---

## A. What changed, in one page

| | Before | After |
|---|---|---|
| Venue | Delta Exchange India | **CoinDCX Futures** (USDT-margined perpetuals) |
| Private calls | Vercel → static-IP gateway → Delta | Vercel serverless function → **`api.coindcx.com` directly** |
| Credentials | `DELTA_API_KEY`/`DELTA_API_SECRET` on a gateway host | `COINDCX_API_KEY`/`COINDCX_API_SECRET` in the deployment environment |
| Signing | HMAC over method+timestamp+path+query+body | **HMAC over the exact JSON body**, millisecond timestamp inside the body |
| Infrastructure | app + gateway + Postgres | **app + Postgres** (no gateway, no VPS, no static IP) |
| Venue pair | `BTCUSD` (Delta symbol) | `BTCUSD` (app) ↔ **`B-BTC_USDT`** (venue), mapped in one module |
| Idempotency | app ledger + gateway journal + venue `client_order_id` | app ledger (Postgres) + **exactly one** submission + order-scan reconciliation |
| Daily P&L | not implemented → blocked | **implemented from the venue, still fail-closed** |
| UI, strategy, paper engine, auth, database | — | **unchanged** |

The one thing that made this migration possible is in
`docs/COINDCX_SETUP.md` §1: **CoinDCX does not require an IP-bound API key for
futures trading**, unlike Delta, so the middle hop that existed only to present a
fixed IPv4 is gone. If CoinDCX ever makes binding mandatory for a required
operation, the standing instruction is to keep live trading disabled and report
it — not to add a gateway back.

## B. Architecture now

```
Browser ──HTTPS + session cookie──► /api/*  (Vercel serverless functions, proxy.ts auth)
                                     │
                                     │  credentials from process.env (server-only)
                                     │  HMAC-SHA256 signature over the request body
                                     ▼
                        api.coindcx.com        public.coindcx.com
                   wallets · positions ·   candles · order book · live prices
                   orders · trades
                                     │
                        PostgreSQL (Neon/Supabase/Vercel) — settings, journal,
                        paper state, live-order ledger (unique client_order_id)
```

No long-running process, no local filesystem state, no websocket server, no
cross-request mutable state (only a 30 s cache of a *public* reachability probe).

## C. Files

**Added (24)**

```
src/lib/exchange/types.ts            normalised models + capabilities + order request
src/lib/exchange/errors.ts           ExchangeError codes; orderOutcomeKnown()
src/lib/exchange/symbols.ts          BTCUSD ↔ B-BTC_USDT, baseAssetOf, isSupportedSymbol
src/lib/exchange/service.ts          the single facade (config, market, private, mutations)
src/lib/exchange/coindcx/auth.ts     body-only HMAC, ms timestamp inside the body
src/lib/exchange/coindcx/client.ts   read/mutate split, retry policy, error mapping
src/lib/exchange/coindcx/market.ts   instruments, tickers, candles, order book, trades
src/lib/exchange/coindcx/account.ts  wallets, ledger, fills, position transactions
src/lib/exchange/coindcx/positions.ts positions, exit, leverage, TP/SL, cancel-for-position
src/lib/exchange/coindcx/orders.ts   list, create-once, cancel, reconciliation verdicts
src/lib/exchange/coindcx/parse.ts    expectArray(): a non-list 200 is not "no data"
src/lib/exchange/coindcx/websocket.ts documents why streaming is not wired up
src/lib/exchangeAccount.ts           dashboard summary derived from CoinDCX reads
src/app/api/exchange/summary/route.ts
src/app/api/settings/exchange-credentials/route.ts
src/app/api/positions/close/route.ts
db/migrations/0001_exchange_neutral_live_orders.sql
tests/exchange/coindcx.test.ts       36 adapter tests
tests/live-exchange.test.mjs         end-to-end boundary test
tsconfig.exchange.json
docs/COINDCX_SETUP.md, docs/VERCEL_DEPLOYMENT.md, docs/EXCHANGE_MIGRATION.md
```

**Removed (audited as unused, evidence in column 2)**

| Removed | Evidence |
|---|---|
| `src/lib/tradingGateway/{client,account,orders,positions,symbols,index}.ts` | importers were `account.ts`, `credentials.ts`, `deltaAccount.ts`, `api/{orders,orders/status,system}` — all rewired |
| `src/lib/market/delta.ts` | importers were `market/service.ts`, `api/system`, `api/orders`, `tradingGateway/positions.ts` — all rewired or deleted |
| `src/lib/deltaAccount.ts` | only `api/delta/summary` → replaced by `exchangeAccount.ts` + `api/exchange/summary` |
| `src/app/api/delta/summary/`, `src/app/api/settings/delta-credentials/` | renamed; UI and tests updated |
| Delta browser websocket overlay in `AppShell.tsx` | replaced by the existing REST polling path |
| `tests/live-gateway.test.mjs` | superseded by `tests/live-exchange.test.mjs`, which asserts the gateway is **not** called |

**Changed (33)** — `api/{orders,orders/status,system,account,settings}`, `lib/{account,credentials,flags,settings,types}`, `db/schema.ts`, `lib/repo/{types,file,postgres}.ts`, `components/{AppShell,Onboarding,ExchangeAccountPanel,panels,chart/ChartPanel}`, `app/{page,positions/page,markets/page,orders/page,settings/page,automation/page}`, README, ARCHITECTURE, SECURITY, VERCEL_ENV, DEPLOYMENT, DELTA_SETUP, TRADING_GATEWAY_DEPLOYMENT, `.env.example`, `.gitignore`, `docker-compose.yml`, `package.json`, `tsconfig.json`, `tests/paper-api.test.mjs`.

## D. CoinDCX integration specifics

Everything in this section was read from <https://docs.coindcx.com/> (the API
reference) plus CoinDCX's own key-generation guide; each adapter file cites the
endpoint it implements.

**Authentication.** `signature = hex(HMAC_SHA256(apiSecret, <exact JSON body>))`
with headers `X-AUTH-APIKEY`, `X-AUTH-SIGNATURE`, `Content-Type:
application/json`. The timestamp lives **inside the body** in **milliseconds**
(the reference's prose says seconds but every official sample sends
`Date.now()`; the adapter follows the samples and will be re-checked against the
first live call). Orders older than **10 s** are rejected, so the signer stamps
the body immediately before each request and a caller cannot override it.
Nothing else is signed — the opposite of Delta's scheme.

**Endpoints used** (all under `/exchange/v1/derivatives/futures` unless noted):
`POST /wallets`, `GET /wallets/transactions`, `POST /positions`,
`POST /positions/update_leverage`, `POST /positions/exit`,
`POST /positions/create_tpsl`, `POST /positions/cancel_all_open_orders_for_position`,
`POST /positions/transactions`, `POST /orders`, `POST /orders/create`,
`POST /orders/cancel`, `POST /trades`; public:
`GET /data/active_instruments`, `GET /data/trades?pair=`,
`public.coindcx.com/market_data/candlesticks`,
`public.coindcx.com/market_data/v3/orderbook/{pair}-futures/{n}`,
`public.coindcx.com/market_data/v3/current_prices/futures/rt`.

**No invented endpoints.** Two capabilities are deliberately **refused** because
the reference documents enums that its own samples never send, and a live order
path must not send an unverified value:

- stop / take-profit **orders** → `EXCHANGE_NOT_SUPPORTED`, refused before any
  HTTP call (position-level TP/SL is sent through the fully documented
  `positions/create_tpsl`, market legs only as the docs require);
- `reduce_only` → refused with HTTP 422, because CoinDCX expresses reduction as
  `positions/exit` and silently dropping the flag could *open* a position.

**Symbol adapter.** `symbols.ts` is the only place that knows a venue pair.
Canonical `BTCUSD` ↔ `B-BTC_USDT`; the public instrument list is available
(`marketInstruments()`) for live tick size / min quantity / max leverage, and no
component, route or stored watchlist contains a pair string (verified by grep:
zero `B-…_USDT` literals outside the adapter and its tests).

## E. Safety and idempotency

Order path, in order — every gate must pass:

1. `LIVE_EXECUTION_ENABLED=true` (default false)
2. `settings.mode === "live"`
3. `settings.liveArmed === true` (armed with the confirmation token)
4. credentials present
5. symbol supported (checked **before** any network call)
6. `reduce_only` refused
7. risk layer passes — including the daily-loss rule

Then: reference price → read positions + balances (failure ⇒ 502, nothing sent)
→ risk evaluation → **claim `client_order_id` in Postgres (unique)** → read the
pair's position and align leverage only if it differs → **submit exactly once** →
record `submitted` | `failed` | `unknown`.

**Uncertain outcome ⇒ reconcile, never retry.** The route scans the venue's
recent orders: exactly one candidate (pair + side + size ±0.5 % in the submission
window) ⇒ confirmed and the id recorded; provably none (the scan reached the end
of the order history) ⇒ failed; anything ambiguous ⇒ `unknown`, HTTP 409, and the
same `client_order_id` is refused until an operator resolves it.

**Reads retry, mutations never do.** The transport separates `read()` from
`mutate()`; a mutation gets one attempt, and a request that was never sent
(unconfigured, unsupported, invalid) is never reported as a network failure.

**Unknown is never zero.** `realizedPnlTodayUtc()` returns `null` (⇒ blocked)
when the request fails, the payload is not a list, a page came back full, or a
timestamp/amount is unparseable. `parse.ts#expectArray` throws when a list
endpoint answers with anything else, so a 200 the adapter cannot read can never
become an empty book, an empty order history (which would authorise a retry) or a
zero P&L. Wallet parsing refuses to report a balance for a shape it does not
recognise.

**Defect found and fixed:** the inherited FIFO round-trip P&L used the sign of
the *closing* fill, so a winning long was booked as a loss and labelled with the
wrong side; the closing fee was charged but the opening fee was not. Corrected in
`exchangeAccount.ts` (§7 of `docs/EXCHANGE_MIGRATION.md`). No risk or order
decision used that function.

## F. Database migration

`db/migrations/0001_exchange_neutral_live_orders.sql` — run **before**
`npm run db:push`:

- `delta_order_id` → **`exchange_order_id`** (rename: every recorded venue order
  id is preserved)
- adds **`exchange`** (default `coindcx`) and **`exchange_symbol`**
- historical rows that carry an order id are labelled `exchange='delta'`
- an `audit_log` entry records the change
- idempotent (guarded `DO` block), so re-running is safe

Application-side, a stored `dataSource: "delta"` is normalised to `"live"` on
read, so an upgraded deployment does not silently fall back to demo data.

## G. Tests and evidence

| Check | Command | Result |
|---|---|---|
| Lint | `npm run lint` | clean |
| Types (app + gateway) | `npm run typecheck` | clean |
| Quant | `npm run test:quant` | **28/28** |
| Exchange adapter | `npm run test:exchange` | **36/36** |
| Retired gateway (standalone) | `npm run test:gateway` | **78/78** |
| Production build | `npm run build` | success; new routes present |
| Paper end-to-end | `npm run test:paper` | **1/1** (passes with **no** credentials) |
| Vercel ↔ CoinDCX boundary | `npm run test:live-exchange` | **1/1** |

What the new tests actually assert, rather than assume:

- **Signing vectors** pinned to a digest verified independently with `openssl
  dgst -sha256 -hmac` **and** Python `hashlib`; a mock venue **re-computes the
  HMAC over the bytes it received** for every request, so any drift in what is
  signed fails the suite.
- Timestamps are millisecond-epoch and live inside the body; a caller-supplied
  timestamp cannot override the signer.
- Status mapping: 401 → `EXCHANGE_AUTH_ERROR`, 403 → `EXCHANGE_FORBIDDEN`,
  429 → read retried then `EXCHANGE_RATE_LIMITED`, 4xx → `EXCHANGE_BAD_REQUEST`,
  **5xx on a mutation → `EXCHANGE_UNKNOWN_RESULT` with exactly one request
  observed at the venue**.
- Reconciliation verdicts: unique match ⇒ `found`; exhausted scan ⇒ `not_found`;
  multiple candidates ⇒ `unknown`; history larger than the scan ⇒ `unknown`.
- Wallet parsing: array shape, object shape, and **refusal** on an unrecognised
  shape (a test that previously "passed" as a zero balance is now an error).
- Stop orders and reduce-only are refused with **zero** venue requests.
- End-to-end boundary: private reads signed correctly, **retired gateway receives
  zero requests**, unverifiable daily P&L blocks with **zero** venue POSTs, a
  verifiable day submits **exactly once** with `B-BTC_USDT` mapped, a repeated
  `client_order_id` is deduplicated (still one venue order), reconciliation
  endpoints answer honestly, closing a flat position is refused, paper trading
  touches nothing, and no secret value or server-only marker appears in any
  response or served bundle (also verified by hand over the built chunks:
  `X-AUTH-SIGNATURE`, `positions/create_tpsl`, private paths and `HMAC` are
  absent from all client chunks; only the *variable name* `COINDCX_API_SECRET`
  appears, in the Settings copy that is supposed to show it).

## H. Deployment (Vercel only)

```bash
psql "$DATABASE_URL" -f db/migrations/0001_exchange_neutral_live_orders.sql
npm run db:push
vercel env add COINDCX_API_KEY production      # and COINDCX_API_SECRET
vercel --prod
```

Full steps, verification and troubleshooting: `docs/VERCEL_DEPLOYMENT.md`.
No static IP, no gateway, no card-required host; the only infrastructure cost is
the database, and free tiers suffice.

## I. Delta reference audit

Every remaining mention of Delta, classified (repo-wide grep, excluding
`node_modules`, `.next`, `output`):

| Location | Why it remains |
|---|---|
| `src/lib/credentials.ts` (`LEGACY_CREDENTIALS_KEY = "credentials.delta"`, `purgeLegacyDeltaCredentials()`) | The literal key of a legacy **database row** an older build could have written; renaming it would orphan the row. Purging it is a real feature |
| `src/lib/flags.ts` (`DELTA_MARKET_ENABLED` fallback) | Keeps an existing deployment's environment working; documented as a legacy alias |
| `src/lib/settings.ts` (`"delta"` → `"live"` normalisation) | Data migration on read |
| `trading-gateway/**` (45 files) | Standalone service, kept deliberately; **never called** by the app (asserted by the boundary test). Its README now says so |
| `docs/DELTA_SETUP.md`, `docs/TRADING_GATEWAY_DEPLOYMENT.md`, `trading-gateway/README.md`, `docs/EXCHANGE_MIGRATION.md` §3 | Historical/reference material, each with a banner stating it is superseded and not part of the current path |
| `db/migrations/0001_*.sql` | Names the old column it renames — that is the point of the migration |
| Comments in `src/lib/exchange/**`, `src/lib/exchangeAccount.ts`, `src/app/api/orders/route.ts`, `src/app/api/exchange/summary/route.ts` | Explain *why* the CoinDCX implementation differs from the Delta one (signing scheme, no client order id, base units). Deleting these would remove the reasoning |
| `tests/{paper-api,live-exchange}.test.mjs` (`DELTA_API_SECRET`, `TRADING_GATEWAY_URL` decoys) | Decoy values asserted **absent** from responses and bundles, proving the retired variables are ignored |

No Delta endpoint, host, header or field name remains in any request the
application can send.

## J. Known limitations, residual risk, next steps

1. **Time-unit confirmation.** The reference says "EPOCH timestamp in seconds"
   while its samples (and its 10-second freshness rule) imply milliseconds. The
   adapter sends milliseconds, follows the samples, and is covered by tests — but
   the first real private call should confirm it. A wrong unit fails loudly with
   a 401/4xx; it cannot silently place a wrong order.
2. **Wallet response shape.** The reference documents `/wallets` requests but not
   their response. Two shapes are parsed; an unrecognised one raises an error
   rather than reporting a zero balance. If CoinDCX changes the shape, the
   account panel says so instead of showing 0.00.
3. **Stop / TP-limit orders** are not sent on the order endpoint (unverified
   enums). Position TP/SL covers the common case; extending to order-level stops
   needs at least one verified live call first.
4. **Fills are per pair.** `/trades` requires a pair, so analytics fans out over
   the watchlist. A pair that is not on the watchlist is not part of the derived
   P&L (the venue-booked figure from `/positions/transactions` is unaffected).
5. **Reconciliation depends on our ledger.** With no venue-side client order id,
   a duplicate can only be prevented by the Postgres claim plus the scan rules.
   The scan is deliberately conservative, and an ambiguous case stays `unknown`
   for a human rather than being guessed.
6. **Sandbox could not reach `api.coindcx.com`** (`/api/system` shows
   `exchangeMarket: offline` here). Everything venue-facing is therefore proven
   against a mock that verifies signatures; the final proof is the first live
   read (balance) after deployment.
7. **Live trading remains disabled** and was never enabled during the migration:
   `LIVE_EXECUTION_ENABLED=false`, mode `read_only`, switch disarmed. Enabling it
   is a deliberate operator action, and the daily-P&L gate will still block any
   day it cannot prove.

---

## 38-point acceptance checklist

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | Dashboard/UI preserved, not rebuilt | PASS | no page removed; only labels/endpoints renamed (`git diff --stat`) |
| 2 | Strategy engine untouched | PASS | `src/lib/strategy/**` not modified |
| 3 | Paper trading preserved | PASS | paper engine untouched; `test:paper` 1/1 with no credentials |
| 4 | PostgreSQL persistence preserved | PASS | `src/lib/repo/**` only gained neutral fields |
| 5 | Auth preserved | PASS | `proxy.ts` unchanged; unauthenticated `/api/*` still 401 |
| 6 | No static-IP gateway required | PASS | gateway receives **zero** requests in the boundary test |
| 7 | No VPS/Railway/Render/DO added | PASS | no new infrastructure; `docker-compose.yml` reduced to app + Postgres |
| 8 | Vercel outbound IP never discovered or hard-coded | PASS | grep: no IP literals, no discovery code |
| 9 | Key created **without** IP binding | PASS | `docs/COINDCX_SETUP.md` §2 instructs leaving it unchecked; §1 gives the evidence |
| 10 | If binding were mandatory → stop and report | PASS | decision gate documented in `EXCHANGE_MIGRATION.md` §1 with the exact wording |
| 11 | Vercel-compatible serverless: no long-running process | PASS | request/response only |
| 12 | No local-FS persistence of state | PASS | live-order idempotency is a Postgres unique column |
| 13 | No permanent websocket server | PASS | `coindcx/websocket.ts` documents the decision; browser overlay removed |
| 14 | No cross-request in-memory state | PASS | only a 30 s cache of a *public* reachability probe |
| 15 | Persistent state in PostgreSQL | PASS | settings/journal/paper/live_orders all in the DB |
| 16 | `src/lib/exchange/{types,service,symbols,errors}.ts` exist | PASS | all four present |
| 17 | `coindcx/{client,auth,account,market,orders,positions,websocket}.ts` exist | PASS | all present (+ `parse.ts`) |
| 18 | Normalised `ExchangeTicker/Candle/OrderBook/Balance/Position/Order/Fill` | PASS | `exchange/types.ts` |
| 19 | Credentials server-side only, no `NEXT_PUBLIC_*` | PASS | grep: 0 `NEXT_PUBLIC_COINDCX`; bundle sweep clean |
| 20 | Flow Browser → `/api/orders` → adapter → CoinDCX | PASS | boundary test observes the venue call after the route |
| 21 | Every endpoint verified against official docs | PASS | sources and quotes in adapter comments; `COINDCX_SETUP.md` §4 table |
| 22 | No invented endpoints; no Delta endpoint renamed into a CoinDCX one | PASS | every path traced to the reference; unsupported operations refused instead |
| 23 | Centralised symbol adapter with the real instrument id | PASS | `symbols.ts` + `marketInstruments()` for live tick/min/leverage |
| 24 | No hard-coded pair in the UI | PASS | grep: zero `B-…_USDT` literals outside the adapter/tests |
| 25 | DB fields exchange-neutral, migration preserves data | PASS | SQL rename + `exchange`/`exchange_symbol`; legacy rows labelled |
| 26 | Idempotency preserved | PASS | unique `client_order_id`, claimed before submit; dedup test passes |
| 27 | Never blindly retry an order | PASS | one attempt; `unknown` ⇒ 409 + reconcile; test asserts a single venue order |
| 28 | `liveRealizedPnlToday()` semantics preserved (unknown ≠ 0) | PASS | returns `null` unless provable; `/api/exchange/summary` shows `realizedPnlUsd: null` when unconfigured |
| 29 | Live trading OFF during migration, nothing auto-enabled | PASS | `LIVE_EXECUTION_ENABLED=false`, `liveArmed: false`, `liveExecutionFlag: false` |
| 30 | `docs/COINDCX_SETUP.md` | PASS | present, 7 sections incl. troubleshooting |
| 31 | `docs/EXCHANGE_MIGRATION.md` | PASS | present, incl. endpoint/auth map and rollback |
| 32 | `docs/VERCEL_DEPLOYMENT.md` | PASS | present, incl. serverless constraints |
| 33 | Remove Delta code only after proving it unused | PASS | removal table in §C lists the importers verified before deletion |
| 34 | Every remaining Delta hit classified | PASS | §I |
| 35 | Regulatory status described accurately (FIU-IND ≠ SEBI) | PASS | `README.md`, `COINDCX_SETUP.md` §header |
| 36 | IP-binding gate confirmed before any live-trading claim | PASS (with note) | optional per CoinDCX's own key guide ("if you want") and its API page; no live-trading claim is made until a real key read is verified — see §J.1/J.6 |
| 37 | Implement + run tests + lint/typecheck/build, fix errors | PASS | 28/28, 36/36, 78/78, build ✓, 1/1, 1/1; lint + typecheck clean |
| 38 | No secrets in browser/localStorage/git/logs/bundles | PASS | bundle sweep + response assertions + `git grep` clean; credentials env-only, 409 on POST |

**Blocking issues: none.** Two items require a real key on a real deployment to
close completely (§J.1 timestamp unit, §J.6 live venue reachability); both fail
loudly rather than silently.
