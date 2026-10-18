/**
 * Small indicator helpers used by the chart screen.
 *
 * The maths matches the desktop engine (src/lib/strategy/engine.ts) so the
 * phone shows the same lines as the terminal.
 */
import type { Candle } from "../api/types";

export interface SeriesPoint {
  time: number;
  value: number;
}

/** Exponential moving average, seeded with the first value (as the engine does). */
export function emaSeries(candles: Candle[], period: number): SeriesPoint[] {
  const k = 2 / (period + 1);
  let previous = candles[0]?.close ?? 0;
  const out: SeriesPoint[] = [];
  for (const candle of candles) {
    previous = candle.close * k + previous * (1 - k);
    out.push({ time: candle.time, value: previous });
  }
  return out;
}

/** Simple moving average over the closes. */
export function smaSeries(candles: Candle[], period: number): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  let sum = 0;
  candles.forEach((candle, index) => {
    sum += candle.close;
    if (index >= period) sum -= candles[index - period].close;
    out.push({ time: candle.time, value: index >= period - 1 ? sum / period : Number.NaN });
  });
  return out;
}

/**
 * Heikin-Ashi candles, computed the same way as the desktop engine
 * (src/lib/strategy/v2/heikin-ashi.ts): the first candle seeds the averages.
 */
export function toHeikinAshi(candles: Candle[]): Candle[] {
  const out: Candle[] = [];
  let previousOpen = candles[0]?.open ?? 0;
  let previousClose = candles[0]?.close ?? 0;
  candles.forEach((candle, index) => {
    const close = (candle.open + candle.high + candle.low + candle.close) / 4;
    const open = index === 0 ? (candle.open + candle.close) / 2 : (previousOpen + previousClose) / 2;
    const high = Math.max(candle.high, open, close);
    const low = Math.min(candle.low, open, close);
    out.push({ time: candle.time, open, high, low, close, volume: candle.volume });
    previousOpen = open;
    previousClose = close;
  });
  return out;
}

/** Format a unix-seconds timestamp as a short local time. */
export function formatBarTime(seconds: number, timezone: string = "IST"): string {
  const date = new Date(seconds * 1000);
  if (timezone === "UTC") {
    return date.toISOString().slice(11, 16);
  }
  // IST is UTC+5:30, which is the market's home timezone.
  const ist = new Date(date.getTime() + (5.5 * 60 + date.getTimezoneOffset()) * 60_000);
  return `${String(ist.getHours()).padStart(2, "0")}:${String(ist.getMinutes()).padStart(2, "0")}`;
}
