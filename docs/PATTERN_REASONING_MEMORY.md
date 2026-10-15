# Candle recognition, reasoning checks and recorded memory

Implemented 2026-10-15 from the six user-supplied reference images. This is a
rule-based evidence layer, **not human cognition, image-trained AI, or a profitable
strategy certification**. It feeds both chart prediction panels, including the
no-key fallback, without enabling execution.

## Implementation plan and status

- [x] Review pattern/context and indicator definitions against public references.
- [x] Implement versioned OHLCV geometry for the 30-pattern reference sheet.
- [x] Calculate EMA, UTC-session VWAP, Wilder RSI/ADX, MACD and Bollinger Bands.
- [x] Translate the two strategy posters into explicit causal checklists.
- [x] Persist the evidence with each prediction and retrieve comparable outcomes.
- [x] Show patterns, indicator values, failed/missing checks and memory per chart.
- [x] Add deterministic geometry, indicator, no-look-ahead and memory tests.

This addition does not finish the separate roadmap's portfolio-risk, replay,
validation, promotion-gate or permanent decision-archive projects.

## What "thinking" and "memory" mean here

`src/lib/ai/technical.ts` computes a reproducible snapshot. The rules measure body
size, shadows, containment, gaps and **trend before the pattern starts**. The model
receives those measured facts, not a promise that a picture will recur.
`technicalConflicts` can veto a proposed direction into NEUTRAL when a contextual
opposing pattern or an opposing complete strategy checklist exists. This is a
conservative heuristic, **not a statistically validated improvement**. Confirmation
never adds a certainty bonus. Correlated EMA/MACD/price checks aren't independent
votes. No missing indicator is silently marked as passing.

`memory.ts` retrieves completed directional calls from the existing prediction
ledger. A match requires the same symbol, timeframe, chart type, demo/live source,
technical-rule version and at least one shared directional pattern. We only use
outcomes whose full horizon elapsed **before** the current decision bar, and skip
duplicate/overlapping horizons. Counts describe *model calls sharing a pattern*,
not the success rate of the pattern itself. Neutral calls and legacy rows with
unknown source are excluded. Fewer than 20 examples is explicitly insufficient;
even more examples do not establish causality or increase confidence. Example
record IDs are displayed for audit. No weights are trained or self-modified.

Memory retains the **last 500 calls**, not unlimited history. Evidence includes
last-five raw OHLCV candles, detected patterns, indicator values, checklist
results, rule version, memory summary and source. Every prediction already has
symbol/timeframe, decision timestamp, entry/invalidation, model and later outcome.
Both panes use raw candle geometry: smoothed Heikin-Ashi bodies cannot establish
raw candlestick patterns or tradable execution prices.

## Pattern catalogue and explicit conventions

Supported: Doji; Hammer; Inverted Hammer; Shooting Star; Hanging Man; Bullish and
Bearish Engulfing; Morning and Evening Star; Three White Soldiers; Three Black
Crows; Piercing Line; Dark Cloud Cover; Tweezer Top/Bottom; Bullish/Bearish Harami;
Three Inside Up/Down; Three Outside Up/Down; Rising/Falling Three Methods;
Bullish/Bearish Marubozu; Spinning Top; Dragonfly/Gravestone Doji; Three Star
Bullish/Bearish (tri-star).

These are **our documented operational thresholds**, not universal definitions:

- Prior trend: last minus first close of five pre-pattern bars must exceed half
  their average high-low range, with the required sign. Reversals require the
  opposite preceding trend; continuation patterns require the same trend.
- Doji: body <=10% of nonzero range. Long body: >=60% of range.
- Hammer family: body >10% of range, long shadow >=2 bodies, opposite shadow
  <=0.5 body. Position in prior trend distinguishes hammer from hanging man,
  inverted hammer from shooting star. Candle colour is not required here.
- Marubozu: >=90% body. Spinning top: 10–30% body with both shadows >1 body.
- Engulfing covers the prior non-doji **body**, not necessarily its shadows.
  Harami uses strict body containment in a long prior body.
- Tweezers: extrema within 5% of the two candles' average range. This alone does
  not establish support/resistance.
- Piercing/dark-cloud use gaps beyond the prior low/high and a midpoint recovery
  without complete engulfing. Morning/evening stars require a small gapped body.
  Tri-stars require three doji with the middle body gapped beyond both neighbours.
  Strict gap versions may rarely appear in continuously traded crypto; they are
  not relaxed until the chart happens to match a poster.
- Three-inside/outside require the third confirming close. Soldiers/crows require
  long bodies, small closing shadows, rising/falling closes and opens inside the
  preceding bodies. Three-methods requires three small opposite-colour bars
  inside the first range, then a strong closing breakout of that range.

Only terminal patterns are reported: a past pattern is not recycled as a current
signal. A no-match result is normal. Reversal candidates without an actual
subsequent confirming bar are not described as confirmed reversals.

## Indicators and poster-to-script interpretations

- EMA 9/21/50/200: SMA seed, then alpha=2/(period+1); warmup is null. 50/200
  are trend context, **not automatically a stop loss**.
- RSI 14: Wilder-smoothed gains/losses; flat=50, gains without losses=100.
- ADX 14: Wilder-smoothed true range and directional movement, first ADX is the
  mean of 14 DX values. Strength only; >20 is a poster-derived filter, not a
  direction or universally correct threshold.
- Session VWAP: cumulative typical price `(H+L+C)/3` times volume / volume,
  resetting at **00:00 UTC** for crypto. Null unless session-start history and
  positive volume are available; an observed intraday gap invalidates the session.
- MACD 12/26/9: EMA12 minus EMA26, EMA9 signal, difference histogram.
- Bollinger Bands: SMA20 +/- two population standard deviations of closes.

**EMA 9/21 + VWAP + ADX:** a crossover on the previous closed confirmation bar,
its close beyond EMA9 and VWAP in the proposed direction, ADX14 >20 on that bar,
then the next closed candle closes beyond the confirmation high/low. Short is the
mirror. This uses a closing breakout, deliberately **not** an assumed intrabar
fill at the exact breakout price. A crossover that occurred many bars earlier is
not treated as a new one. This is an explicit, testable interpretation of an
underspecified social-media image, not a verbatim complete trading system.

**VWAP + RSI:** close on the proposed side of VWAP and EMA21, RSI14 above/below
50. The image did not specify the EMA period: **21 is our disclosed choice**.
Both strategies show every pass/fail/missing condition. Neither defines a complete
cost-aware trading plan, and neither submits orders. MACD/Bollinger/EMA50/200 are
context, not extra mandatory filters; indiscriminate indicator stacking is avoided.

The equity-hours poster is **not applied to 24/7 crypto**. No time bucket is labelled
inherently profitable. The "80% win rate" headline and claims about best indicators
are not imported. Walk-forward validation on real held-out candles, costs,
funding, spread and slippage are still required before considering an edge.

## Persistence and safety boundaries

The existing authenticated `/api/ai` path publishes and records these snapshots.
Outcome resolution now uses **closed candles only** and refuses to score a row
against a different data source. Same-bar caches require the same source and rule
version. Legacy outcomes are not silently reclassified as comparable memory.
Ledger read-modify-write operations are serialized within one process so both
chart panes do not overwrite each other. This is **not** a multi-instance database
transaction; a shared multi-instance deployment needs transactional storage.

The ledger uses the local JSON store, even if other application data uses Postgres.
Set `TC_DATA_DIR` to a persistent writable volume for lasting recall, back it up,
and do not commit runtime data or keys. Serverless `/tmp` is ephemeral and cannot
provide lasting/shared memory. Failed writes show an explicit warning. Graceful
fallback does not guarantee durability. Free-tier quotas are local guard rails,
not a guarantee that a provider will never charge; use free models/credit limits.
No external key is necessary for deterministic pattern/indicator analysis.

## Research references (reviewed 2026-10-15)

- Existing prior trend and further confirmation are important for reversal
  interpretation; bullish engulfing covers bodies, not necessarily shadows.
  [1](https://chartschool.stockcharts.com/table-of-contents/chart-analysis/candlestick-charts/candlestick-bullish-reversal-patterns)
- Bearish engulfing likewise covers the previous body and needs further weakness
  for confirmation.
  [2](https://chartschool.stockcharts.com/table-of-contents/chart-analysis/candlestick-charts/candlestick-bearish-reversal-patterns)
- ADX uses Wilder smoothing; 20 and 25 are commonly discussed qualification
  levels, rather than a guarantee of performance.
  [2](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/average-directional-index-adx)
- Overview distinguishes moving-average/VWAP overlays from RSI/ADX indicators.
  [3](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays)
- Candlestick examples show combining shapes with moving-average, breakout and
  momentum context; these examples are not a validation of this implementation.
  [3](https://chartschool.stockcharts.com/table-of-contents/chart-analysis/candlestick-charts/candlesticks-and-traditional-chart-analysis)

The uploaded posters are requirements inspiration, not a statistical data set.
Tests validate formulas and the chosen rules, **not profitability**. Run
`npm run test:ai` for pattern, indicator, memory and existing prediction tests.

## Verification completed

- `npm run typecheck`: clean, including gateway.
- `npm run lint`: clean.
- `npm test`: **260 passed, 0 failed** (28 quant, 30 quant-v2, 83 AI,
  39 exchange, 78 gateway, 1 paper API, 1 live-exchange harness) plus production
  build. The exchange harness is not a live trading/profitability trial.
- New tests include fixtures covering all 30 pattern names, mirrored geometry,
  prior-trend rejection, strict-gap rejection, scale invariance, zero-range bars,
  indicator warmups, known arithmetic examples, UTC VWAP reset/truncation,
  snapshot prefix causality, source/version/time filtering, overlapping outcome
  deduplication, opposing-pattern veto, concurrent ledger writes and cache source.
- Authenticated demo API smoke: 200, technical-v1 evidence and memory present,
  saved successfully, same-bar request cached. Both chart types rendered the new
  section. Desktop 1440px, phone 390px and tablet 834px browser checks: no page
  errors; phone/tablet document widths matched viewport (no horizontal overflow).
  These are UI/synthetic checks, **not real-market strategy validation**.
