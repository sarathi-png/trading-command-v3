# Trading Gateway deployment (static-IP Delta access)

> **NOT REQUIRED BY THIS APPLICATION.** The static-IP trading gateway existed
> only because Delta Exchange India requires an allowlisted IP for trading keys.
> CoinDCX does not, so the application signs its own requests and never calls
> this service (the end-to-end test asserts it receives zero requests). The
> service remains in `trading-gateway/` as a standalone, self-contained
> deployment for a Delta-era setup, and this document is kept for that case.
> Deploying Trading Command on Vercel needs **no gateway**: see
> **`docs/VERCEL_DEPLOYMENT.md`**.


This is the runbook for the split architecture:

```
Browser → Vercel (Next.js app, UI, database, paper trading, public market data)
             │  HTTPS + Bearer TRADING_GATEWAY_SECRET (server-side only)
             ▼
       Static-IP Trading Gateway (holds DELTA_API_KEY / DELTA_API_SECRET)
             │  fixed outbound IPv4 (this is what Delta allowlists)
             ▼
       Delta Exchange India (api.india.delta.exchange)
```

**Why:** Delta Exchange India requires signed requests to come from an
allowlisted IP. Vercel serverless functions egress from a shared, rotating pool
of addresses with no dedicated outbound IP, so they cannot be allowlisted. The
gateway runs on a host with one static IPv4, so Delta only ever sees that
address.

Everything below is written so it can be followed top to bottom. Replace
`gateway.example.com` and the IPs with your own values; never paste real
credentials into a document, a ticket or this repository.

---

## Part 1 — Deploy the Vercel application

1. **Deploy the Next.js project**

   ```bash
   npm i -g vercel
   vercel link          # select the project
   vercel deploy --prod --yes
   ```

   (Or push to the branch Vercel builds from.) The application is a standard
   Next.js app; nothing about it is gateway-specific.

2. **Configure PostgreSQL**

   - Vercel dashboard → **Storage** → create a PostgreSQL database (or use Neon).
   - Copy the connection string and add it as `DATABASE_URL` (type: secret).
   - Apply the schema once from your machine:

     ```bash
     DATABASE_URL="<paste>" npx drizzle-kit push
     ```

     Tables created: `settings`, `trade_journal`, `paper_orders`,
     `paper_positions`, `live_orders`, `alert_rules`, `signals`, `drawings`,
     `audit_log`.

3. **Configure the normal application variables**

   | Variable | Required | Purpose |
   |---|---|---|
   | `DATABASE_URL` | yes | persistent settings, journal, paper state, live-order ledger |
   | `API_PASSWORD` | yes | operator login; routes fail closed (503) when unset |
   | `SESSION_SECRET` | yes | signs the session cookie (use a different value) |
   | `DELTA_MARKET_ENABLED` | yes | public tickers/candles (no credentials) |
   | `PAPER_TRADING_ENABLED` | yes | paper engine |
   | `LIVE_EXECUTION_ENABLED` | yes | must be `false` until live trading is intended |

   **Do not set `DELTA_API_KEY` / `DELTA_API_SECRET` on Vercel.** They are not
   read there any more, and a secret that exists in two places is a secret with
   two ways to leak.

4. **Configure the gateway connection**

   | Variable | Value |
   |---|---|
   | `TRADING_GATEWAY_URL` | `https://gateway.example.com` (no trailing slash) |
   | `TRADING_GATEWAY_SECRET` | the same long random value as the gateway's `TRADING_GATEWAY_SECRET` |

   Generate the secret with `openssl rand -hex 32`. Never prefix either
   variable with `NEXT_PUBLIC_` — that would ship it to the browser.

5. **Redeploy** so the new variables take effect, then check
   `GET /api/system` → `gateway.configured: true`, `gateway.reachable: true`.

---

## Part 2 — Deploy the gateway on a static-IP host

Requirements: a VPS or cloud instance in a region close to you with a
**dedicated public IPv4** (DigitalOcean droplet, Hetzner Cloud, Linode, AWS
EC2 with an Elastic IP, GCP with a static IP, Azure with a static public IP…).
Do **not** use Vercel functions, Cloudflare Workers, or anything else that
shares or rotates its egress address.

Recommended: 1 vCPU / 1 GB RAM / 10 GB disk. Node.js ≥ 20 (22 recommended).

### Option A — Docker (recommended)

```bash
# on the server
git clone <your repo> trading-command-v3
cd trading-command-v3/trading-gateway

cp .env.example .env
# edit .env: TRADING_GATEWAY_SECRET, DELTA_API_KEY, DELTA_API_SECRET
chmod 600 .env

docker build -t trading-gateway:1.0.0 .
docker run -d --name trading-gateway \
  --restart unless-stopped \
  --env-file .env \
  -p 127.0.0.1:8787:8787 \
  -v /var/lib/trading-gateway:/data \
  trading-gateway:1.0.0
```

The port is published on **127.0.0.1 only**: the only thing that should reach
it is the reverse proxy on the same host (see HTTPS below).

### Option B — plain Node.js + systemd

```bash
# Node 22 LTS (NodeSource)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

sudo useradd --system --create-home --home-dir /opt/trading-gateway gateway
sudo -u gateway git clone <your repo> /opt/trading-gateway/app
cd /opt/trading-gateway/app/trading-gateway

sudo -u gateway cp .env.example .env
sudo -u gateway chmod 600 .env
sudo -u gateway nano .env          # set the three secrets
sudo -u gateway npm ci --omit=dev --include=dev
sudo -u gateway npm run build
```

`/etc/systemd/system/trading-gateway.service`:

```ini
[Unit]
Description=Trading Command static-IP gateway
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=gateway
WorkingDirectory=/opt/trading-gateway/app/trading-gateway
EnvironmentFile=/opt/trading-gateway/app/trading-gateway/.env
ExecStart=/usr/bin/node dist/server.js
Restart=always
RestartSec=3
# Hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/trading-gateway/data
StateDirectory=trading-gateway

[Install]
WantedBy=multi-user.target
```

Set `IDEMPOTENCY_STORE=/opt/trading-gateway/data/order-ledger.jsonl` in `.env`
(the journal must survive restarts) and:

```bash
sudo mkdir -p /opt/trading-gateway/data && sudo chown gateway:gateway /opt/trading-gateway/data
sudo systemctl daemon-reload
sudo systemctl enable --now trading-gateway
sudo systemctl status trading-gateway
sudo journalctl -u trading-gateway -f          # structured logs, one JSON per line
```

### HTTPS in front of the gateway

The gateway speaks plain HTTP and expects a TLS-terminating reverse proxy on
the same host. Caddy is the shortest path (automatic certificates):

```caddyfile
# /etc/caddy/Caddyfile
gateway.example.com {
    reverse_proxy 127.0.0.1:8787
}
```

```bash
sudo systemctl restart caddy
curl https://gateway.example.com/health
```

nginx equivalent: `proxy_pass http://127.0.0.1:8787;` with
`proxy_set_header X-Forwarded-For $remote_addr;`, `proxy_set_header Host $host;`
and `client_max_body_size 64k;`. If you want the gateway to rate limit per
client address, also set `TRUST_PROXY=true` in the gateway's `.env`.

### Firewall

```bash
sudo ufw default deny incoming
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp        # HTTP (only needed for the ACME challenge)
sudo ufw allow 443/tcp       # HTTPS
sudo ufw deny 8787/tcp       # the gateway itself stays private
sudo ufw enable
```

8787 must never be reachable from the internet: it is protected by the shared
secret, but defence in depth is free here.

### Health check and restart policy

- `GET /health` → liveness (no auth, no configuration detail). Use it for the
  load-balancer/monitoring probe.
- `GET /ready` → 200 when configuration is complete, 503 otherwise. Send the
  shared secret with the request to also learn *which* variables are missing
  (names only, never values).
- Docker: `HEALTHCHECK` is baked into the image; `--restart unless-stopped`.
- systemd: `Restart=always`, `RestartSec=3`.

---

## Part 3 — Find the gateway's public IPv4 (this is the IP Delta allowlists)

```bash
# On the gateway host, ask the outside world what address it sees:
curl -4 https://ifconfig.me
curl -4 https://api.ipify.org
curl -4 https://ipv4.icanhazip.com
```

All three must print **the same** address, and it must match the static IP you
reserved with your provider (Elastic IP, floating IP, reserved public IP…).

> **The address printed here is the IP that must be allowlisted in Delta
> Exchange.**

Notes:

- Check IPv4 specifically (`-4`). Delta allowlists IPv4 addresses, and a host
  that prefers IPv6 may not be reachable from Delta's allowlist.
- Confirm from the gateway process, not just your laptop's shell, if the host
  has multiple interfaces: `curl -4 --interface eth0 https://ifconfig.me`.
- If the address changes on reboot, you do not have a static IP — attach a
  reserved/elastic IP before allowlisting.

---

## Part 4 — Delta Exchange India API key

1. Sign in to Delta Exchange India → **Profile → API Management → Create API
   key**.
2. Permissions: enable **Read Data**. Add **Trading** only when you actually
   intend live execution — and remember live orders are still blocked by the
   daily-P&L gate (see Part 5).
3. **IP allowlist:** add the gateway's IPv4 from Part 3. Add nothing else — in
   particular, do not try to add Vercel (its egress addresses rotate and are not
   yours).
4. Copy the key and secret **once** (the secret is not shown again) and put them
   in the gateway's `.env`:

   ```env
   DELTA_API_KEY=<key>
   DELTA_API_SECRET=<secret>
   DELTA_BASE_URL=https://api.india.delta.exchange
   ```

5. Restart the gateway (`sudo systemctl restart trading-gateway` or
   `docker restart trading-gateway`) and confirm `GET /ready` returns 200.
6. Never commit `.env`. Never put these values in Vercel, in a `NEXT_PUBLIC_`
   variable, in the database, or in a chat/ticket/PR description.

---

## Part 5 — Verification

Run these in order; each one isolates a different hop.

### 1. Vercel → gateway

```bash
# On the gateway host (or from anywhere with the secret):
curl -s -H "Authorization: Bearer $TRADING_GATEWAY_SECRET" \
     https://gateway.example.com/api/account/balance
```

Expect `{"success":true,"result":[{"asset_symbol":"USD",...}]}`.

Then from the application side: sign in to the dashboard and open **Settings →
Delta API · Trading Gateway**. The badge should read `GATEWAY CONFIGURED` and
`GET /api/system` should report `gateway.reachable: true`.

Unauthenticated and wrong-secret requests must fail:

```bash
curl -s -i https://gateway.example.com/api/account/balance | head -1   # 401
curl -s -i -H "Authorization: Bearer wrong" https://gateway.example.com/api/account/balance | head -1   # 401
```

### 2. Gateway → Delta

```bash
curl -s -H "Authorization: Bearer $TRADING_GATEWAY_SECRET" \
     https://gateway.example.com/api/account/orders
```

A `401`/`403` from Delta inside the envelope means the signature, key or
allowlist is wrong — the gateway's log line carries Delta's error code
(`expired_signature`, `invalid_signature`, …).

### 3. Gateway outbound IP

```bash
# Compare with Part 3 — they must match:
ssh root@gateway-host 'curl -4 -s https://ifconfig.me; echo'
```

If they differ, the gateway is egressing through NAT with a different address;
Delta will reject every signed request. Fix the routing/EIP first.

### 4. Delta authentication and account data

```bash
SECRET=$TRADING_GATEWAY_SECRET
curl -s -H "Authorization: Bearer $SECRET" https://gateway.example.com/api/account/balance
curl -s -H "Authorization: Bearer $SECRET" "https://gateway.example.com/api/account/positions?underlying_asset_symbol=BTC"
curl -s -H "Authorization: Bearer $SECRET" https://gateway.example.com/api/account/orders
```

In the dashboard: **Positions** and the account panel (with Settings →
data source set to Delta) should show live figures, and
`GET /api/delta/summary` should return `available: true`.

### 5. Paper trading

Paper must work with the gateway switched off, and must never call Delta:

```bash
docker stop trading-gateway      # or: sudo systemctl stop trading-gateway
# In the dashboard: set mode PAPER, place an order from the order ticket.
# It fills against the paper engine; balances/positions move; journal records it.
```

Automated equivalent (no network, no credentials):

```bash
npm --prefix trading-gateway test     # 76 unit + integration tests
node --test tests/paper-api.test.mjs  # paper end-to-end, gateway absent
```

### 6. Live order safety

Live order submission is **blocked by design** today:

- `LIVE_EXECUTION_ENABLED=false` on Vercel → `POST /api/orders` returns 403
  before anything else happens.
- Even with the flag on and LIVE mode armed, `liveRealizedPnlToday()` returns
  `null` → the risk layer refuses with `daily_pnl_unavailable`.
- Even if that were bypassed, the gateway requires
  `LIVE_EXECUTION_ENABLED=true` **on the gateway**, and its own copy of the risk
  guard refuses on the same unknown-daily-P&L rule.

Verify the first two:

```bash
node --test tests/live-gateway.test.mjs
```

The last one (a real, minimal order on a funded account in a controlled window)
should only be attempted after implementing the daily-P&L gate in
`trading-gateway/src/risk/dailyPnl.ts`, and only with a limit order and a size
you can afford to lose.

---

## Operating notes

- **Logs** are one JSON object per line: `ts`, `level`, `event`, `requestId`,
  and for orders `clientOrderId`, `symbol`, `side`, `size`, `latencyMs`,
  `success`. Secrets, authorization headers, signatures and raw account data are
  never logged (the logger scrubs the configured secret values as a second
  layer).
- **Correlation**: the application sends `X-Request-Id`; the same id appears in
  the gateway's log lines for that request.
- **Restarts**: the idempotency journal is loaded on boot, so a restart cannot
  cause a duplicate order. Keep the journal volume persistent.
- **Rotating the gateway secret**: change it on the gateway, then on Vercel, in
  that order, and redeploy the app. Requests made in between fail with 401 —
  that is the intended behaviour, not an outage.
- **Rotating the Delta key**: create the new key at Delta (same IP allowlist),
  update `.env`, restart the gateway, verify Part 5 step 2, then revoke the old
  key.
- **Time**: signatures expire in about 5 seconds, so the host clock must be
  accurate — enable `systemd-timesyncd`/`chrony`.
