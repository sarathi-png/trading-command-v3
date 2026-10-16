# Compact decisions, chart-specific research, connection status

## UI contract

The default AI review is now a compact three-part summary, not a wall of analysis:

1. **Strategy decision** — deterministic Chandelier Exit + Donchian decision.
2. **AI decision** — the validated external model's proposal, or **Unavailable** if only technical rules answered.
3. **Final output** — **Strategy = AI**, **Strategy ≠ AI**, or **Not compared**. Neutral agreement explicitly says both are waiting; it is not a trade signal or approval.

Reasons, technical evidence, memory notes, request budgets and detailed provenance are behind the closed **Reasons & details** disclosure. Minimal source/time and safety caveats remain visible. The review can still be hidden entirely, which unmounts it and stops its requests. AI connection controls remain on the separate connection page.

A model proposal is saved as `modelDecision` **before** the existing technical safety veto modifies the published prediction. Comparison uses that original validated proposal, never a forced-neutral value masquerading as model agreement. The safety-adjusted published call remains unchanged for existing outcome/log behavior, and a veto is disclosed visibly. Legacy vetoed rows without an original proposal are not compared.

## Chart controls and isolation

- Every chart has a visible **Timeframe** selector using the existing supported frames. Selection updates the workspace/chart/AI timeframe together. It is not forced back to 5m; 15m remains the initial workspace default.
- The raw-candle and HA navigation pages stay separate; the oversized in-toolbar chart-type selector and duplicate strategy-overlay button are removed. Drawing tool rails have a bounded desktop width.
- Default **essential price labels** show manual levels and active setup entry/stop/target labels. Resistance/support and Chandelier/Donchian lines remain available, but their axis badges are hidden until **All price labels** is selected. The expandable legend retains indicator values.
- WATCH/WAIT candidates cannot draw an active entry/stop/target or a false short arrow. Only LONG_SETUP/SHORT_SETUP qualify.
- `/api/strategy/evaluate?chartType=heikin-ashi` computes structure, levels and strategy markers from HA candles. It explicitly tags the analysis, does not overwrite the normal-candle signal ledger and does not emit normal-chart alerts. HA prices remain synthetic research levels, not executable fills.
- Chart panels reject analysis tagged for another chart type or instrument/frame. Old markers/drawings are cleared on resource changes. Initial HA OHLC values use the displayed smoothed candle, not the raw close.
- Drawings use independent `chart:candles` and `chart:heikin-ashi` layouts in existing storage; no database migration is required. Historical `default` drawings stay with normal candles. Scoped reads and writes keep drawings on the corresponding chart. Operator/bearer legacy API behavior remains compatible.
- Chandelier indicator computation no longer depends on loading a live account just to produce a chart state; no live sizing from simulated equity is introduced.

## Connection dots

Reusable configuration badges on OpenRouter, NVIDIA, CoinDCX, Telegram and WhatsApp show:

- Green static glow + **Configured** when the required configuration/key is present.
- Red static glow + **Not configured** when it is absent/incomplete.
- Neutral **Checking** until presence is known.

Presence does not establish provider connectivity, valid credentials, remaining free quota, recipient delivery, or live execution permission. Health remains a separate status. Dots have text labels and no required pulsing animation; error health dots also receive a visible static glow.

## Verification

- Typecheck, lint and production build pass.
- Full `npm test`: **338 tests passed, zero failed**. Includes six decision-comparison cases (model match/conflict, rule/degraded fallback, original decision before veto, legacy veto), three chart-scope tests and expanded drawing/analysis API integration assertions.
- Optional `scripts/check-chart-readability.mjs`: profile flow, chart-specific routes, local timeframe changes, essential/all-label controls, compact decision output, reasons disclosure, matched/conflicting model UI, fallback not falsely counted as AI, green/red key badges, day/night and 390/834/1366/1568/2560px. No horizontal overflow, overlapping cards or browser page errors.
- External decisions/configured keys are mocked for their browser UI cases; no real provider credentials, provider requests or live orders are used. Main chart screenshots use labelled demo data with honest rule-only fallback.

Changes are local to Arena. This does not update Vercel or resolve the separately documented serverless persistence/scheduler limitations. This closed coding session cannot publish to GitHub; publication needs a new coding session.
