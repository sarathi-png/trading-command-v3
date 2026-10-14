# Trading Command: audit and implementation plan

Review date: 2026-10-14. Baseline: 6617dd4, current Arena checkout. Scope: targeted correctness and UX audit, not a certification of profitability or live-execution safety.

## Status

Executed. Findings, fixes and verification are recorded in `docs/AUDIT_2026-10.md`; the
remaining items in that document are the forward roadmap (decision snapshots,
out-of-sample validation, portfolio risk, promotion gates), not silently dropped work.

## Order of work
1. Establish type/lint/test baseline and inspect strategy, polling, account labels and navigation.
2. Correct indicator causality, executable-price assumptions, sizing and backtest reporting; add deterministic regression tests.
3. Improve the existing Inter / JetBrains Mono design system: hierarchy, spacing, navigation, responsive layout, explicit data provenance and decision readiness.
4. Run automated suites, production build and browser smoke checks; record limitations and follow-up priorities.

## Design benchmark
Primary product documentation reviewed (not a comprehensive ranking of every trading product):
- TradingView: contextual top toolbar, chart-centred workspace, separated watchlist/alert tools and saved layouts. [1](https://www.tradingview.com/support/solutions/43000746464-getting-started-with-supercharts/)
- Coinbase Advanced: chart / order book / order panel separation, market depth and persistent chart preferences. [2](https://help.coinbase.com/en/coinbase/trading-and-funding/advanced-trade/dashboard-overview)
- Kraken Pro: configurable widgets, consolidated portfolio, advanced risk-related order instructions. [3](https://www.kraken.com/pro)

The following are our design judgments, not claims that competitors have defects:

| Pattern | Existing project | Decision |
| --- | --- | --- |
| Chart-first analytical hierarchy | Chart competes with account integration panel; no page introduction | Introduce an overview header, move integration detail below primary analysis |
| Dense professional tools | Tiny uppercase labels, duplicate status indicators, moving cards | Increase whitespace and hierarchy, use restrained static surfaces |
| Honest provenance | Demo equity labelled CoinDCX Futures; errors leave plausible old data | Explicit simulated-account labels and visible error/readiness state |
| Configurable workspace | Module settings and palette already exist | Preserve rather than add a second layout system |
| Advanced risk controls | Existing server gates are valuable | Preserve gates; no new live automation in this pass |
| Mobile density | Toolbar and fixed-width content can crowd small screens | Wrap toolbar, constrain panels, improve navigation tap targets |
| Decorative premium styling | Duplicate CSS panel definitions and many unused utility rules | Consolidate core surface styles rather than add gradients/glows |

## Unique direction
Build an **evidence-first trading workspace**, not an AI profit predictor. First deliverable: a decision-readiness strip showing data source, analysis freshness, setup state and execution mode with an actionable next step. Future milestones: immutable decision snapshots (candles/config/version), out-of-sample validation with uncertainty intervals, correlated portfolio risk and fee/funding stress scenarios, and replay-to-paper promotion gates. These require reliable data and evaluation infrastructure before live routing.

## Boundaries
Keep live trading disabled by default. Do not claim the strategies have an edge from synthetic data. Retain the documented legacy gateway until its separate deployment is explicitly retired. Do not remove historical migrations or public exports merely because they are not imported by the main UI.
