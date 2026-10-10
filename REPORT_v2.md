# trading-command-v3: reconciliation fixes and validated trend core

## Data status (read first)

No historical candle data was provided. The upload contains source code, model weights and a 300-bar sine-wave fixture used by unit tests. CoinDCX candles cannot be fetched from the sandbox (proxy policy denial). **Every number below is from synthetic data.** The observed results therefore validate the *method* (does the pipeline detect edges that exist, and reject ones that don't). They are not evidence about the real market. To get real results, export CoinDCX candles to CSV (4h and 1D, ideally 3+ years) and run `exp.ts` with a CSV loader in place of `genPath`.

## What changed (priority order; patch: `changes.patch`)

1. **Breakout logic (`engine.ts`).** Levels were classified above or below the current price, so a level crossed on the last bar was never a candidate, and the breakout branch could never fire. Now all price clusters are kept side-agnostic, and a breakout is a cross of the *previous* close to the *last* close. Chases more than 0.5% beyond the level are rejected as WATCH.
2. **Shorts and reconciliation (`walkForward.ts`, `trend.ts`).** The simulator takes shorts. The decision function `trendSignalAt` is shared by the backtest and the live engine, so there is one copy of the rule. Higher-timeframe context is real HTF data, admitted only when its close time is at or before the execution bar's close.
3. **Trend-following core (`trend.ts`).** Donchian breakout on the execution timeframe, filtered by an SMA regime on the higher timeframe (the reconciled HTF input).
4. **Exits.** The fixed 2R take-profit is replaced by a chandelier trailing stop (3 ATR, ratchet only). The initial stop is 2 ATR. Gap-through fills execute at the open, not at the stop. Time stop at 300 bars.
5. **Costs (`costs.ts`).** Taker and maker fees, adverse slippage per market fill, and funding paid or received per 8h. Fee and funding rates are placeholders; verify them against CoinDCX before relying on any figure.
6. **Validation (`validation.ts`).** Purged expanding-window walk-forward (parameters chosen only on data before each test block, with a purge gap of `maxBars + donchian` bars). A random-entry control with the same exit engine, trade frequency and random side, over 100 seeds. The Deflated Sharpe Ratio (Bailey and López de Prado), with N = 16 grid trials.
7. **Reporting.** Expectancy in R, profit factor, maximum drawdown, long and short expectancy. Hit rate is removed from `report()`.

## Verification

- Strict `tsc` (repo's `tsconfig.quant.json` settings): passes.
- New suite (`backtest.test.ts`): 11 tests pass. They cover causality (decisions unchanged when future data is removed), HTF bars used only after closing, shorts produced in downtrends, gap fills, the accounting identity for net R, the purge boundary, and the normal CDF and inverse.
- Existing suite (`quant.test.ts`, including the Python-parity tests): 28 pass.
- Breakout: a constructed cross fires `LONG_SETUP`. On random walks it now fires about 1,600 times each way (it previously fired never).

## Expected versus observed

Expected before running: on a zero-drift random walk, OOS expectancy near zero or slightly negative after costs, a random-entry control that matches it, and DSR and p-values at chance levels. On planted trend regimes, the method should detect the edge clearly. A weak planted edge might or might not be detected at this sample size.

Setup: 24 synthetic paths per scenario, 20,000 four-hour bars each (about 9 years), per-bar volatility 1.5%, execution 4h, context 1D, 4 purged folds, 16-config grid, 100 control seeds.

| Scenario | OOS trades (pooled) | Mean path expectancy (R) | t across paths | Random-control expectancy (R) | Median control p | Mean DSR | Paths with DSR > 0.95 | Paths with p < 0.05 |
|---|---|---|---|---|---|---|---|---|
| Null: zero drift | 4,297 | +0.017 | 0.45 | −0.032 | 0.41 | 0.32 | 1 / 24 | 1 / 24 |
| Planted regimes, 0.10%/bar, 800-bar blocks | 3,655 | +0.507 | 13.7 | +0.127 | 0.03 | 0.94 | 21 / 24 | 18 / 24 |
| Weak planted, 0.03%/bar, 800-bar blocks | 4,059 | +0.039 | 1.1 | −0.032 | 0.39 | 0.38 | 1 / 24 | 1 / 24 |

Reading the table:
- **Null.** The result sits at chance. One path in 24 reaching DSR > 0.95 or p < 0.05 is what a 5% false-positive rate predicts (about 1.2 expected). The validator does not manufacture an edge out of noise.
- **Planted edge.** A real effect is detected in most paths, with DSR and p-values that agree with each other.
- **Weak planted edge.** Not detected (t = 1.1). The method is conservative, and a weak real edge would need far more data to confirm.

## Caveats and remaining work

- **The live route is not yet switched to the trend core.** `route.ts` still uses the confluence engine and the breakout strategy. The trend core is ready to call from the route with the same HTF candles it already fetches. I did not wire it in because I could not compile the Next.js app in this sandbox (dependencies are not installed). Reconciliation is complete at the backtest and engine level only; the route step is the next thing to do and should be tested in the repo.
- **The random-side control is a weak null in strongly trending data.** The trailing exit harvests trends regardless of entry. The control still isolates entry selection in the null and weak cases, but it is not a complete test. A stronger control would randomise entry timing within the same regime.
- **Synthetic regimes are idealised.** Real markets have volatility clustering, fat tails and regime changes that do not match these generators. Results on real data will be worse and must be checked there.
- **Maker entries are modelled optimistically.** The `entryMaker` flag assumes a fill at the open. Real limit orders can miss.
- **Funding and fee rates are placeholders.** Verify before use.
- **Trial count.** DSR uses N = 16. If you tried more variants during development, N must include them.
