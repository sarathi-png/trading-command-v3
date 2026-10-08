# CoinDCX Futures setup

Everything needed to connect Trading Command to CoinDCX Futures, in the order you
need it. Read §1 first: **the IP-binding question decided this whole
architecture.**

- **Venue:** CoinDCX Futures (USDT-margined perpetuals), India.
- **API host:** `https://api.coindcx.com` (private + instrument data),
  `https://public.coindcx.com` (candlesticks, order-book depth).
- **Docs:** <https://docs.coindcx.com/>
- **Regulatory note:** CoinDCX is an Indian VDA exchange and its futures API is
  offered to Indian citizens/entities; CoinDCX is registered with **FIU-IND**
  (Financial Intelligence Unit – India) as a reporting entity. FIU-IND
  registration is an anti-money-laundering registration, **not** a SEBI
  licence, and it says nothing about the risk of futures trading. Nothing in
  this application is investment advice.

---

## 1. IP binding is OPTIONAL — that is why this app runs on Vercel alone

Delta Exchange India requires a whitelisted IP for any API key with trading
permissions, which is why the previous design needed a gateway with a fixed
outbound address. **CoinDCX does not impose that requirement for futures API
keys.**

Evidence:

- The CoinDCX "How to Generate API Key for Algo Trading" guide describes the
  binding step as *"Check the 'Bind IP Address to the API Key' option **if you
  want** to limit access to your specific device IP"* — optional, not mandatory.
- The API dashboard exposes IP whitelisting as a **security feature** you may
  enable, not a precondition for a key that can trade.
- The API reference documents no IP restriction on futures endpoints, and its
  error tables list no IP-related rejection.

Consequences for this deployment:

| | |
|---|---|
| Static-IP gateway | **Not required** — and not used |
| Vercel outbound IP | **Never discovered, never hard-coded** (Vercel does not guarantee one) |
| Where private requests are signed | In the Vercel serverless function that serves `/api/*` |
| Where credentials live | The deployment environment, server-side only |

> **If CoinDCX ever makes IP binding mandatory for a required futures
> operation, STOP — do not add a gateway to work around it.** The correct
> response is to keep live trading disabled and report:
> *"CoinDCX currently requires IP binding for the required operation, therefore
> direct Vercel deployment cannot safely satisfy the requirement."*
> See docs/EXCHANGE_MIGRATION.md §"Decision gate".

### Should you bind an IP anyway?

Binding is a genuine hardening step — a leaked key cannot be used from
elsewhere. But it is incompatible with Vercel, because serverless functions
egress from addresses Vercel does not publish or guarantee. Options:

- **Leave binding off** (what this project does): key + secret + the deployment's
  own authentication protect the account.
- **Bind to a fixed IP and accept the consequence:** private calls will fail from
  Vercel with a 401/403, and you would need a fixed-egress host — exactly the
  architecture this migration removed.

---

## 2. Create the API key

1. Sign in to CoinDCX → profile → **API Dashboard** (or
   <https://coindcx.com/api/>).
2. **Create new key**, confirm with your OTP/2FA.
3. Name it something you will recognise (e.g. `trading-command-prod`).
4. **Permissions:** enable only what you need.
   - *Read* is enough until you deliberately enable live trading.
   - For live orders the key needs futures **trading** permission; leave
     withdrawal/transfer permissions **off** — this app never withdraws.
5. **Bind IP Address:** leave it **unchecked** for Vercel deployment (see §1).
6. Copy the **secret immediately** — CoinDCX shows it exactly once. If you lose
   it, revoke the key and create a new one.

Start with a **read-only key** while you verify §5, then add trading permission
when you actually arm live mode. The app's `LIVE_EXECUTION_ENABLED` flag stays
`false` by default, so a trading-enabled key alone cannot place an order.

---

## 3. Environment variables

Set these on the deployment (Vercel → Project → Settings → Environment
Variables). They are read **only** by server code; never prefix them with
`NEXT_PUBLIC_`.

| Variable | Required | Meaning |
|---|---|---|
| `COINDCX_API_KEY` | for private data | API key from §2 |
| `COINDCX_API_SECRET` | for private data | API secret from §2 (shown once) |
| `COINDCX_BASE_URL` | optional | Default `https://api.coindcx.com`. Tests point it at a local mock |
| `COINDCX_PUBLIC_BASE_URL` | optional | Default `https://public.coindcx.com` |
| `EXCHANGE_NAME` | optional | Default `coindcx`; reported in `/api/system` |
| `EXCHANGE_MARKET_ENABLED` | optional | Default `true`. Public market data (no credentials) |
| `LIVE_EXECUTION_ENABLED` | optional | Default `false`. Must be `true` **and** the UI armed before any order is sent |

Legacy compatibility: `DELTA_MARKET_ENABLED` is still honoured as a fallback for
`EXCHANGE_MARKET_ENABLED`. `TRADING_GATEWAY_URL`, `TRADING_GATEWAY_SECRET`,
`DELTA_API_KEY` and `DELTA_API_SECRET` are **ignored** by this application; you
can delete them.

No endpoint accepts a key from the browser. `POST
/api/settings/exchange-credentials` returns **409** and explains that credentials
are environment-only; the Settings screen prints the variable *names* that are
missing and nothing else.

---

## 4. What the app calls, and how it signs

Signing is CoinDCX's, not Delta's:

```
signature = hex( HMAC_SHA256( COINDCX_API_SECRET, <the exact JSON body as sent> ) )
headers:  X-AUTH-APIKEY: <key>
          X-AUTH-SIGNATURE: <signature>
          Content-Type: application/json
body:     always contains "timestamp" — epoch MILLISECONDS (Date.now())
```

- The **body** is what gets signed. Nothing else (no method, path or query) is
  part of the signature — the opposite of Delta's scheme.
- The timestamp lives **inside the body**. CoinDCX rejects an order whose
  timestamp is older than **10 seconds**, so the signer writes it immediately
  before each request and a caller cannot override it.
- Private **reads** are sent as `POST` with a signed body too (e.g. `POST
  /wallets` with `{timestamp}`), because that is how the reference documents
  them.
- There is **no client order id** on CoinDCX futures: see §6.

Endpoints used (`/exchange/v1/derivatives/futures/…` unless noted):

| Purpose | Endpoint |
|---|---|
| Wallet balances | `POST /wallets` |
| Wallet ledger | `GET /wallets/transactions` |
| Positions (all / by pair) | `POST /positions` |
| Set leverage | `POST /positions/update_leverage` |
| Close position at market | `POST /positions/exit` |
| Attach TP/SL to a position | `POST /positions/create_tpsl` |
| Cancel all orders for a position | `POST /positions/cancel_all_open_orders_for_position` |
| Realised P&L per trade | `POST /positions/transactions` |
| Order list | `POST /orders` |
| Create order | `POST /orders/create` |
| Cancel order | `POST /orders/cancel` |
| Fills | `POST /trades` (per pair, dated) |
| Instruments | `GET /data/active_instruments` (public) |
| Recent trades | `GET /data/trades?pair=` (public) |
| Order book | `GET public.coindcx.com/market_data/v3/orderbook/{pair}-futures/{10,20,50}` |
| Candles | `GET public.coindcx.com/market_data/candlesticks?pair=&from=&to=&resolution=&pcode=f` |
| Live prices | `GET public.coindcx.com/market_data/v3/current_prices/futures/rt` |

### Known limits of this build (deliberate, not oversights)

- **Stop / take-profit orders are not sent to `orders/create`.** The reference
  documents the enums but every official sample uses `market_order` /
  `limit_order` only, so the adapter refuses the rest rather than sending an
  unverified enum on a live path. Position-level TP/SL is available through
  `positions/create_tpsl` (market legs only — `take_profit_market` /
  `stop_market`; the docs state limit variants are not supported).
- **No reduce-only orders.** CoinDCX expresses "reduce" as `positions/exit`.
  `POST /api/orders` with `reduce_only: true` is refused with HTTP 422 and code
  `REDUCE_ONLY_UNSUPPORTED`, because silently dropping the flag could *open* a
  position.
- **No websocket streaming.** A socket needs a long-lived process; the Vercel
  deployment has none. Market data is polled over REST. See
  `src/lib/exchange/coindcx/websocket.ts`.
- **Wallet response shape.** The reference documents the *request* for
  `/wallets` but not its response body, so the parser accepts the two shapes
  CoinDCX uses (array of currency rows, or an object keyed by currency) and
  **throws** rather than reporting a zero balance it cannot justify.

---

## 5. Verify the connection

1. **Credentials present** — Settings → *Exchange API · CoinDCX Futures* shows
   `CONFIGURED`, or:
   ```bash
   curl -s -H "cookie: <session>" https://<your-app>/api/settings/exchange-credentials
   # { "configured": true, "source": "environment", "missing": [], "baseUrl": "https://api.coindcx.com", ... }
   ```
2. **Public market data** — `GET /api/system` → `exchangeMarket: "online"`
   (a live probe of the instruments endpoint, cached 30 s).
3. **Private read (the real test)** — set the data source to *CoinDCX Futures*
   in Settings and open the *EXCHANGE ACCOUNT · COINDCX* panel, or:
   ```bash
   curl -s -H "cookie: <session>" https://<your-app>/api/exchange/summary
   ```
   `available: true` with a balance means key, secret, signature and clock are
   all correct. Balances are per margin currency: **USDT** for USDT-margined
   futures (INR-margined accounts report INR separately).

### Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `available: false`, error mentions *rejected the API key or signature* | Wrong key/secret, revoked key, or a clock skew > 10 s on the **server** | Re-copy the secret; check the deployment's clock |
| Error mentions *IP binding* / 403 | You bound an IP to the key | Unbind it, or accept that Vercel cannot present a fixed IP (§1) |
| Balances unavailable, everything else fine | The account has no USDT futures wallet, or a response shape this build does not recognise | Fund the futures wallet; the app deliberately refuses to guess a balance |
| `daily_pnl_unavailable` on an order | Today's realised P&L could not be proven | Expected behaviour — the daily-loss limit fails closed. See §6 |
| `EXCHANGE_UNKNOWN_RESULT` / HTTP 409 on an order | The venue did not confirm the submission | Reconcile with `GET /api/orders/status?clientOrderId=…`; never resubmit |

---

## 6. Idempotency, cancellation and the daily-loss limit

CoinDCX has **no client order id**, so there is no venue-side deduplication to
lean on. The application compensates:

1. `POST /api/orders` claims the `client_order_id` in Postgres (unique column)
   **before** submitting. A retry with the same id returns the stored result.
2. The submission is attempted **exactly once**. Reads retry with backoff;
   mutations never do.
3. If the outcome is not definitive (timeout, dropped connection, 5xx, or a
   success payload without an order id), the row is marked `unknown` and the
   order is **reconciled** by scanning the venue's recent orders for a single
   match on pair + side + size inside the submission window:
   - one match → the order exists; the row is updated and nothing is resent;
   - provably no match (the scan reached the end of the history) → nothing was
     created;
   - anything ambiguous → `unknown`, and the operator decides. A retry must use
     a **new** `client_order_id`.

`GET /api/orders/status?clientOrderId=…` is the read-only reconciliation path at
any time.

`liveRealizedPnlToday()` reads `POST /positions/transactions` and sums `amount`
for today's non-funding transactions (UTC). It returns **`null` — which blocks
trading — whenever the figure cannot be proven** (request failed, payload not a
list, a page came back full so the window may be truncated, or a timestamp was
unparseable). A daily-loss limit that assumes zero loss is not a limit.

---

## 7. Safety posture

- `LIVE_EXECUTION_ENABLED=false` by default; live orders additionally need
  `mode: "live"` **and** the master switch armed with the confirmation token.
- The risk layer (`src/lib/risk.ts`) is the same one that guards paper fills:
  symbol allowlist, quantity, price, max order value, max open positions,
  leverage cap, daily-loss limit.
- Secrets never reach the browser: they are read in server-only modules, and the
  end-to-end test asserts that no served bundle contains a key, a secret or a
  server-only marker.
- Everything is audited: `audit_log` records rejections, risk blocks, placements,
  reconciliation outcomes and credential-status attempts.
