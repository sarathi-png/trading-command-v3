# Vercel environment & deployment checklist — Trading Command v3

This is the authoritative runbook for getting v3 (Trading Command terminal)
live on Vercel with **persistent settings + journal** and a working CoinDCX
feed. Read it before deploying and after every config change.

> The full Vercel-only deployment guide is `docs/VERCEL_DEPLOYMENT.md`; this
> file focuses on the environment variables and the failure modes that come
> from an ephemeral filesystem.

## Why data was falling back to demo

On Vercel, each serverless function instance is **ephemeral**. The file-backed
store (`src/lib/fileStore.ts`) silently falls back to `/tmp/trading-command-v3-data`
on hosts that mount the deployment directory read-only. `/tmp` is erased on
every cold start. Result:

- `settings.json` (incl. `dataSource: "live"`) is lost on restart. Every fresh
  request loads `DEFAULT_SETTINGS` (`dataSource: "demo"`) — so chart, coin
  names and live balance all show the dummy demo simulator.
- Private account data (balance, positions) is unavailable because
  `COINDCX_API_KEY`/`COINDCX_API_SECRET` are not set on that deployment → the
  account panel shows "NOT CONNECTED" instead of live figures.

There is no workaround code for this: the only durable state is a real
database. Fix the deployment, don't add more environment fallbacks.

## Project

- Project name: `trading-command-v3`
- Project ID: `prj_ifwAJ05LGzzdYC0mTCpQTkd0sqhf` (from `.vercel/project.json`)
- Set every secret below as **Production Secret** in Vercel, never committed.

## Production environment variables

Required (secrets):

| Name | Value | Why |
|------|-------|-----|
| `API_PASSWORD` | from local `.env` | Operator login; routes fail closed (503) when unset |
| `SESSION_SECRET` | from local `.env` | Signs session cookie; keep different from `API_PASSWORD` |
| `COINDCX_API_KEY` | from the CoinDCX API dashboard | API key; leave "Bind IP Address" unchecked (Vercel has no fixed egress IP, and CoinDCX does not require binding) |
| `COINDCX_API_SECRET` | shown once at key creation | Signs each private request (HMAC-SHA256 over the JSON body) |
| `COINDCX_BASE_URL` | `https://api.coindcx.com` | Optional override (tests point it at a mock) |
| `COINDCX_PUBLIC_BASE_URL` | `https://public.coindcx.com` | Optional: candles, depth, live prices |
| `USD_INR_RATE` | `88` | USD-to-INR display rate |

**Retired variables — delete them if present:** `TRADING_GATEWAY_URL`,
`TRADING_GATEWAY_SECRET`, `DELTA_API_KEY`, `DELTA_API_SECRET`. Nothing reads
them; `DELTA_MARKET_ENABLED` survives only as a fallback alias for
`EXCHANGE_MARKET_ENABLED`. See `docs/EXCHANGE_MIGRATION.md`.

Feature flags:

| Name | Value | Why |
|------|-------|-----|
| `EXCHANGE_MARKET_ENABLED` | `true` | Public CoinDCX market data (tickers, candles). `DELTA_MARKET_ENABLED` still works as a fallback alias |
| `PAPER_TRADING_ENABLED` | `true` | Paper execution |
| `LIVE_EXECUTION_ENABLED` | `false` | Keep off until live order routing is intended |
| `STRATEGY_ENGINE_ENABLED` | `true` | Strategy + quant evaluation routes |
| `ORDERBOOK_ENABLED` | `true` | L2 orderbook panel |
| `AUTO_S_R_ENABLED` | `true` | Automatic S/R |
| `JOURNAL_ENABLED` | `true` | Trade journal |
| `ANALYTICS_ENABLED` | `true` | Analytics |
| `TRADINGVIEW_WEBHOOK_ENABLED` | `false` | TradingView webhook (disabled by default) |
| `TELEGRAM_ENABLED` | `false` | Telegram (disabled by default) |

## Persistent state (recommended)

Attach a Vercel Postgres database (free tier):

1. Vercel dashboard → **Storage** → **Create database** → PostgreSQL.
2. Wait for provisioning, then copy the **connection string**.
3. Vercel dashboard → **Settings** → **Environment Variables** → add:
   - `DATABASE_URL` = the new connection string, type `secret`.
4. Run the schema migration locally once (with that URL exported):

   ```powershell
   $env:DATABASE_URL = "<paste DATABASE_URL>"
   npx drizzle-kit push
   ```

   This creates the `settings`, `trade_journal`, `paper_orders`,
   `paper_positions`, `live_orders`, `alert_rules`, `signals`, `drawings` and
   `audit_log` tables. Vercel's DB only needs a `SELECT` probe from the app.
   If the database already existed before the CoinDCX migration, run the
   exchange-neutral ledger migration FIRST:
   `psql "$DATABASE_URL" -f db/migrations/0001_exchange_neutral_live_orders.sql`
   (otherwise `db:push` would drop `delta_order_id` and lose recorded venue
   order ids — see `docs/EXCHANGE_MIGRATION.md` §5).
5. Redeploy:

   ```powershell
   vercel deploy --prod --yes
   ```

After this, `/api/system` should report `db: true`, and
`GET /api/settings` reports `dataSource === "live"` once you select
*CoinDCX Futures* in Settings.

## If you intentionally keep the file store (demo only)

This is the local dev default. It is NOT durable on Vercel: `fileStore.ts`
falls back to `/tmp`, which is erased on each cold start. Settings and
journal will not survive restarts. Do not use this path for a real
deployment that needs persistence.

## Quick diagnostics

1. Open the app → the **login gate** appears if `API_PASSWORD` is set
   (correct), or **503** (wrong/absent).
2. Settings → **System status**: expect `db: true`, `exchangeMarket: online`,
   `exchangeAccount: configured`, `exchange.reachable: true`, `demoMode: false`.
   Any other combination indicates the misconfigured item below.
3. Settings → **EXCHANGE API · COINDCX FUTURES**: expect `CONFIGURED`, the
   exchange host, and "Missing variables: none".
4. `GET /api/settings` → confirm `dataSource === "live"`.
5. `GET /api/exchange/summary` → expect `available: true` (live balance).
   `available: false` plus an error means the key/secret is wrong or revoked,
   the futures wallet is empty, or (only if you bound an IP to the key) the
   request did not come from that address.
6. `GET /api/market/tickers` → expect `source: "live"` (live markets).

## Rotating the CoinDCX API key

Create the replacement key in the CoinDCX API dashboard (read-only first if you
want a dry run) → update `COINDCX_API_KEY` / `COINDCX_API_SECRET` in Vercel →
redeploy → verify `GET /api/exchange/summary` returns `available: true` → revoke
the old key at CoinDCX. There is nothing to change on any other host, because
there is no other host.

## Rotating secrets after a leak

```powershell
vercel env rm API_PASSWORD production --yes
vercel env add API_PASSWORD production     # paste the new value, Ctrl+Z
```

## Redeploy after env-var changes

```powershell
vercel deploy --prod --yes
```
