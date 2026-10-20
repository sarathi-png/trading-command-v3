# TradingView webhooks (optional, disabled by default)

Endpoint: `POST /api/integrations/tradingview/webhook`

**Disabled unless** `TRADINGVIEW_WEBHOOK_ENABLED=true`. Even enabled, it **never places
orders** — it converts validated alerts into internal Signal rows for review.

## Pipeline

```
webhook → secret check (constant time) → timestamp freshness (±5 min)
        → payload validation + normalization → dedupe → insert Signal → audit log
```

## Enabling

```env
TRADINGVIEW_WEBHOOK_ENABLED=true
TRADINGVIEW_WEBHOOK_SECRET=a-long-random-string
```

Request requirements:

```json
{
  "symbol": "BTCUSD",
  "action": "LONG",          // LONG | SHORT | CLOSE | WATCH
  "timeframe": "15m",
  "price": 108000,
  "stop": 106500,            // optional
  "target": 111000,          // optional
  "strategy": "breakout",    // optional, defaults to "external"
  "timestamp": 1730000000000
}
```

Send the secret in the `x-webhook-secret` header (or `secret` field). Rate limit:
30 req/min. Rejected calls are audit-logged.

## Field rules

| Field | Rule |
|---|---|
| `symbol` | Required. A leading `EXCHANGE:` prefix is stripped (`BINANCE:BTCUSD` → `BTCUSD`). 2–30 chars of `A-Z 0-9 . _ -`. |
| `action` | Required. `LONG`, `SHORT`, `CLOSE` or `WATCH` (case-insensitive). |
| `price` | **Required and > 0** for every action, including `WATCH`. Numbers and numeric strings both work. A missing or unparseable price is rejected — it is never stored as `0`. |
| `entry` / `stop` / `target` | Optional, must be > 0 when present. `entry` defaults to `price`. |
| `timeframe` | Optional. Accepts the app labels (`15m`, `1H`, `1D`, …) or TradingView `{{interval}}` values: `1,3,5,15,30,60,120,240,D,W`. Defaults to `15m`. An unmappable value is rejected, never relabelled as another interval. |
| `timestamp` | Required, epoch ms or ISO date, within ±5 minutes of server time. |
| `strategy` | Optional. Sanitized to `[A-Za-z0-9._:-]`, max 64 chars. |
| `message` | Optional. Truncated to 500 chars and shown in the signal inbox. |

Typical alert template body:

```json
{
  "secret": "{{strategy.order.alert_message}}",
  "symbol": "{{ticker}}",
  "action": "LONG",
  "interval": "{{interval}}",
  "price": "{{close}}",
  "timestamp": "{{timenow}}",
  "strategy": "{{strategy.order.id}}"
}
```

`{{close}}` and `{{timenow}}` are quoted strings; both are accepted.

## Retries and duplicates

TradingView does not retry a rejected webhook, so a `400` means that alert is
lost. Fix the template rather than assuming a later delivery.

Repeated delivery of the same alert (same strategy, symbol, action and
timestamp) is deduplicated across every server instance: the signal id is
derived from those fields, so the retry hits the same primary key. The second
call returns `{ "ok": true, "deduplicated": true }` and creates no new row.

## Important

TradingView can only emit webhooks if your TradingView plan includes alert webhooks.
A Cloudflare Tunnel exposes *this* service — it cannot substitute for a TradingView
subscription. The dashboard does not depend on webhooks at all.
