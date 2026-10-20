/**
 * Canonical technical indicators.
 *
 * Every consumer (quant features, confluence, AI evidence, strategy engine,
 * chart overlays) reads from this module so the same bar cannot produce two
 * different values in two panels. Series are oldest → newest and are strictly
 * causal: a value at index `i` depends only on candles `0..i`.
 *
 * Conventions:
 * - EMA follows the quant reference (pandas `ewm(adjust=False)`): seeded with
 *   the first close, then recursive. Warmup is `null` so a short series cannot
 *   pretend to have a long EMA. Do not mix in a TA-Lib SMA seed: the strategy,
 *   AI evidence and chart must agree bar for bar.
 * - RSI and ATR use Wilder smoothing; warmup is `null`.
 * - A perfectly flat RSI window is neutral (50), never 100.
 */
import type { Candle } from "@/lib/types";

export function closes(candles: Candle[]): number[] {
  return candles.map((c) => c.close);
}

export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/**
 * First-close-seeded exponential moving average (`ewm(adjust=False)`).
 * Missing warmup stays null. The recursion starts at bar 0 so the value at the
 * last bar is identical to the quant reference, regardless of warmup display.
 */
export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = values.map(() => null);
  if (period <= 0 || values.length < period) return out;
  const k = 2 / (period + 1);
  let value = values[0];
  for (let i = 1; i < values.length; i++) {
    value += k * (values[i] - value);
    if (i >= period - 1) out[i] = value;
  }
  return out;
}

/** Wilder RSI series. Flat windows return 50. */
export function rsi(candles: Candle[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  if (period <= 0 || candles.length < period + 1) return out;
  const cl = closes(candles);
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = cl[i] - cl[i - 1];
    if (d > 0) gain += d;
    else loss -= d;
  }
  gain /= period;
  loss /= period;
  const value = () =>
    gain === 0 && loss === 0 ? 50 : loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  out[period] = value();
  for (let i = period + 1; i < cl.length; i++) {
    const d = cl[i] - cl[i - 1];
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = value();
  }
  return out;
}

/** Wilder ATR series (true range, SMA seed, then RMA). */
export function atr(candles: Candle[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  if (period <= 0 || candles.length < period + 1) return out;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const h = candles[i].high;
    const l = candles[i].low;
    const pc = candles[i - 1].close;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  let rma = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  out[period] = rma;
  for (let i = period; i < trs.length; i++) {
    rma = (rma * (period - 1) + trs[i]) / period;
    out[i + 1] = rma;
  }
  return out;
}

/** 1 = bullish SMA cross, -1 = bearish, 0 = none (warmup-safe). */
export function maCross(candles: Candle[], fast = 9, slow = 21): number[] {
  const cl = closes(candles);
  const f = sma(cl, fast);
  const s = sma(cl, slow);
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
 * Kept as an alias for the quant feature vector's historical name. New code
 * should call `maCross` directly.
 */
export function maCrossSignal(candles: Candle[], fast = 9, slow = 21): number[] {
  return maCross(candles, fast, slow);
}
