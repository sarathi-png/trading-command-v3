import type { Candle } from "@/lib/types";
import { atr as atrSeries } from "../../indicators";
import type { ChandelierResult } from "./types";

/**
 * NaN-flavoured view of the canonical Wilder ATR. The strategy/chart code
 * predates the shared module and uses NaN as "unavailable"; the values are the
 * same series, not a second implementation.
 */
export function wilderAtr(candles: Candle[], period: number): number[] {
  return atrSeries(candles, period).map((v) => v ?? NaN);
}

export function chandelierExit(
  candles: Candle[],
  atrLength: number = 1,
  multiplier: number = 2.0
): ChandelierResult {
  const atr = wilderAtr(candles, atrLength);
  const longStop: number[] = new Array(candles.length).fill(NaN);
  const shortStop: number[] = new Array(candles.length).fill(NaN);
  const trend: ("long" | "short")[] = new Array(candles.length).fill("long");

  let currentTrend: "long" | "short" = "long";
  for (let i = 0; i < candles.length; i++) {
    if (!Number.isFinite(atr[i])) continue;
    const window = candles.slice(Math.max(0, i - atrLength + 1), i + 1);
    const rawLong = Math.max(...window.map(c => c.high)) - multiplier * atr[i];
    const rawShort = Math.min(...window.map(c => c.low)) + multiplier * atr[i];
    const previousLong = longStop[i - 1];
    const previousShort = shortStop[i - 1];
    const previousClose = candles[i - 1]?.close;
    longStop[i] = Number.isFinite(previousLong) && previousClose > previousLong
      ? Math.max(rawLong, previousLong) : rawLong;
    shortStop[i] = Number.isFinite(previousShort) && previousClose < previousShort
      ? Math.min(rawShort, previousShort) : rawShort;
    // A close crosses a stop known BEFORE this candle, not a future-adjusted stop.
    if (Number.isFinite(previousShort) && candles[i].close > previousShort) currentTrend = "long";
    else if (Number.isFinite(previousLong) && candles[i].close < previousLong) currentTrend = "short";
    trend[i] = currentTrend;
  }

  return { longStop, shortStop, trend };
}

export function getChandelierSignal(
  candles: Candle[],
  atrLength: number = 1,
  multiplier: number = 2.0
): { signal: "buy" | "sell" | "none"; longStop: number; shortStop: number; trend: "long" | "short" } {
  const result = chandelierExit(candles, atrLength, multiplier);
  const lastIdx = candles.length - 1;
  const trend = result.trend[lastIdx];
  const longStop = result.longStop[lastIdx];
  const shortStop = result.shortStop[lastIdx];

  if (trend === "long" && !isNaN(longStop)) {
    return { signal: "buy", longStop, shortStop: NaN, trend: "long" };
  } else if (trend === "short" && !isNaN(shortStop)) {
    return { signal: "sell", longStop: NaN, shortStop, trend: "short" };
  }

  return { signal: "none", longStop: NaN, shortStop: NaN, trend: "long" };
}