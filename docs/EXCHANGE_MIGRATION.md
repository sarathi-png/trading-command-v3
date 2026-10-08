# Exchange migration: Delta Exchange India → CoinDCX Futures

What changed, why, what was deliberately NOT changed, and how to verify it. Read
with `docs/COINDCX_SETUP.md` (venue setup) and `docs/VERCEL_DEPLOYMENT.md`
(deployment).

---

## 1. Why this migration happened

Delta Exchange India requires a **whitelisted IP for any API key with trading
permissions**; a key used from an unlisted address is rejected
(`ip_not_whitelisted_for_api_key`). Vercel serverless functions do not have a
fixed, published outbound address, so the previous design put the exchange
credentials on a small always-on service with a static IPv4 and routed private
calls through it.

That worked, but the requirement was Delta's, not the application's. CoinDCX
requires **no IP binding for futures API keys**, so the middle hop disappears:

```
BEFORE                                  AFTER
Browser                                 Browser
  │ /api/*                                │ /api/*
Vercel app  ── Bearer gateway secret ─┐  Vercel app (serverless functions)
  │ (no credentials)                  │    │  signs with COINDCX_API_KEY/SECRET
Static-IP gateway  ← DELTA_API_KEY ────┘   │  HTTPS
  │ fixed IPv4 (Delta allowlist)            ▼
Delta Exchange India                    api.coindcx.com
```

### Decision gate (kept as a standing rule)

If CoinDCX ever requires IP binding for a required futures operation, the correct
action is **not** to reintroduce a gateway. It is to keep live trading disabled
and report:

> CoinDCX currently requires IP binding for the required operation, therefore
> direct Vercel deployment cannot safely satisfy the requirement.

---

## 2. Endpoint map

| Capability | Delta (removed) | CoinDCX (current) |
|---|---|---|
| Wallet balances | `GET /v2/wallet/balances` (via gateway) | `POST /exchange/v1/derivatives/futures/wallets` |
| Wallet ledger | `GET /v2/wallet/transactions` | `GET …/wallets/transactions` |
| Positions | `GET /v2/positions?underlying_asset_symbol=…` (fan-out per base asset) | `POST …/positions` (all pairs in one call) |
| Open orders | `GET /v2/orders?state=open` | `POST …/orders` (client-side status filter) |
| Fills | `GET /v2/fills` | `POST …/trades` (per pair, dated window) |
| Create order | `POST /v2/orders` | `POST …/orders/create` |
| Cancel order | `DELETE /v2/orders` | `POST …/orders/cancel` |
| Close position | gateway `/api/orders/close-position` | `POST …/positions/exit` |
| Leverage | `POST /v2/products/{id}/orders/leverage` | `POST …/positions/update_leverage` |
| Realised P&L | ledger `cashflow` entries | `POST …/positions/transactions` (`amount`) |
| Candles | Delta REST `/v2/history/candles` | `public.coindcx.com/market_data/candlesticks` |
| Order book | Delta REST `/v2/l2orderbook` | `public.coindcx.com/market_data/v3/orderbook/…` |
| Tickers | Delta REST `/v2/tickers` | `public.coindcx.com/market_data/v3/current_prices/futures/rt` |
| Streaming | Delta browser websocket overlay | **REST polling only** (no long-lived process on Vercel) |

### Authentication map

| | Delta | CoinDCX |
|---|---|---|
| Signature | `HMAC_SHA256(secret, METHOD + ts + path + "?" + query + body)` | `HMAC_SHA256(secret, <exact JSON body>)` |
| Headers | `api-key`, `timestamp`, `signature` | `X-AUTH-APIKEY`, `X-AUTH-SIGNATURE` |
| Timestamp | header, seconds | **inside the body**, milliseconds |
| Rejected when | signature/clock invalid | **timestamp older than 10 s** |
| Client order id | supported (`client_order_id`) | **not supported** |
| IP binding | required for trading keys | optional |

---

## 3. What was added

```
src/lib/exchange/
  types.ts              normalised models (ticker, candle, order book, balance,
                        position, order, fill, capabilities, order request)
  errors.ts             ExchangeError + codes + orderOutcomeKnown()
  symbols.ts            canonical symbol ("BTCUSD") ↔ venue pair ("B-BTC_USDT")
  service.ts            the single facade: config, capabilities, market reads,
                        private reads, realizedPnlTodayUtc, mutations
  coindcx/
    auth.ts             signing (body-only HMAC, millisecond timestamp)
    client.ts           transport: read/mutate split, retry policy, error mapping
    market.ts           instruments, tickers, candles, order book, trades
    account.ts          wallets, ledger, fills, position transactions
    positions.ts        positions, close, leverage, TP/SL, cancel-for-position
    orders.ts           list, create-once, cancel, reconciliation verdicts
    websocket.ts        documents why streaming is NOT wired up
    parse.ts            expectArray(): a 200 that is not a list is not "no data"
tests/exchange/coindcx.test.ts   signing vectors + mock-venue behaviour
tests/live-exchange.test.mjs     Vercel ↔ CoinDCX boundary (end to end)
db/migrations/0001_exchange_neutral_live_orders.sql
docs/COINDCX_SETUP.md, docs/VERCEL_DEPLOYMENT.md, this file
```

The symbol adapter keeps the application's canonical vocabulary (`BTCUSD`) and
maps it to the venue's pair (`B-BTC_USDT`) in exactly one place. No component,
route or stored watchlist had to change, and no UI hard-codes a venue pair.

---

## 4. What was removed (and why nothing else was)

Each removal was verified to have no remaining importer before deletion:

| Removed | Evidence it was unused |
|---|---|
| `src/lib/tradingGateway/` | Only importers were `account.ts`, `credentials.ts`, `deltaAccount.ts`, `api/{orders,orders/status,system}` — all rewired to `src/lib/exchange` |
| `src/lib/market/delta.ts` | Importers were `market/service.ts` (rewired), `api/system` (now probes CoinDCX), `api/orders` (now uses `marketTickers`), `tradingGateway/positions.ts` (deleted) |
| `src/lib/deltaAccount.ts` | Only `api/delta/summary`, replaced by `src/lib/exchangeAccount.ts` + `api/exchange/summary` |
| `src/app/api/delta/summary/` | Renamed to `/api/exchange/summary` (UI updated) |
| `src/app/api/settings/delta-credentials/` | Renamed to `/api/settings/exchange-credentials` (UI, tests updated) |
| Delta browser websocket overlay in `AppShell.tsx` | Replaced by the existing REST polling path; a direct browser→venue socket adds an exfiltration surface for no gain |
| `tests/live-gateway.test.mjs` | Superseded by `tests/live-exchange.test.mjs`, which asserts the gateway is **not** contacted |

**Kept on purpose:**

- `trading-gateway/` — a standalone, self-contained service with its own build
  and tests. It is no longer part of the request path, is not required by any
  deployment step, and is excluded from the root `tsconfig.json`. Deleting a
  working, tested component that a reader may still want for a Delta-era
  deployment is a bigger change than this migration needs. Its README states
  plainly that it is not needed for CoinDCX.
- `src/lib/credentials.ts` keeps `purgeLegacyDeltaCredentials()`: an older build
  could store an encrypted Delta key row in the database, and removing that
  liability from an upgraded deployment is still useful.
- Legacy `DELTA_MARKET_ENABLED` is still read as a fallback for
  `EXCHANGE_MARKET_ENABLED` so an existing deployment's environment does not
  silently lose public market data.

---

## 5. Database change (no data destroyed)

`db/migrations/0001_exchange_neutral_live_orders.sql`:

```sql
delta_order_id            → exchange_order_id        -- rename, values preserved
(new)  exchange           text NOT NULL DEFAULT 'coindcx'
(new)  exchange_symbol    text
+ rows that already carried an order id are labelled exchange='delta'
+ an audit_log entry records the change
```

Run it **before** `npm run db:push`:

```bash
psql "$DATABASE_URL" -f db/migrations/0001_exchange_neutral_live_orders.sql
npm run db:push
```

`drizzle-kit push` alone would propose dropping `delta_order_id` and adding the
new columns, destroying the venue order ids of every historical live order —
which is exactly what those rows exist to preserve.

Application-side, one settings value is migrated on read: `dataSource: "delta"`
becomes `"delta"|"live"`-aware and is normalised to `"live"`, so an upgraded
deployment does not silently fall back to demo data.

---

## 6. Idempotency: the one behaviour that got weaker, and the compensation

Delta supported a client order id, and the gateway kept a durable ledger. CoinDCX
has neither, so:

- **Before:** app ledger → gateway ledger → venue `client_order_id`
  (three layers).
- **After:** app ledger (Postgres, unique `client_order_id`) → **exactly one**
  submission → reconciliation by scanning the venue's recent orders.

What is *preserved*: never auto-retrying an uncertain order; recording
`unknown`; refusing to resubmit the same `client_order_id` while its outcome is
unknown; and reconciling before acting again. What is *weaker*: the venue itself
cannot reject a duplicate, so the correctness of the deduplication rests on our
own ledger — which is why the ledger is claimed **before** the submission and
the reconciliation rules are conservative (`coindcx/orders.ts`):

- exactly one candidate order (pair + side + size ±0.5 % + window) → `found`;
- provably no candidate, and the scan reached the end of the order history →
  `not_found` (retry permitted with a NEW id);
- more history than the scan reached, or several candidates → `unknown`.

A non-list response on any list endpoint throws (`parse.ts`), because treating
"payload we do not understand" as "no rows" would let reconciliation declare
`not_found` and permit a duplicate order.

---

## 7. Defect found and fixed during the migration

`matchTrades()` in the (then) `deltaAccount.ts` computed round-trip P&L with the
sign of the **closing** fill instead of the opening one:

```ts
// before (wrong): a winning long was booked as a loss
(isBuy ? price - lot.price : lot.price - price)
side: isBuy ? "long" : "short"
```

For a long opened at 60 000 and closed at 61 000 this produced **−10** instead of
**+10**, and it labelled the round trip with the wrong side. Both are corrected in
`src/lib/exchangeAccount.ts` (and the opening fill's fee is now charged to the
round trip, not just the closing one). The analytics panel and the journal's
derived figures were affected; **no order-path or risk decision used this
function**, so nothing about execution safety changed.

---

## 8. Verification performed

| Check | Result |
|---|---|
| `npm run lint` | clean |
| `npm run typecheck` (app + gateway) | clean |
| `npm run test:quant` | 28/28 |
| `npm run test:exchange` | 36/36 — signing vectors, symbol map, status mapping, retry policy, mock-venue signature re-verification, reconciliation verdicts |
| `npm run test:gateway` | 78/78 (standalone service, unaffected) |
| `npm run build` | success, all routes present (`/api/exchange/summary`, `/api/settings/exchange-credentials`, `/api/positions/close`) |
| `npm run test:paper` | 1/1 — paper works with **no** credentials configured |
| `npm run test:live-exchange` | 1/1 — boundary: signed direct calls, retired gateway receives **zero** requests, unverifiable P&L blocks with 0 venue POSTs, reduce-only refused locally, order submitted exactly once with `B-BTC_USDT` mapping, retry deduplicated, no secret in any response or bundle |
| Secret sweep | no key/secret value in any served bundle; server-only markers absent from client chunks |
| Live trading | remains **OFF** (`LIVE_EXECUTION_ENABLED` default `false`, `liveArmed` off) |

---

## 9. Rollback

1. Redeploy the previous commit (it used the gateway path).
2. Point `TRADING_GATEWAY_URL`/`TRADING_GATEWAY_SECRET` back at the running
   gateway and restore its `DELTA_API_KEY`/`DELTA_API_SECRET`.
3. The database is forward-compatible in the direction that matters: the rename
   in §5 is reversible (`ALTER TABLE live_orders RENAME COLUMN exchange_order_id
   TO delta_order_id`), and rows written after the migration carry
   `exchange='coindcx'` with a CoinDCX order id — keep them, but do not expect
   Delta to recognise them.

Nothing in the live-trading path was ever enabled by this migration, so a
rollback is a code deploy and an environment change, not a data rescue.
