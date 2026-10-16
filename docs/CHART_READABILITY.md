# Chart readability correction

**Superseded navigation:** the later workspace follow-up removes comparison entirely and gives each chart a separate sidebar route. See `WORKSPACE_SEPARATION.md` for current behavior and 329-test verification. The comparison notes below describe the earlier correction, not the current UI.

## Problems reported

Vercel screenshots showed two narrow chart/AI columns, mostly unreadable candle plots, and sidebar cards collapsing into overlapping strategy/order-book/structure text. The layout used viewport-wide breakpoints rather than the chart's actual remaining width; the object browser took another 208px from each plot. Sidebar flex children could shrink while their contents kept painting outside their boxes. Opening the explanation legend also consumed the fixed candle allocation. Strategy overlays attempted to identify price-line objects by a nonexistent public `title` property, so refreshes could accumulate labels.

## Changes

- Focused candlestick view by default; Candlestick / Heikin-Ashi / Compare both buttons preserve distinct chart types and predictions.
- Comparison uses the **chart stage's container width**, not the browser width. Below 1120px of stage space, charts stack. Wider stages display two readable plots side by side.
- Each plot gets an explicit responsive surface height. Legend content flows below that surface rather than squeezing candles. Legend and object browser start closed; both remain available on demand.
- AI review is below the plot, with a hide/show control; hiding does not lose its mounted state. Provider/fallback/certainty disclosures remain unchanged.
- Natural-flow grid sidebar cards cannot flex-shrink into one another. Watchlist has its own bounded scrollbar; the desktop context rail scrolls independently and tablet/phone context stays available below the charts.
- Equal Donchian bounds merge into one axis badge listing their periods. Different prices and upper/lower semantics stay distinct; all individual periods remain in the explanatory legend.
- Overlay price lines have their own reference list, separate from drawings/support/resistance. Refreshes remove previous overlay lines with the chart API rather than inspecting a nonexistent `title` field.
- Inter / JetBrains Mono, display currency conversion, actual-source semantics and execution safety are preserved. No server-side trade/execution logic changes.

## Verification

- Clean full suite: **322 passed, zero failed**.
- Typecheck and lint pass; diff whitespace check passes.
- Optional browser regression: `scripts/check-chart-readability.mjs` (requires local `playwright` and `@sparticuz/chromium`, not production dependencies).
- Tested 390, 834, 1366, 1568 and 2560px widths, day/night themes, view controls, analysis visibility, closed object browser and stable plot height after legend expansion.
- Assertions check card separation, minimum plot dimensions, container-width stacking vs side-by-side layout, document overflow and browser page errors.
- Screenshots are local ignored verification artifacts in `output/`, not checked-in application assets.
- Browser checks use labelled demo data and never submit orders. Real Vercel/provider connectivity has not been verified.

## Publication status

Changes are available locally in this Arena workspace. The coding session is closed; remote pushes/PR operations are unavailable. Start a new coding session to publish this follow-up to GitHub. Do not confuse the running local preview with an updated Vercel deployment.
