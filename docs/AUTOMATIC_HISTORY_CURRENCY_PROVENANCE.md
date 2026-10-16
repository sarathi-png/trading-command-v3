# Automatic history, currency and provenance

## Requested changes

- Chart legend groups distinct concepts. Resistance/support are explained once; individual prices remain visible. Donchian upper/lower each have one explanation, with compact period/value pairs. Axis full-name toggle still works.
- Watchlists derive from the same 20-symbol routing universe as the dropdown, without add/remove controls. All rows are present; unsupported/unavailable quotes are not fabricated. Demo fixtures remain BTC, ETH, SOL and XRP only.
- Engine health and market provenance are separate. Strategy/Chandelier panels show actual response source; the status bar calls polling a stream, not proof of live prices. Switching data source clears cached quotes/overlays. Live read failures never fall back to demo.
- New Chandelier defaults: ATR length **1**, multiplier **2** across strategy, parser, AI and UI fallbacks. Existing saved settings are deliberately preserved. Indicator tab has **USE ATR 1 × 2 DEFAULTS** to apply these explicitly. ATR length input accepts 1–400.
- Journal entry/seeding/deletion are disabled at the API, not merely hidden. Only notes, emotion and personal tags can be edited. Source, prices, quantities, fees, P&L, strategy, generated reason and AI context cannot be changed by journal clients. Provenance tags cannot be forged or removed.

## Paper accounting and AI context

Opening orders and open positions remain in their separate paper ledger. Each partial/full close, bracket exit and manual position close records automatic history. Opening fees are allocated proportionally; final closure does not count prior partial profit again. Oversized flips charge closing fees only on closed quantity. Fees are visible independently of net P&L. Existing legacy position carry is normalised against previously recorded partial closes; historic financial rows are not rewritten. Stable close IDs prevent duplicate history insertion. Journal writes precede removal of closed positions.

Opening paper positions snapshot retained, compatible pre-entry predictions so closing later does not lose context when the 500-call AI memory rolls over. CoinDCX imports snapshot only retained compatible prior calls. Matching requires symbol, actual demo/live source, closed decision candle, prediction created before entry, and a bounded forecast horizon (at most 30 minutes). Rule-engine calls remain labelled as rules. Opposing calls are preserved as disagreement, not silently cherry-picked away. A temporal match is **prior context only**, never proof that AI executed or caused a profitable trade. Missing historical memory means no association.

Paper equity and paper risk statistics sum paper records only, never imported live estimates. Analytics defaults to paper performance. Journal gives separate paper net and live FIFO estimate totals.

## CoinDCX sync: what is and is not covered

`POST /api/journal/sync` is an authenticated read-only importer. It never submits orders, enables live execution or changes execution mode. The open dashboard rotates one symbol/margin stream every 15 seconds while visible. Optional external scheduling is required for collection with the browser closed:

```
POST /api/journal/sync
Authorization: Bearer <CRON_SECRET>
```

Use **one** worker/scheduler. In-process serialization is not a distributed lock. Durable storage and backups are required; local files on an ephemeral serverless deployment are not a permanent archive.

The current routing universe covers 20 supported symbols × USDT/INR margin accounts. Initial history starts 90 days back, unless `COINDCX_JOURNAL_FROM=YYYY-MM-DD` is configured **before the first sync**. It is not a promise of all lifetime exchange activity or instruments outside the routing map. Existing archives retain their original start boundary. Each stream keeps its dated page cursor, all retrieved fills and completion/error status in the repository. At most four pages of 100 fills are read per request; long histories resume on later rotations. A completed window gets a one-day-overlap incremental scan, not a first-page-only import. An empty successful response means no rows returned for that stream/window, not proof that every exchange account has no trades.

Native trade IDs are preferred for deduplication; an order ID is **not** a unique fill ID. Where CoinDCX omits a native fill ID, the fallback uses exact fill content plus occurrence counts, preserving identical-looking separate fills. This relies on stable pagination/order from the venue; pagination changes can still require reconciliation. Raw fills retain native fee currency and import-time FX rate. INR commissions convert to USD-equivalent once, at import; manual FX is an approximation, not historic booked FX.

Closed rows are FIFO reconstructions from retained fills. They assume flat inventory at the history boundary; positions opened earlier are unknown. Funding, liquidation and other ledger adjustments are not included. **FIFO estimates are not CoinDCX-booked realized P&L.** The exchange account panel separately reads venue position transactions where available. Initial/pending/failed syncs display their gaps and never generate sample profits. Annotation-preserving deterministic upserts allow repeated imports without duplicate round trips.

The screen shows recent 800 automatic closed rows and up to 80 latest activity items per stream. Exports fetch retained history beyond the screen limit (current API safety ceiling one million rows). P&L export contains canonical USD-equivalent facts, display-currency values, explicit manual FX rate, estimate/simulation basis, and prior prediction IDs/providers/models/chart types/directions. Activity export includes actual retrieved opening/closing fills and the separate paper-order ledger. CSV cells are quoted/escaped and string formula prefixes neutralised. Copy-summary shares separate totals and caveats, never credentials. Legacy manual/sample rows stay in storage but are excluded from automatic performance.

## INR display

A browser-only preference drives monetary formatters and subscribes leaf components to changes. Server formatting/calculation stays USD; preference cannot leak between server users. Monetary totals, compact notionals, prices, chart axes/crosshair/OHLC, indicators, position/P&L rows, fees and risk values convert. Order/risk/alert input values display INR but retain raw USD for submission. Coin quantity, percentages, confidence, ratios and oscillator values do not convert. Already-INR account figures use native INR formatting, not a second conversion.

Settings labels the rate **manual**, not a live FX feed. USDT quote prices are treated as USD-equivalent, not a guaranteed USD peg. Invalid/nonfinite/nonpositive rates are rejected. CSV retains raw numeric values and explicit currency/rate columns for auditability. Unstructured historic notes/model prose are preserved, rather than applying unsafe numeric replacements to quantities/ratios inside text.

## Telegram and WhatsApp

Telegram: Settings accepts a bot token and numeric chat ID with explicit conversation consent. Tokens are submitted only to the authenticated server; never returned, persisted in browser storage or placed in URLs. UI storage requires a stable `SESSION_SECRET` of 32+ characters and private durable storage. AES-256-GCM ciphertext lives in `notification-secrets.json`, deliberately excluded from the HF document mirror. Environment Telegram settings take precedence. Rotating SESSION_SECRET makes stored credentials unreadable until re-entered. Saving does not automatically enable messaging or verify a provider send; start the bot conversation and run a connection test.

WhatsApp: `WHATSAPP_SENDER_NUMBER` (real international business sender, not the opaque API phone ID) enables a locally generated, real QR for its `wa.me` opt-in chat. No configured sender means **no QR**, not a demo pairing graphic. Scanning opens a conversation; sending the opt-in message does not pair a personal account, register WHATSAPP_TO automatically, or replace Cloud API configuration. The operator must verify the configured recipient's consent and enable the consent checkbox; dispatch refuses WhatsApp without it. Cloud API token, phone-number ID, recipient, approved one-text-variable template and enabled channel remain required. Provider charges may apply. Personal WhatsApp Web QR linking is not implemented.

Real CoinDCX/Telegram/Meta requests cannot be verified from this sandbox's restricted outbound network. Signed mock venue tests validate the import boundary and order isolation, not external account acceptance or message delivery.

## Verification

Clean full suite: **321 tests passed, zero failed** (features 52, auth 8, quant 28, quant v2 31, AI 83, exchange 39, gateway 78, paper API 1, signed live-boundary API 1). Typecheck and lint pass. New coverage includes currency/server isolation, immutable annotations, CSV safety, FIFO fees/partial/flip handling, pre-entry source-safe prediction matching, encrypted Telegram storage, WhatsApp consent/QR target and default ATR behavior. API tests exercise automatic paper partial/final close accounting, missing-credentials honesty, deduplicated signed CoinDCX imports and preservation of annotations. Browser smoke verifies INR display, legend grouping, automatic all-symbol watchlist, absence of manual journal controls, honest demo badges, Telegram configuration, no fake QR, no page errors and phone/tablet overflow.

### Additional final regression checks

Signed mock pagination exercised a four-page stop/resume: **403 retained native fills → 401 distinct FIFO close slices**, with no premature closure records, no duplicate IDs and no order submissions. Unchanged reconstructed facts are skipped on later rotations, avoiding repeated metadata writes for the whole lifetime archive. Import reads use 5-second timeout/no automatic retry to bound one batch. Browser checks also covered both themes, 390/834px charts, decimal `0.030` and negative `-88.00` input drafts, and intercepted a ticket submission to prove **₹8,800 → USD 100** with unchanged base quantity (no preview trade was submitted). AI cache settings/labels and normal-vs-Heikin-Ashi overlays now follow the actual selected indicator context rather than reusing an old ATR configuration on the same bar.
