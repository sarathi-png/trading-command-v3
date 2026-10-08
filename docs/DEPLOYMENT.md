# Deployment

> **Deployment today is Vercel-only.** The canonical guide is
> **`docs/VERCEL_DEPLOYMENT.md`**: Vercel + a hosted Postgres + a CoinDCX API
> key. No static IP, no gateway, no VPS. The sections below that describe the
> gateway or Cloudflare Tunnel remain useful for a Delta-era set-up or for
> self-hosting behind a tunnel, but they are not part of the current path.


## Local development (Windows / macOS / Linux)

```bash
npm install
npm run db:push
npm run dev
```

PostgreSQL must be running. The Drizzle config reads `DATABASE_URL` from `.env`
or the process environment.

## Vercel with Neon

Set the Vercel **Root Directory** to `trading-command-v3`. Add the Neon pooled
connection string as `DATABASE_URL` in the Vercel project's Environment Variables.
After changing the database or deploying this dashboard for the first time, apply
the schema from this directory using the Neon **direct** connection string:

```powershell
cd trading-command-v3
$env:DATABASE_URL = "<Neon direct connection string>"
npm run db:push
Remove-Item Env:DATABASE_URL
```

Keep the connection string private; do not paste it into the dashboard or commit
it. A successful `/api/health` response should report `"ok": true` and
`"backend": "postgres"`. Health only checks database connectivity; applying the
schema is also required for settings and live-order idempotency records.

## The trading gateway (RETIRED — kept only for Delta-era setups)

This application no longer calls the gateway: CoinDCX does not require an
IP-bound key, so the serverless functions sign their own requests. The section
below is retained for anyone still running a Delta-era deployment. Public market
data does not need it. Deploy it separately and point the deployment at it:

```bash
cd trading-gateway && npm install && npm run build && npm start
```

```env
TRADING_GATEWAY_URL=https://gateway.example.com
TRADING_GATEWAY_SECRET=<same value as the gateway's TRADING_GATEWAY_SECRET>
```

Full runbook, including the static-IP/allowlist steps:
`docs/TRADING_GATEWAY_DEPLOYMENT.md`.

## Production build

```bash
npm run build
npm start
```

`next build` fetches the Inter and JetBrains Mono stylesheets from Google Fonts.
On a machine without outbound access to `fonts.googleapis.com` the build fails
with `Can't resolve '@vercel/turbopack-next/internal/font/google/font'`. For
offline/CI builds run the bundled helper in one terminal and build in another:

```bash
node scripts/offline-font-mock.mjs
NEXT_FONT_GOOGLE_MOCKED_RESPONSES=/tmp/font-mock/mock.json npm run build
```

Vercel and any normally-connected host need nothing extra.

Node ≥ 20. The app binds to port 3000 by default (`PORT` env to change).

## Docker

```bash
docker compose up -d
```

Services: `web` (this app) + `postgres`. Redis is intentionally not required for MVP —
the server uses short-TTL in-memory caches. Add Redis later only if you scale the
WebSocket fan-out or add job queues.

## Cloudflare Tunnel (optional remote access)

1. `cloudflared tunnel create trading-command`
2. Route DNS: `cloudflared tunnel route dns trading-command dashboard.example.com`
3. Config:

```yaml
tunnel: <TUNNEL_ID>
ingress:
  - hostname: dashboard.example.com
    service: http://localhost:3000
  - service: http_status:404
```

4. `cloudflared tunnel run trading-command`

The tunnel exposes **your** dashboard over HTTPS. It does not (and cannot) provide
TradingView webhook capability — that depends on TradingView itself. Never expose the
database port through the tunnel.

## Automated checks

Run `npm test` from the project root. It compiles and runs the quant tests, builds
the production app, and exercises login plus the paper-order/journal flow against
an isolated local file store. The smoke test uses demo prices and does not
contact the exchange or enable live execution.

## Checklist

- [ ] `LIVE_EXECUTION_ENABLED=false` until you truly need it
- [ ] CoinDCX API key created WITHOUT IP binding (Vercel has no fixed egress IP)
- [ ] HTTPS enforced
- [ ] Postgres not publicly reachable
- [ ] `.env` excluded from git and backups encrypted
