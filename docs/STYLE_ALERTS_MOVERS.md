# Day/night styling, messaging alerts and market movers

Implemented 2026-10-15. This extends the existing workspace; it does not enable
execution or certify that a candidate is profitable.

## Day / night design

Inter and JetBrains Mono are retained. Cards now have softly elevated surfaces,
rounded headers and theme-specific depth. Controls have tactile press states and
clear keyboard focus, and the market-pulse header has a restrained reveal.
Light mode uses darker accent variants for readable text on white. The top bar's
sun/moon control changes the persisted theme without visiting Settings.

Both OS reduced-motion and Settings → Reduce motion suppress animation. We avoid
moving chart cards on hover (no jumping axes or layout shifts) and do not use
continuous decorative animation.

## Telegram / WhatsApp setup

Settings → **SIGNAL NOTIFICATIONS** is the control surface. Messaging is disabled
by default. Choose channels, normal/Heikin-Ashi signals and whether explicitly
labelled demo alerts are allowed. Provider secrets are **server environment
variables only**, never sent back in status APIs or saved in Git.

Telegram:

```env
TELEGRAM_BOT_TOKEN=<your bot token>
TELEGRAM_CHAT_ID=<your chat or group id>
```

Create a bot using Telegram's BotFather, send `/start` to the bot (or add it to the
intended group with the necessary permissions), and obtain that destination's
chat ID. Restart the server after setting the environment, enable messaging and
Telegram, then use **SEND CONNECTION TEST**. No Telegram account login/password
is needed by this application.

WhatsApp uses Meta's **Cloud API**, not personal-account browser automation:

```env
WHATSAPP_ACCESS_TOKEN=<server token>
WHATSAPP_PHONE_NUMBER_ID=<numeric sender phone-number id>
WHATSAPP_TO=<opted-in recipient including country code>
WHATSAPP_TEMPLATE_NAME=<approved template>
WHATSAPP_TEMPLATE_LANGUAGE=en_US
WHATSAPP_GRAPH_VERSION=v23.0
```

The approved template must have **one text variable in its body** and no other
required variables/components. Suggested body structure: `Your requested Trading
Command update: {{1}}`. Template approval and suitability are Meta's decision;
financial-content policies and provider charges may apply. A complete market
report may be shortened for the template limit, retaining the no-advice notice.
Use Telegram or the dashboard for the full ranked report.

Proactive WhatsApp messages require the appropriate approved template and
recipient consent; a normal personal WhatsApp account is not enough.
[2](https://respond.io/help/whatsapp/whatsapp-message-templates)

No real delivery has been verified in this sandbox: no provider credentials were
supplied, and the sandbox's outbound host restrictions do not include Telegram or
Meta. Deploy to an environment permitting `api.telegram.org` and
`graph.facebook.com` for actual sends. Transport tests use fake fetch responses.
“sent” in our history means **accepted by provider**, not delivered/read by a person.

## Signal generation and monitor

- Normal-chart alerts originate from the same `/api/strategy/evaluate` handler as
  the chart, **after** its confluence/meta gates. Both lower- and higher-timeframe
  evidence now exclude still-forming candles.
- Separate **5m Heikin-Ashi + Chandelier Exit + Donchian** alerts originate from the
  corresponding strategy handler. Smoothing is used for direction, while entry
  and stop geometry refer to real candle prices.
- Only LONG_SETUP / SHORT_SETUP generates an alert; WATCH / WAIT does not.
- Direct chart evaluations use the selected symbol/timeframe. The foreground
  monitor scans the **first 10 unique watchlist symbols**: normal **15m**, HA **5m**.
  It does not call an external AI model or spend AI-provider quota.
- A foreground poll runs approximately every 60 seconds while the authenticated
  dashboard is open. Minute throttling and an in-process mutex avoid overlapping
  scans. It is **not** an always-on browser-closed background service.

For browser-closed monitoring, configure an external scheduler to call:

```http
GET /api/notifications/scan
Authorization: Bearer <CRON_SECRET>
```

Set a strong `CRON_SECRET` on the server. The proxy grants that secret access
**only to this endpoint**; other APIs remain normally authenticated. Use an
appropriate server/worker duration for the number of symbols and provider
latency. There is no scheduler installed or running automatically by this change.
Serverless provider-duration limits may require a smaller watchlist or a dedicated
worker. Evaluate trading alerts yourself; no route here places an order.

## Outbox / reliability

`data/notification-settings.json` and `data/notification-outbox.json` are local,
gitignored state. A per-channel event ID hashes source, symbol, timeframe, chart,
strategy, direction and decision bar. Repeated refreshes and concurrent identical
events do not resend the same bar's setup. **A continuing setup on a new decision
bar is a new event**, so it can notify again; this is not direction-flip-only mode.

The outbox reserves a record *before* sending and refuses to send if reservation
cannot be persisted. Transport times out after 8 seconds per channel. A definite
HTTP rejection can retry on a later evaluation after 60 seconds, at most 3
attempts; ambiguous network/acknowledgement outcomes are marked `unknown` and
**not automatically retried**, to avoid duplicates after timeouts. A crash after
reservation may leave `sending`; inspect the provider before any manual action.
There is no promise of exactly-once delivery or automatic receipt reconciliation.

Cap: 100 new messages per channel in a rolling 24-hour period; retain the latest
500 outbox entries. This is an anti-spam cap, **not a paid-service billing limit**.
Status stores no response bodies or token-bearing URLs. A Telegram 200 response
must also contain `ok: true`; WhatsApp must return a message ID.

The mutex and file-store atomic write cover one Node process only. Persistent
storage (`TC_DATA_DIR` on a durable volume) is needed across restarts. Multi-instance
production needs a transactional shared outbox and worker; ephemeral serverless
files cannot provide durable cross-instance deduplication.

## Top movers and “buy / sell now” interpretation

Markets → **Market Pulse** ranks up to 10 strictly positive and 10 strictly negative
24h percentage changes in the **supported CoinDCX futures universe** on this build.
This is not a claim to cover all coins or exchanges. Missing 24h statistics,
invalid prices, stale (>2 minutes) ticker snapshots, zero volume and duplicate
symbols are excluded. Ties are alphabetical; lists are never padded.

Demo mode has only the demo instruments available (currently four), with visible
DEMO / SIMULATED labels, never a fabricated top-20 market. Live failures are shown
as failures, not silently substituted demo data. Last-good UI data on error is
explicitly labelled a previous snapshot, not a current recommendation.

Rank and assessment are **independent**. Each selected mover is assessed on
closed **5-minute** raw candles and a separate Heikin-Ashi view. A candidate needs:

1. At least 250 closed bars, with no stale terminal evidence;
2. The existing Chandelier / Donchian / HA rule engine's direction in both views;
3. ADX14 >=20 (trend strength);
4. The explicitly defined VWAP / RSI14 / EMA21 checklist in that direction;
5. A correctly sided invalidation level from the raw-price context.

Otherwise: **WAIT**, with reasons. A rising coin may qualify for a sell-side
candidate, and a falling coin may qualify for a buy-side candidate; 24h return is
not used to force the trade direction. “Sell-side” is futures-short context, not
an instruction to sell holdings you may or may not own. These are heuristic
conditions, not an empirically validated independent-vote model or financial
advice. They omit spread, funding, fees, liquidity execution and slippage checks.
No measured win rate or guaranteed profitability is presented.

The analysis endpoint caches for ~60 seconds and fetches candle histories with
at most 3 concurrent tasks. **SHARE SNAPSHOT** explicitly submits the ranked
assessment to enabled/configured messaging channels. It respects demo filters,
deduplication (one digest per 5m snapshot window) and caps. Scheduled scans notify
qualified strategy setups, not automatic repeated movers digests.

## Endpoints and tests

- `GET/POST /api/notifications`: masked status/preferences and connection test.
- `GET/POST /api/notifications/scan`: chart-handler watchlist monitor.
- `GET /api/market/movers`: ranking and evidence assessment, no notifications.
- `POST /api/market/movers`: explicit snapshot share.
- `npm run test:features`: ranking, long/short synthetic qualification, warmup,
  stale/missing-data exclusions, settings validation, deduplication, filters,
  network ambiguity, provider acknowledgement and WhatsApp template payload.

Tests demonstrate arithmetic/control-flow correctness, **not profitable trading**.

## Verification completed

- Full `npm test`: **287 passed, 0 failed**, including 19 new feature tests,
  8 auth tests and production build.
- Typecheck and lint clean.
- Clean production build verified to contain the new theme CSS (not stale cache).
- Browser: day/night toggle, market pulse, disabled/unconfigured snapshot-share
  notice, messaging settings and reduced-motion preference verified. No page
  errors; 390px phone and 834px tablet had no document overflow.
- Login remained usable with cookies stripped, sessionStorage blocked and a
  gateway-owned Authorization header (signed application session fallback).
- Authenticated API smoke: demo universe 4, 2 gainers and 2 losers at test time;
  monitor correctly skipped with notifications off. Unauthenticated monitor
  request returned 401. These counts are a test snapshot, not live coin advice.
- Real Telegram/WhatsApp delivery and real-market profitability remain unverified.
