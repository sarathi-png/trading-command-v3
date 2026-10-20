/**
 * 18 causal features — faithful port of trader_bot_v2/ml4t/features.py.
 * Every row i uses only candles[0..i]. buildFeatures() returns the tail vector.
 */
import type { Candle } from "@/lib/types";
import { atr, closes, ema, maCrossSignal, rsi, sma } from "../../indicators";
import { swingLevelFfill } from "./zones";

export const FEATURE_COLUMNS = [
  "atr_norm", "rsi_14", "rsi_dist50", "ema_fast", "ema_slow",
  "ema_gap_atr", "ma_fast", "ma_slow", "ma_gap_atr", "ma_cross",
  "dist_support_atr", "dist_resist_atr", "wick_reject",
  "trend_slope_atr", "vol_ratio", "ret_1", "ret_4", "range_atr",
] as const;

export type FeatureVector = Record<(typeof FEATURE_COLUMNS)[number], number>;

/** Rolling mean INCLUDING the current bar (pandas .rolling(n).mean()). */
function rollingMeanInclusive(values: number[], window: number): number {
  const start = Math.max(0, values.length - window);
  let sum = 0;
  for (let i = start; i < values.length; i++) sum += values[i];
  return sum / (values.length - start);
}

export function buildFeatures(candles: Candle[]): FeatureVector | null {
  const n = candles.length;
  if (n < 60) return null;
  const last = candles[n - 1];
  const cl = closes(candles);

  // Python: atr_14(df).replace(0, nan).ffill()
  const A = atr(candles);
  let a = A[n - 1];
  if (a === null || !isFinite(a)) {
    for (let i = n - 1; i >= 0; i--) { const v = A[i]; if (v !== null && isFinite(v)) { a = v; break; } }
  }
  if (a === null || a <= 0 || !isFinite(a)) return null;

  const R = rsi(candles);
  const rv = R[n - 1] !== null && isFinite(R[n - 1] as number) ? (R[n - 1] as number) : 50;

  const ef = ema(cl, 20);
  const es = ema(cl, 50);
  const mf = sma(cl, 9);
  const ms = sma(cl, 21);
  const mc = maCrossSignal(candles);

  const { support, resistance } = swingLevelFfill(candles, 5);
  const supLevel = support[n - 1];
  const resLevel = resistance[n - 1];

  const rng = last.high - last.low;
  const wick = rng !== 0
    ? Math.max(last.high - Math.max(last.close, last.open),
               Math.min(last.close, last.open) - last.low) / rng
    : 0;

  // Least-squares slope of closes over the last 30 bars (polyfit degree 1).
  const w = cl.slice(-30);
  const mx = (w.length - 1) / 2;
  const my = w.reduce((x, y) => x + y, 0) / w.length;
  let num = 0;
  let den = 0;
  w.forEach((y, x) => { num += (x - mx) * (y - my); den += (x - mx) ** 2; });
  const slope = den ? num / den : 0;

  const vols = candles.map((c) => c.volume);
  const nz = (v: number | null, fb = 0) => (v === null || !isFinite(v) ? fb : v);
  const atrSafe = a as number;

  return {
    atr_norm: atrSafe / last.close,
    rsi_14: rv,
    rsi_dist50: (rv - 50) / 50,
    ema_fast: nz(ef[n - 1]) / last.close - 1,
    ema_slow: nz(es[n - 1]) / last.close - 1,
    ema_gap_atr: (nz(ef[n - 1]) - nz(es[n - 1])) / atrSafe,
    ma_fast: nz(mf[n - 1]) / last.close - 1,
    ma_slow: nz(ms[n - 1]) / last.close - 1,
    ma_gap_atr: (nz(mf[n - 1]) - nz(ms[n - 1])) / atrSafe,
    ma_cross: mc[n - 1],
    dist_support_atr: supLevel !== null ? (last.close - supLevel) / atrSafe : NaN,
    dist_resist_atr: resLevel !== null ? (resLevel - last.close) / atrSafe : NaN,
    wick_reject: wick,
    trend_slope_atr: slope / atrSafe,
    vol_ratio: rollingMeanInclusive(vols, 20) > 0
      ? vols[n - 1] / rollingMeanInclusive(vols, 20)
      : 1,
    ret_1: cl[n - 1] / cl[n - 2] - 1,
    ret_4: cl[n - 1] / cl[n - 5] - 1,
    range_atr: (rng === 0 ? NaN : rng) / atrSafe,
  };
}

export function toArray(v: FeatureVector): number[] {
  return FEATURE_COLUMNS.map((k) => v[k]);
}