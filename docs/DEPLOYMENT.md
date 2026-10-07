# Deployment

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
schema is also required for settings and credential persistence.

## Production build

```bash
npm run build
npm start
```

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
contact Delta or enable live execution.

## Checklist

- [ ] `LIVE_EXECUTION_ENABLED=false` until you truly need it
- [ ] Delta API key IP-whitelisted
- [ ] HTTPS enforced
- [ ] Postgres not publicly reachable
- [ ] `.env` excluded from git and backups encrypted
