/**
 * Candle validation.
 *
 * Venue data is untrusted input. A single NaN, a duplicated timestamp or a
 * high that is below the low silently poisons every indicator downstream, so
 * bars are validated once at the data boundary and rejected explicitly.
 */
import type { Candle } from "../types";

export interface CandleValidationOptions {
  /** Bar length in seconds; used to reject timestamps in the future. */
  timeframeSeconds?: number;
  /** Injectable clock for tests. */
  nowMs?: number;
}

export interface CandleValidationResult {
  candles: Candle[];
  /** Number of input bars dropped as invalid or duplicate. */
  rejected: number;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** A structurally valid OHLCV bar. */
export function isValidCandle(candle: Candle): boolean {
  return (
    finite(candle.time) &&
    candle.time > 0 &&
    finite(candle.open) &&
    finite(candle.high) &&
    finite(candle.low) &&
    finite(candle.close) &&
    finite(candle.volume) &&
    candle.volume >= 0 &&
    candle.high >= candle.low &&
    candle.high >= candle.open &&
    candle.high >= candle.close &&
    candle.low <= candle.open &&
    candle.low <= candle.close
  );
}

/**
 * Validate, de-duplicate (last bar wins) and sort ascending by open time.
 * Bars dated in the future beyond one interval are rejected: they are almost
 * always a venue/clock bug and would make "last price" meaningless.
 */
export function validateCandles(
  raw: Candle[],
  options: CandleValidationOptions = {}
): CandleValidationResult {
  const nowSec = Math.floor((options.nowMs ?? Date.now()) / 1000);
  const interval = options.timeframeSeconds ?? 0;
  const latestAllowed = interval > 0 ? nowSec + interval : nowSec + 60;

  const byTime = new Map<number, Candle>();
  let rejected = 0;
  for (const candle of raw) {
    if (!isValidCandle(candle) || candle.time > latestAllowed) {
      rejected += 1;
      continue;
    }
    byTime.set(candle.time, candle);
  }

  const candles = [...byTime.values()].sort((a, b) => a.time - b.time);
  rejected += raw.length - candles.length - rejected;
  return { candles, rejected };
}
