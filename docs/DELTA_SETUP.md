# Delta Exchange India setup

> **SUPERSEDED (Delta Exchange India).** This application now trades on
> **CoinDCX Futures** and no longer calls Delta. This file is kept as history:
> it documents the venue-specific details (contracts vs base units, the
> `client_order_id` field, the IP allowlist requirement) that explain why the
> architecture looked the way it did. For current setup read
> **`docs/COINDCX_SETUP.md`** and **`docs/EXCHANGE_MIGRATION.md`**.


## 1. Create API keys

Delta India app → Profile → **API Management** → Create API Key.
Grant *Read Data* (+ *Trading* only if you intend live execution).
Whitelist your **gateway's static IPv4** — Delta rejects non-whitelisted signed
requests, and Vercel cannot offer a fixed outbound IP. See
`docs/TRADING_GATEWAY_DEPLOYMENT.md` Part 3 for how to find that address.

## 2. Configure the GATEWAY (not the app)

The Delta key and secret belong to the static-IP trading gateway:

```env
# trading-gateway/.env  — on the host whose IPv4 you allowlisted at Delta
DELTA_API_KEY=your_key
DELTA_API_SECRET=your_secret
DELTA_BASE_URL=https://api.india.delta.exchange
```

The Vercel application is configured with the gateway instead:

```env
TRADING_GATEWAY_URL=https://gateway.example.com
TRADING_GATEWAY_SECRET=<same value as the gateway's TRADING_GATEWAY_SECRET>
```

Restart the gateway, then Settings → **Delta API · Trading gateway** should show
**GATEWAY CONFIGURED**. Secrets are read from the environment only — never from
the browser, the database, or logs. Full runbook:
`docs/TRADING_GATEWAY_DEPLOYMENT.md`.

## 3. Endpoints used (current docs)

| Purpose | Endpoint |
|---|---|
| Tickers | `GET /v2/tickers` |
| Candles | `GET /v2/history/candles?symbol=&resolution=&start=&end=` |
| Order book | `GET /v2/orderbook?symbol=` |
| Trades | `GET /v2/trades?symbol=` |
| Wallet | `GET /v2/wallet/balances` (auth) — via the gateway |
| Wallet ledger | `GET /v2/wallet/transactions` (auth) — via the gateway |
| Fills | `GET /v2/fills` (auth) — via the gateway |
| Positions | `GET /v2/positions?underlying_asset_symbol=` (auth) — via the gateway |
| Orders | `GET/POST /v2/orders` (auth) — via the gateway |
| Cancel order | `DELETE /v2/orders` (auth) — via the gateway |
| Order lookup | `GET /v2/orders/client_order_id/{id}` (auth) — via the gateway |
| Product lookup | `GET /v2/products/{symbol}` — public, used to resolve product_id |

Authentication for private calls (performed by the GATEWAY, never by the app):
`signature = HMAC_SHA256(secret, METHOD + timestamp + path + queryString + body)`,
sent as `api-key`, `timestamp`, `signature` headers. Signatures expire in ~5 s;
the client signs per-request with the current unix time. See
`trading-gateway/src/delta/signing.ts` and its deterministic test vectors.

## 4. WebSocket

Public socket: `wss://socket.india.delta.exchange`.
The browser subscribes to `v2/ticker` for watched symbols (no credentials).
Private channels (`orders`, `positions`, `fill`) require `key-auth`
(`HMAC(secret, "GET" + ts + "/live")`) and are consumed server-side in a future iteration;
today private data flows through authenticated REST.

## Rate limits

All market responses are cached 2–10 s server-side; polls are throttled so a single
dashboard stays far below Delta's limits. HTTP 429 is surfaced as "rate limited" in the UI.
