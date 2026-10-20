/**
 * Quant indicators — TypeScript port of trader_bot_v2/engine/indicators.py.
 * Wilder ATR-14 / Wilder RSI-14 / SMA 9/21 ma_cross. Pure functions over
 * Candle[] (oldest → newest), NaN-safe warmup, no look-ahead.
 */
import type { Candle } from "@/lib/types";

export function closes(candles: Candle[]): number[] {
  return candles.map((c) => c.close);
}

export function atr(candles: Candle[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  if (candles.length < period + 1) return out;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const h = candles[i].high, l = candles[i].low, pc = candles[i - 1].close;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  // Wilder seed: SMA of first `period` TRs, then RMA.
  let rma = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period] = rma;
  for (let i = period; i < trs.length; i++) {
    rma = (rma * (period - 1) + trs[i]) / period;
    out[i + 1] = rma;
  }
  return out;
}

export function rsi(candles: Candle[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  const cl = closes(candles);
  if (cl.length < period + 1) return out;
  let g = 0, l = 0;
  for (let i = 1; i <= period; i++) {
    const d = cl[i] - cl[i - 1];
    if (d > 0) g += d; else l -= d;
  }
  g /= period; l /= period;
  // A perfectly flat window has no momentum: RSI is neutral (50), not
  // overbought. The AI technical layer already returns 50; keep them identical.
  out[period] = g === 0 && l === 0 ? 50 : l === 0 ? 100 : 100 - 100 / (1 + g / l);
  for (let i = period + 1; i < cl.length; i++) {
    const d = cl[i] - cl[i - 1];
    g = (g * (period - 1) + Math.max(d, 0)) / period;
    l = (l * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = g === 0 && l === 0 ? 50 : l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return out;
}

export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function emaSeries(values: number[], span: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (!values.length) return out;
  const k = 2 / (span + 1);
  let prev = values[0];
  for (let i = 0; i < values.length; i++) {
    prev = i === 0 ? values[0] : values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** 1 = bullish cross, -1 = bearish cross, 0 = none (NaN-safe like the py fix). */
export function maCross(candles: Candle[], fast = 9, slow = 21): number[] {
  const cl = closes(candles);
  const f = sma(cl, fast), s = sma(cl, slow);
  const out = new Array(candles.length).fill(0);
  for (let i = 1; i < candles.length; i++) {
    const fa = f[i] !== null && s[i] !== null && (f[i] as number) > (s[i] as number);
    const pa = f[i - 1] !== null && s[i - 1] !== null && (f[i - 1] as number) > (s[i - 1] as number);
    if (fa && !pa) out[i] = 1;
    else if (!fa && pa) out[i] = -1;
  }
  return out;
}

/**
 * ma_cross signal used by the 18-feature vector.
 *
 * Port of engine/indicators.py ma_cross: SMA fast vs slow, +1 on a bullish
 * crossover bar, -1 on a bearish one, 0 otherwise, NaN-safe during warmup.
 *
 * History: the Python reference produced OBJECT dtype after
 * `.shift(1).fillna(False)`, so `~prev` was always truthy and every bar with
 * fast > slow reported a "cross" (150 signals in 300 bars). That bug is fixed
 * on the Python side (`.astype(bool)`) and the model was retrained; this port
 * now implements the genuine one-bar crossover semantics.
 */
export function maCrossSignal(candles: Candle[], fast = 9, slow = 21): number[] {
  return maCross(candles, fast, slow);
}