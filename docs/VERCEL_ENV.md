# Vercel environment & deployment checklist — Trading Command v3

This is the authoritative runbook for getting v3 (Trading Command terminal)
live on Vercel with **persistent settings + journal** and a working Delta
feed. Read it before deploying and after every config change.

## Why data was falling back to demo

On Vercel, each serverless function instance is **ephemeral**. The file-backed
store (`src/lib/fileStore.ts`) silently falls back to `/tmp/trading-command-v3-data`
on hosts that mount the deployment directory read-only. `/tmp` is erased on
every cold start. Result:

- `settings.json` (incl. `dataSource: delta`) and the encrypted credentials
  are lost on restart. Every fresh request loads `DEFAULT_SETTINGS`
  (`dataSource: "demo"`) — so chart, coins names and live balance all show
  the dummy demo simulator.
- `deltaAccountConfigured()` also resolves to `none` when the encrypted
  credentials row disappears → account panel shows "NOT CONNECTED".

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
| `DELTA_API_KEY` | from local `.env` | Delta read-only API key (server-side only) |
| `DELTA_API_SECRET` | from local `.env` | Delta API secret (used to sign requests) |
| `USD_INR_RATE` | `83` | USD-to-INR display rate (defaults to `83`) |

Feature flags:

| Name | Value | Why |
|------|-------|-----|
| `DELTA_MARKET_ENABLED` | `true` | Public Delta market data (tickers, candles) |
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
   `paper_positions`, `alert_rules`, `signals`, `drawings` and
   `audit_log` tables. Vercel's DB only needs a `SELECT` probe from the app.
5. Redeploy:

   ```powershell
   vercel deploy --prod --yes
   ```

After this, `/api/system` should report `db: true`, and
`GET /api/settings` reports `dataSource === "delta"` after you save
credentials.

## If you intentionally keep the file store (demo only)

This is the local dev default. It is NOT durable on Vercel: `fileStore.ts`
falls back to `/tmp`, which is erased on each cold start. Settings and
journal will not survive restarts. Do not use this path for a real
deployment that needs persistence.

## Quick diagnostics

1. Open the app → the **login gate** appears if `API_PASSWORD` is set
   (correct), or **503** (wrong/absent).
2. Settings → **System status**: expect `db: true`, `deltaMarket: online`,
   `deltaAccount: connected`, `demoMode: false`. Any other combination
   indicates the misconfigured item below.
3. Settings → **Delta API**: expect `CONFIGURED: true`, `source: env|stored`.
4. `GET /api/settings` → confirm `dataSource === "delta"`.
5. `GET /api/delta/summary` → expect `available: true` (live balance).
   `available: false` plus an error means credentials are wrong/revoked or
   the DB is unreachable.
6. `GET /api/market/tickers` → expect `source: "delta"` (live markets).

## Rotating secrets after a leak

```powershell
vercel env rm API_PASSWORD production --yes
vercel env add API_PASSWORD production     # paste the new value, Ctrl+Z
```

## Redeploy after env-var changes

```powershell
vercel deploy --prod --yes
```
