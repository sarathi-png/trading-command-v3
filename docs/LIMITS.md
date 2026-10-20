# Limits and honest capability map

This page states what the deployment does **not** do. It is deliberately
narrower than a feature list: the system must never imply a capability it does
not have.

## Hosting

- Vercel serverless (Node runtime) + Neon PostgreSQL only.
- No Python process, Docker daemon, VPS, gateway hop, or second host runs in
  this deployment. The retired gateway lives in `trading-gateway/` for history
  only.
- Production refuses the JSON file backend (`VERCEL=1` + `DATA_BACKEND=file`
  fails closed). The file backend is for local development/tests.
- Order routes declare `maxDuration = 10`; outbound private exchange calls use an
  8 s timeout. A mutation whose outcome is unknown is reported as pending or
  failed, never retried and never shown as success.

## Trading

- Paper trading is the default. Live submission requires
  `LIVE_EXECUTION_ENABLED=true`, `mode=live`, `liveArmed=true`, and credentials.
- Live P&L in the journal is a FIFO reconstruction from imported fills, **not**
  venue-booked P&L. Funding payments and liquidations are not included.
- Paper fills are simulated. They are idempotent per `client_order_id`, and the
  fill ledger is append-only, but the journal/position/ledger writes are not one
  SQL transaction: a crash between them can leave recoverable partial state.
- No deployment in this repository is authorised for production by default
  (`allow_production_deploy=false`).

## Market data

- CoinDCX publishes only `1m`, `5m`, `15m`, `1H`, `4H`, and `1D` candles. Other
  app timeframes return an explicit `422`; they are never filled with the wrong
  resolution.
- Every market response carries `provider`, `asOf`, and `stale`. A quote older
  than its freshness window is labelled stale; the UI must not style it as live.
- Demo data is deterministic simulation and is labelled as demo. It is not a
  market snapshot.
- Order book and recent trades are venue reads, not an execution guarantee.

## Research

- FRED macro series require `FRED_API_KEY`; without it the panel shows an
  explicit unavailable state with a reason.
- No news provider is wired. The panel says news is unavailable; headlines are
  never generated or inferred.
- Values are shown with source and observation date. A missing observation is
  `N/A`, never zero.

## Backtest

- The engine is a TypeScript bar-driven reimplementation. It is not
  NautilusTrader, and the UI must not call it NautilusTrader.
- Fills occur at the next bar open with adverse slippage; fees are charged on
  both legs. When a bar touches both stop and target, the stop is assumed first
  (conservative bias).
- Equity is marked per simulated bar. Walk-forward windows are independent; no
  compounded curve is implied.
- Deflated Sharpe is not computed because the trial count/higher moments are not
  available. A warning is emitted for small samples and end-of-data closes.

## Indicators

- One shared module (`src/lib/indicators.ts`) serves the strategy, AI evidence,
  chart overlays, and quant features.
- EMA follows the quant reference (`ewm(adjust=False)`, first-close seed) and is
  `null` during warmup. RSI/ATR use Wilder smoothing. A flat RSI window is 50.
- Do not mix in a TA-Lib SMA-seeded EMA without re-running the quant goldens.

## Security and operations

- The baseline CSP allows inline scripts/styles because Next's hydration
  bootstrap needs them; it is not a nonce-based CSP.
- Secrets stay server-side. `/api/settings` redacts webhook/TradingView secrets;
  `/api/system` reports variable names, never values.
- Neon credentials pasted into chat or logs must be rotated, not reused.
