# Deployment scope and honest capability map

This deployment is intentionally **Vercel + Neon PostgreSQL only**. It does not
run Python, Docker, a VPS, or a second host.

## What runs here

| Capability | Status | Notes |
|---|---|---|
| Next.js app (React UI + API routes) | Runs on Vercel | Node runtime only |
| PostgreSQL persistence | Neon | Set `DATABASE_URL`; production refuses the JSON file backend |
| CoinDCX market data + guarded live orders | Existing, preserved | Live execution stays off unless `LIVE_EXECUTION_ENABLED=true`, `mode=live`, `liveArmed=true` and credentials exist |
| Paper trading | Default | Idempotent per `client_order_id`; no venue calls |
| Backtest engine | In-process TypeScript | Bar-driven; not NautilusTrader |
| Macro research (FRED) | Optional | Requires `FRED_API_KEY`; otherwise the UI shows an explicit unavailable state |
| News | Not configured | No provider is wired; headlines are never generated |
| OpenTerminal UI patterns | Reused | MIT-licensed patterns, same stack; not the OpenTerminal codebase |
| OpenBB SDK | **Not running** | Python package; the TypeScript boundary follows its provider abstractions only |
| NautilusTrader | **Not running** | Rust/Python engine; this repo keeps a compatible bar-driven design only |

## Required env

- `DATABASE_URL` — Neon connection string (required in production).
- `API_PASSWORD`, `SESSION_SECRET` — authentication.
- `DATA_BACKEND=postgres` is optional but recommended in production; the runtime
  auto-detects Postgres and fails closed if only the file backend is available
  on Vercel.
- `LIVE_EXECUTION_ENABLED=false` (default) keeps order submission disabled.
- `FRED_API_KEY` — optional, only for the research panel.

## Database migration order

`drizzle-kit push` has no migrations table, so additive SQL must run first:

```bash
psql "$DATABASE_URL" -f db/migrations/0001_exchange_neutral_live_orders.sql
psql "$DATABASE_URL" -f db/migrations/0002_paper_order_idempotency.sql
npm run db:push
```

`0002` adds `paper_orders.client_order_id` and a partial unique index. It is
idempotent and leaves existing rows untouched (`NULL` keys remain valid).

## File backend

The JSON file backend exists for local development only. On Vercel it is
refused at startup because each instance has an ephemeral disk: settings and
orders would silently disappear, and per-process locks cannot enforce
uniqueness. Emergency override `ALLOW_FILE_BACKEND_ON_VERCEL=1` is deliberately
unsafe and must not be used with real money.

## Timeframes

CoinDCX publishes 1m, 5m, 15m, 1H, 4H and 1D candles. The UI offers only those
six. Requests for 3m/30m/2H/1W return an explicit `422`; they are never served a
1H candle labelled as another interval.
