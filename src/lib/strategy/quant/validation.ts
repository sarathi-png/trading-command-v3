/**
 * Out-of-sample validation for the trend-following core.
 *
 *  - Purged, expanding-window walk-forward: parameters are chosen on data strictly
 *    before each test block, with a purge gap so no training trade can overlap the test.
 *  - Random-entry control: same exit engine and trade frequency, random side, many seeds.
 *    Reports the share of control runs whose expectancy matches or beats the strategy.
 *  - Deflated Sharpe Ratio (Bailey & López de Prado, 2014): corrects the observed Sharpe
 *    for the number of configurations tried and for non-normal returns.
 */
import type { Candle } from "@/lib/types";
import { runTrend, runRandomControl, report, type BacktestConfig, type Trade } from "./walkForward";
import { DEFAULT_TREND, type TrendParams } from "./trend";

export function paramGrid(base: TrendParams = DEFAULT_TREND): TrendParams[] {
  const out: TrendParams[] = [];
  for (const donchian of [20, 55])
    for (const stopAtr of [2, 3])
      for (const trailAtr of [3, 4])
        for (const regimeSma of [100, 200])
          out.push({ ...base, donchian, stopAtr, trailAtr, regimeSma });
  return out; // 16 configurations = number of trials for the DSR
}

/** Slice an LTF range and the HTF candles that are fully closed inside it (plus regime warm-up). */
export function sliceWindow(
  ltf: Candle[], htf: Candle[], a: number, b: number, cfg: BacktestConfig
): { ltf: Candle[]; htf: Candle[] } {
  const sub = ltf.slice(a, b);
  const startT = sub[0].time - cfg.htfSec * (cfg.params.regimeSma + 5);
  const endT = sub[sub.length - 1].time + cfg.ltfSec;
  return { ltf: sub, htf: htf.filter((c) => c.time >= startT && c.time + cfg.htfSec <= endT) };
}

export interface FoldResult {
  fold: number;
  testStart: number; testEnd: number;
  chosen: TrendParams;
  inSampleExpectancyR: number;
  oosTrades: Trade[];
}

export interface WFResult {
  folds: FoldResult[];
  oos: Trade[];
  oosReport: ReturnType<typeof report>;
  controlExpectancies: number[];   // one per random seed, pooled over folds
  controlPValue: number;           // share of controls >= strategy (add-one smoothed)
  foldExpectancies: number[];      // strategy OOS expectancy per fold
  trials: number;
}

export function walkForwardPurged(
  ltf: Candle[], htf: Candle[], cfg: BacktestConfig,
  grid: TrendParams[], opts: { folds?: number; controlSeeds?: number; minTrainTrades?: number } = {}
): WFResult {
  const K = opts.folds ?? 4;
  const seeds = opts.controlSeeds ?? 200;
  const minTrain = opts.minTrainTrades ?? 30;
  const n = ltf.length;
  const purge = cfg.params.maxBars + cfg.params.donchian; // no training trade can reach the test block
  const blk = Math.floor(n / (K + 1));
  const folds: FoldResult[] = [];
  const oos: Trade[] = [];
  const warm = Math.max(...grid.map((g) => g.regimeSma)) * (cfg.htfSec / cfg.ltfSec) + 300;

  for (let k = 1; k <= K; k++) {
    const testStart = k * blk;
    const testEnd = k === K ? n : (k + 1) * blk;
    const trainEnd = testStart - purge;
    if (trainEnd < blk) continue;

    // 1) choose parameters on the purged training window only
    const train = sliceWindow(ltf, htf, 0, trainEnd, cfg);
    let best: { p: TrendParams; e: number } | null = null;
    for (const p of grid) {
      const tr = runTrend(train.ltf, train.htf, { ...cfg, params: p });
      if (tr.length < minTrain) continue;
      const e = report(tr).expectancyR;
      if (!best || e > best.e) best = { p, e };
    }
    if (!best) continue;

    // 2) apply frozen parameters to the test block (warm-up bars are inputs only; trades must start inside the block)
    const a = Math.max(0, testStart - warm);
    const test = sliceWindow(ltf, htf, a, testEnd, cfg);
    const startT = ltf[testStart].time;
    const oosTrades = runTrend(test.ltf, test.htf, { ...cfg, params: best.p })
      .filter((t) => t.entryTime >= startT);
    folds.push({ fold: k, testStart, testEnd, chosen: best.p, inSampleExpectancyR: best.e, oosTrades });
    oos.push(...oosTrades);
  }

  const oosReport = report(oos);

  // Random-entry control, same frequency per fold, many seeds; pooled over the same folds.
  const controlExpectancies: number[] = [];
  for (let s = 1; s <= seeds; s++) {
    const pooled: Trade[] = [];
    for (const f of folds) {
      const a = Math.max(0, f.testStart - warm);
      const test = sliceWindow(ltf, htf, a, f.testEnd, cfg);
      const bars = f.testEnd - f.testStart;
      const rate = f.oosTrades.length / Math.max(1, bars);
      const startT = ltf[f.testStart].time;
      const rt = runRandomControl(test.ltf, { ...cfg, params: f.chosen }, rate, 7919 * s + f.fold)
        .filter((t) => t.entryTime >= startT);
      pooled.push(...rt);
    }
    controlExpectancies.push(pooled.length ? report(pooled).expectancyR : 0);
  }
  const ge = controlExpectancies.filter((e) => e >= oosReport.expectancyR).length;

  return {
    folds, oos, oosReport, controlExpectancies,
    controlPValue: +((ge + 1) / (seeds + 1)).toFixed(4),
    foldExpectancies: folds.map((f) => report(f.oosTrades).expectancyR),
    trials: grid.length,
  };
}

/* ---------------- Deflated Sharpe Ratio ---------------- */

const EULER = 0.5772156649;

/** Standard normal CDF (Abramowitz–Stegun 7.1.26 via erf; abs error ~1e-7). */
export function normCdf(x: number): number {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return 0.5 * (x >= 0 ? 1 + y : 1 - y);
}

/** Inverse standard normal (Acklam's rational approximation, rel. error < 1.2e-9). */
export function normInv(p: number): number {
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const pl = 0.02425;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= 1 - pl) {
    const q = p - 0.5, r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

export interface DSRResult {
  sharpePerTrade: number;
  expectedMaxSharpe: number;   // SR0: what the best of N null trials would show
  psr: number;                 // probabilistic Sharpe vs 0 (single trial)
  dsr: number;                 // deflated: probability the true Sharpe exceeds SR0
  skew: number; kurtosis: number; T: number; N: number;
}

/** Sharpe is per trade (not annualised), consistent with the R series. */
export function deflatedSharpe(returnsR: number[], trialSharpes: number[]): DSRResult {
  const T = returnsR.length;
  const N = trialSharpes.length;
  const m = returnsR.reduce((a, b) => a + b, 0) / T;
  const sd = Math.sqrt(returnsR.reduce((a, b) => a + (b - m) ** 2, 0) / (T - 1));
  const sr = m / sd;
  const z = returnsR.map((r) => (r - m) / sd);
  const g3 = z.reduce((a, b) => a + b ** 3, 0) / T;
  const g4 = z.reduce((a, b) => a + b ** 4, 0) / T; // raw kurtosis (3 for normal)

  const mu = trialSharpes.reduce((a, b) => a + b, 0) / N;
  const varSR = trialSharpes.reduce((a, b) => a + (b - mu) ** 2, 0) / Math.max(1, N - 1);
  const sr0 = N > 1
    ? Math.sqrt(varSR) * ((1 - EULER) * normInv(1 - 1 / N) + EULER * normInv(1 - 1 / (N * Math.E)))
    : 0;

  const denom = Math.sqrt(1 - g3 * sr + ((g4 - 1) / 4) * sr * sr);
  const psr = normCdf((sr * Math.sqrt(T - 1)) / denom);
  const dsr = normCdf(((sr - sr0) * Math.sqrt(T - 1)) / denom);
  return {
    sharpePerTrade: +sr.toFixed(4), expectedMaxSharpe: +sr0.toFixed(4),
    psr: +psr.toFixed(4), dsr: +dsr.toFixed(4),
    skew: +g3.toFixed(3), kurtosis: +g4.toFixed(3), T, N,
  };
}

/** In-sample Sharpe per trade for every grid configuration (the trial population for DSR). */
export function gridSharpes(ltf: Candle[], htf: Candle[], cfg: BacktestConfig, grid: TrendParams[]): number[] {
  return grid.map((p) => {
    const r = report(runTrend(ltf, htf, { ...cfg, params: p })).netR;
    if (r.length < 3) return 0;
    const m = r.reduce((a, b) => a + b, 0) / r.length;
    const sd = Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / (r.length - 1));
    return sd > 0 ? m / sd : 0;
  });
}
