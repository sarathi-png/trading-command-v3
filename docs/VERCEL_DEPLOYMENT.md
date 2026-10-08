# Deploying on Vercel alone

Trading Command runs entirely on Vercel plus a hosted Postgres. There is **no
gateway, no VPS and no static IP to arrange**, because CoinDCX does not require
an IP-bound API key (see `docs/COINDCX_SETUP.md` §1).

```
Vercel (Next.js app, serverless functions, proxy.ts auth)
   │  COINDCX_API_KEY / COINDCX_API_SECRET from the project environment
   ├─► https://api.coindcx.com      (private + instruments)
   └─► https://public.coindcx.com   (candles, order book, prices)
Database: any PostgreSQL reachable over TLS (Neon, Supabase, Vercel Postgres…)
```

## 1. What you need

| Item | Notes |
|---|---|
| Vercel account | Hobby is enough for personal use; no card required for the free tier |
| PostgreSQL | Free tiers: Neon, Supabase, Vercel Postgres. `pg` connects over TLS via `DATABASE_URL` |
| CoinDCX account | Indian citizen/entity; API key optional (the app runs in demo mode without one) |

This app is a **single-user** terminal: one password (`API_PASSWORD`) protects
every `/api` route. Do not expose it publicly without that password set — an
unset `API_PASSWORD` makes the API return 503 rather than falling open.

## 2. Environment variables

Set these in Vercel → Project → Settings → Environment Variables (Production,
and Preview if you use previews).

```bash
# ---- required -------------------------------------------------------------
DATABASE_URL=postgresql://…              # pooled connection string
API_PASSWORD=<openssl rand -hex 32>      # login password
SESSION_SECRET=<openssl rand -hex 32>    # cookie signing; separate from the password

# ---- venue (server-side only; NEVER NEXT_PUBLIC_*) ------------------------
COINDCX_API_KEY=<from the CoinDCX API dashboard>
COINDCX_API_SECRET=<shown once at creation>
# Optional overrides
# COINDCX_BASE_URL=https://api.coindcx.com
# COINDCX_PUBLIC_BASE_URL=https://public.coindcx.com

# ---- safety flags ---------------------------------------------------------
LIVE_EXECUTION_ENABLED=false             # keep false until you deliberately go live
PAPER_TRADING_ENABLED=true
EXCHANGE_MARKET_ENABLED=true
```

Variables that are **ignored** by this build and can be deleted if present:
`TRADING_GATEWAY_URL`, `TRADING_GATEWAY_SECRET`, `DELTA_API_KEY`,
`DELTA_API_SECRET`. `DELTA_MARKET_ENABLED` is still read as a fallback for
`EXCHANGE_MARKET_ENABLED`.

A missing variable is never guessed at: `/api/system` and Settings →
*Exchange API · CoinDCX Futures* list the **names** that are missing.

## 3. Database schema

```bash
# 1. Make the live-order ledger exchange-neutral FIRST (rename, values kept)
psql "$DATABASE_URL" -f db/migrations/0001_exchange_neutral_live_orders.sql

# 2. Then create/align everything else
npm run db:push
```

Order matters: `drizzle-kit push` alone would drop `delta_order_id` and add new
columns, destroying the venue order ids of historical live orders. See
`docs/EXCHANGE_MIGRATION.md` §5.

## 4. Deploy

```bash
# Locally, once: verify the build
npm install
npm run lint && npm run typecheck
npm test                      # quant, exchange adapter, gateway, build, paper, boundary
npm run dev                   # http://localhost:3000

# Vercel
vercel link
vercel env add DATABASE_URL production   # …repeat for each variable
vercel --prod
```

Alternatively connect the Git repository and let Vercel build on push: the
project has no build-time secrets, and the standard `next build` command is
correct as-is (no `vercel.json` needed).

## 5. Serverless constraints this design respects

| Constraint | How the app complies |
|---|---|
| No long-running processes | All venue calls are plain request/response HTTPS. No websocket server, no worker thread |
| No local filesystem persistence | Order idempotency lives in Postgres (`live_orders`, unique `client_order_id`). `DATA_BACKEND=file` exists for local development only |
| No cross-request memory | The exchange client caches nothing but the immutable config; `/api/system` holds a 30 s market probe in module scope, which is a cache of a **public** probe, never account state |
| Function duration limits | Every venue call has a 12 s timeout (`CoinDcxClient.timeoutMs`), and reads retry at most twice with 250 ms/500 ms backoff — comfortably inside the default 10 s/15 s limits if you keep `maxDuration` default. If you raise retries, raise `maxDuration` too |
| Cold starts | No connection pool is opened at module load; `pg` connects lazily per request |
| Streaming market data | Not used. Charts and the paper engine poll REST; the venue's socket is documented as intentionally unused (`src/lib/exchange/coindcx/websocket.ts`) |

## 6. Post-deploy verification

1. **App is up** — `GET /api/health` → `{ ok: true, backend: "postgres" }`.
   - `backend: "file"` means `DATABASE_URL` did not reach the function.
2. **Auth is enforced** — an unauthenticated `GET /api/settings` → **401**;
   wrong password on `POST /api/auth/login` → **401**.
3. **Public market data** — `GET /api/system` → `exchangeMarket: "online"`,
   `exchange.configured` reflecting whether the key variables are set.
4. **Private read** — Settings → *CoinDCX Futures* as the data source, then
   `GET /api/exchange/summary` → `available: true` and a real balance. This is
   the only check that proves the key, the secret, the signature and the clock.
5. **Live is off** — `GET /api/orders` → `liveExecutionFlag: false`,
   `mode` not `live`, `liveArmed: false`. Also confirm
   `LIVE_EXECUTION_ENABLED` is not set to `true` in the Vercel dashboard.
6. **No secret in the browser** — open DevTools → Network → any `/_next/…js`
   chunk: it must contain no key or secret value. (The test suite asserts this
   automatically; do it once by hand after a config change too.)

## 7. Costs and free-tier honesty

- Vercel Hobby: free for personal use, no card.
- Neon/Supabase free tiers: free, no card, with idle-suspend. A suspended
  database makes the first request slower, not wrong.
- CoinDCX: no API fee; **trading fees and funding apply to real positions**.
- No static IPv4, no always-on service: **₹0/month of infrastructure** beyond
  what you already run.

## 8. Troubleshooting

| Symptom | Likely cause |
|---|---|
| `/api/health` shows `backend: "file"` in production | `DATABASE_URL` missing in that environment |
| Everything 503 with a storage message | Schema not applied (`db:push`), or the DB is unreachable |
| Login works, every page shows demo data | Data source is *Demo simulator*; switch to *CoinDCX Futures* in Settings |
| `exchangeMarket: "offline"` | Public endpoint unreachable from the function's region (rare) — the header shows `REST offline` |
| Private reads 502 with an auth message | Key/secret wrong or revoked, or the key is IP-bound to another address (§1 of COINDCX_SETUP) |
| `daily_pnl_unavailable` when placing a live order | Working as designed: the daily-loss limit cannot be enforced without a provable P&L figure |
| Order returns 409 with `ORDER_STATUS_UNKNOWN` | An earlier submission is unreconciled. Use `GET /api/orders/status?clientOrderId=…`; do not resubmit |
