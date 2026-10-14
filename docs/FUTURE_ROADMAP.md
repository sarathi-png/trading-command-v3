# Competitive analysis and futuristic roadmap

Deliverable for request #3: what the most popular trading projects have built, what is missing
here, what is worth adding — and which forward-looking characteristics can make this project
genuinely distinctive rather than a clone.

Companion documents: `AUDIT_2026-10.md` (correctness/UX audit), `DESIGN_BENCHMARK.md` (visual and
interaction benchmark).

## 1. The landscape, by category

| Category | Notable projects | What they are actually good at |
|---|---|---|
| Charting workspaces | TradingView, TrendSpider, Koyfin | Depth of chart tooling, alerts, screeners, replay, community publishing |
| Exchange terminals | Binance, Bybit, Coinbase Advanced, Kraken Pro, OKX, Zerodha Kite | Execution speed, order types, margin tooling, mobile parity, Lite/Pro onboarding |
| Order-flow & microstructure | Bookmap, Exocharts, TensorCharts, Sierra Chart | Heatmaps, footprint, liquidity walls, DOM-based execution |
| Portfolio & journal analytics | TradeZella, TraderVue, Edgewonk, Sharesight | Post-trade attribution, R-multiple analytics, tagging, psychology review |
| Automated strategy tooling | Freqtrade, Hummingbot, Jesse, 3Commas, Streak | Backtest → paper → live pipelines, bot hosting, DCA/grid execution |
| DeFi / on-chain terminals | Hyperliquid, Axiom, DexScreener, GMX | Wallet-native trading, on-chain transparency, instant settlement |
| Institutional reference | Bloomberg Terminal | Density, keyboard navigation, proprietary data, cross-asset analytics |
| AI/assistant layers | Bybit TradeGPT and similar | Natural-language recall over platform data (marketed, often thin) |

## 2. Gap analysis — what they have that we do not

Ranked by value to a single-operator futures workspace. "Worth it?" is a judgement, not parity.

| Gap | Present in | Worth it? | Reasoning |
|---|---|---|---|
| Chart replay / bar-by-bar practice | TradingView | **Yes, next** | Cheapest way to build evidence on a strategy without waiting for live bars. Data already exists in the candle service. |
| Screeners across many symbols | TradingView, Kite | Yes, later | Useful once the watchlist grows past a handful; needs multi-symbol candle fan-out and caching. |
| Order-flow heatmaps / footprint | Bookmap, Exocharts | No | Requires tick/L2 history the public CoinDCX REST feed does not provide; would be a fabricated visual. |
| Community publishing / idea feeds | TradingView | No | No moderation model for a private single-user tool. |
| Copy trading, bot marketplaces | Bybit, 3Commas | No | Outsources trust to third parties we cannot verify. |
| Multi-account / multi-venue aggregation | Hummingbot, Koyfin | Only if a second venue is added | The CoinDCX adapter is currently the only venue; abstraction already exists if that changes. |
| Portfolio-level correlation limits | Institutional tools | **Yes, next** | Two correlated longs is one risk, and our limits are per-symbol today. |
| Funding/cost drag modelling on open positions | Pro tools | **Yes, next** | Funding is a real holding cost that our P&L currently ignores. |
| Execution-quality analytics (slippage vs mid, fill quality) | Institutional, some journals | Yes, later | Requires reliable fill timestamps and a mid reference; the fill stream exists. |
| Trade tagging and psychology review | TradeZella, Edgewonk | Yes, later | The journal has `emotion`/`tags` fields that are underused; a review surface would give them a purpose. |
| Economic calendar / event risk flags | Kite, TradingView | Yes, later | Needs a data source; a local "no trades within X minutes of a scheduled release" guard is more valuable than a feed. |
| On-chain data (funding arb, basis, DEX spreads) | Hyperliquid, Axiom | Not now | Different data plane; would need new providers and credentials. |
| AI chat over the workspace | Bybit TradeGPT | Only with evidence | A model that explains recorded, stored facts (why this signal fired, what its outcomes were) is honest; a model that predicts is not. |

## 3. Futuristic and unique characteristics — ranked

Each entry lists the data requirement honestly, because a feature that outruns its data is a
liability in a trading tool.

### Implemented now

1. **Decision readiness strip** — a live checklist of what is actually true (feed, analysis
   freshness, candidate setup, execution mode) with the next action. Nobody in §1 presents
   execution readiness as a first-class object.
2. **Signal accountability ledger** (new) — every recorded LONG/SHORT setup is re-evaluated
   against candle history: target hit, stop hit, still open, or *not evaluated with a reason*,
   plus MFE/MAE in R and an aggregate hit rate and average result. Unique part: it scores the
   **published plan**, not a curve-fitted backtest, and it refuses to score malformed plans
   (a target on the wrong side is reported, not counted as a win). Code:
   `src/lib/strategy/v2/outcomes.ts`, `src/app/api/signals/outcomes/route.ts`,
   `src/components/strategy/SignalAccountability.tsx`.
3. **Plain-language layer** — inline glossary on the jargon that actually appears on screen, so
   the tool teaches while it is used (`src/lib/glossary.ts`).
4. **Colour-vision-safe semantic palette + direction glyphs** — meaning survives without hue.

### Next (highest value, data already available)

5. **Decision snapshots** — persist, with each signal: candle hash, config, engine version and
   timestamp. Today the ledger recomputes from history; a snapshot makes each call replayable
   even after candle history rolls off. Schema work in `src/lib/repo` (file + Postgres) plus a
   detail view per signal.
6. **Out-of-sample validation with uncertainty** — block-bootstrapped confidence intervals on
   expectancy, profit factor and drawdown, per market and regime, instead of single point
   estimates. The quant module already contains bootstrap-style diagnostics to build on.
7. **Portfolio-level risk** — correlation clustering across open/watchlist symbols and a
   simultaneous-exposure budget, layered onto the existing `evaluateOrderRisk`.
8. **Cost drag on open positions** — funding accrual and fee estimates shown as a real cost of
   holding, so "open P&L" is not mistaken for realised edge.
9. **Bar replay → paper promotion gate** — a rule that a configuration must first produce a
   recorded, out-of-sample-positive replay run, then a paper period with the same settings,
   before live arming is even offered. This turns the existing trust progression into a
   verifiable process rather than a set of switches.

### Later (valuable but heavier)

10. **Execution-quality analytics** — slippage versus mid at submission and fill, per order type,
    to expose when the venue's microstructure costs more than the strategy makes.
11. **Regime-attributed performance** — split the accountability ledger by trend/range and
    volatility buckets, so a strategy's failure mode is visible instead of averaged away.
12. **Event-risk guard** — a session calendar with a hard "no new exposure inside the window"
    rule, driven by a local list rather than an unreliable feed.
13. **Explain-my-signal, from stored facts** — a deterministic, template-based explanation that
    cites the exact inputs and outcomes already in the database. No model, no prediction, no
    hallucinated rationale.
14. **Journal review prompts** — use the unused `emotion`/`tags` fields to prompt structured
    post-trade review and surface patterns between state and outcome.

### Explicitly rejected

Social/idea feeds, copy trading, gamified rewards, heatmap/footprint visuals without tick data,
AI price prediction, and any statistic that cannot be computed honestly from the data we hold.

## 4. Why this direction is defensible

The crowded space is *prediction* — more indicators, more signals, confident-looking overlays.
The unoccupied space is **accountability**: proving what happened, refusing to score what cannot
be verified, and pricing the real costs of holding risk. Every item in §3 either measures the
workspace against reality or removes a way for the operator to fool themselves. That is also the
only kind of "futuristic" feature set that stays trustworthy when the market disagrees with it.

## 5. Sequencing and dependencies

| Order | Item | Depends on |
|---|---|---|
| 1 | Portfolio correlation + funding cost drag | Existing account/position data — no blockers |
| 2 | Decision snapshots | Repo schema change in both backends + detail UI |
| 3 | Bar replay | Candle service + a playback clock in the chart layer |
| 4 | Out-of-sample validation with intervals | Snapshot history to test against; otherwise it re-fits the same sample |
| 5 | Promotion gates | Replay + paper evidence trail (4) |
| 6 | Execution-quality analytics | Fill timestamps (present) + mid-price reference at decision time |
| 7 | Regime attribution, event guard, review prompts | Journal and ledger history accumulating |

Items 1–3 are self-contained and can ship without waiting for statistical history; items 4–7 are
deliberately gated on evidence, because a validation layer built on a thin sample would be worse
than none at all.
