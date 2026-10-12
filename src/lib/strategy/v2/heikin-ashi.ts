import type { Candle } from "@/lib/types";
import type { HeikinAshiCandle } from "./types";

export function toHeikinAshi(candles: Candle[]): HeikinAshiCandle[] {
  if (!candles.length) return [];

  const ha: HeikinAshiCandle[] = [];

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    let haOpen: number;
    let haClose: number;
    let haHigh: number;
    let haLow: number;

    if (i === 0) {
      haOpen = (c.open + c.close) / 2;
      haClose = (c.open + c.high + c.low + c.close) / 4;
    } else {
      const prev = ha[i - 1];
      haOpen = (prev.haOpen + prev.haClose) / 2;
      haClose = (c.open + c.high + c.low + c.close) / 4;
    }

    haHigh = Math.max(c.high, haOpen, haClose);
    haLow = Math.min(c.low, haOpen, haClose);

    const haColor = haClose >= haOpen ? "green" : "red";

    ha.push({
      time: c.time,
      open: haOpen,
      high: haHigh,
      low: haLow,
      close: haClose,
      volume: c.volume,
      haOpen,
      haHigh,
      haLow,
      haClose,
      haColor,
    });
  }

  return ha;
}

export function haColor(candle: HeikinAshiCandle): "green" | "red" {
  return candle.haColor;
}

export function isHaBullish(candle: HeikinAshiCandle): boolean {
  return candle.haClose >= candle.haOpen;
}

export function isHaBearish(candle: HeikinAshiCandle): boolean {
  return candle.haClose < candle.haOpen;
}

export function haBodySize(candle: HeikinAshiCandle): number {
  return Math.abs(candle.haClose - candle.haOpen);
}

export function haUpperWick(candle: HeikinAshiCandle): number {
  return candle.haHigh - Math.max(candle.haOpen, candle.haClose);
}

export function haLowerWick(candle: HeikinAshiCandle): number {
  return Math.min(candle.haOpen, candle.haClose) - candle.haLow;
}