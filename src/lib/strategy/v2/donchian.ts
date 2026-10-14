import type { Candle } from "@/lib/types";
import type { DonchianResult } from "./types";

export function donchianRibbon(
  candles: Candle[],
  periods: number[] = [20, 50, 100, 200]
): DonchianResult {
  const upper: number[][] = periods.map(() => new Array(candles.length).fill(NaN));
  const lower: number[][] = periods.map(() => new Array(candles.length).fill(NaN));
  const middle: number[][] = periods.map(() => new Array(candles.length).fill(NaN));
  const trend: ("green" | "red" | "neutral")[] = new Array(candles.length).fill("neutral");

  for (let pIdx = 0; pIdx < periods.length; pIdx++) {
    const period = periods[pIdx];

    for (let i = 0; i < candles.length; i++) {
      if (i < period) {
        upper[pIdx][i] = NaN;
        lower[pIdx][i] = NaN;
        middle[pIdx][i] = NaN;
        continue;
      }

      let highestHigh = -Infinity;
      let lowestLow = Infinity;

      for (let j = i - period; j < i; j++) {
        highestHigh = Math.max(highestHigh, candles[j].high);
        lowestLow = Math.min(lowestLow, candles[j].low);
      }

      upper[pIdx][i] = highestHigh;
      lower[pIdx][i] = lowestLow;
      middle[pIdx][i] = (highestHigh + lowestLow) / 2;
    }
  }

  for (let i = 0; i < candles.length; i++) {
    const close = candles[i].close;
    let allGreen = true;
    let allRed = true;

    for (let pIdx = 0; pIdx < periods.length; pIdx++) {
      const u = upper[pIdx][i];
      const l = lower[pIdx][i];

      if (isNaN(u) || isNaN(l)) {
        allGreen = false;
        allRed = false;
        break;
      }

      if (close <= u) allGreen = false;
      if (close >= l) allRed = false;
    }

    if (allGreen) trend[i] = "green";
    else if (allRed) trend[i] = "red";
    else trend[i] = trend[i - 1] || "neutral";
  }

  return { upper, lower, middle, trend };
}

export function getDonchianState(
  candles: Candle[],
  periods: number[] = [20, 50, 100, 200]
): {
  trend: "green" | "red" | "neutral";
  periods: Record<number, { upper: number; lower: number; middle: number }>;
} {
  const result = donchianRibbon(candles, periods);
  const lastIdx = candles.length - 1;
  const trend = result.trend[lastIdx] ?? "neutral";

  const periodsState: Record<number, { upper: number; lower: number; middle: number }> = {};
  for (let pIdx = 0; pIdx < periods.length; pIdx++) {
    periodsState[periods[pIdx]] = {
      upper: result.upper[pIdx][lastIdx],
      lower: result.lower[pIdx][lastIdx],
      middle: result.middle[pIdx][lastIdx],
    };
  }

  return { trend, periods: periodsState };
}