/**
 * Timeframe → CoinDCX candle resolution.
 *
 * CoinDCX exposes only 1m, 5m, 15m, 1H, 4H and 1D. The app supports ten
 * timeframes, four of which have no venue equivalent (3m, 30m, 2H, 1W).
 *
 * The previous implementation fell through to "60", silently serving 1H bars
 * for 3m/30m/2H/1W requests. Those bars were then labelled and analysed as the
 * requested timeframe, which corrupts every indicator and signal derived from
 * them. This module fails loudly instead: a caller either gets the correct
 * resolution or an explicit error.
 */

import type { Timeframe } from "@/lib/types";

/** Resolution strings accepted by CoinDCX's candlesticks endpoint. */
export type CoinDcxResolution = "1" | "5" | "15" | "60" | "240" | "1D";

/** Every app timeframe and the only resolution we will accept for it. */
export const TIMEFRAME_RESOLUTIONS: Record<Timeframe, CoinDcxResolution | null> = {
  "1m": "1",
  "3m": null, // not published by CoinDCX
  "5m": "5",
  "15m": "15",
  "30m": null, // not published
  "1H": "60",
  "2H": null, // not published
  "4H": "240",
  "1D": "1D",
  "1W": null, // not published
};

export class UnsupportedTimeframeError extends Error {
  constructor(public readonly timeframe: string) {
    super(
      `CoinDCX does not publish ${timeframe} candles. Supported timeframes: 1m, 5m, 15m, 1H, 4H, 1D.`
    );
    this.name = "UnsupportedTimeframeError";
  }
}

/**
 * Map a timeframe in seconds to a CoinDCX resolution.
 *
 * @throws UnsupportedTimeframeError when the venue has no such resolution.
 */
export function resolutionForTimeframe(seconds: number): CoinDcxResolution {
  switch (seconds) {
    case 60:
      return "1";
    case 300:
      return "5";
    case 900:
      return "15";
    case 3600:
      return "60";
    case 14400:
      return "240";
    case 86400:
      return "1D";
    default:
      throw new UnsupportedTimeframeError(`${seconds}s`);
  }
}

/** Timeframes the UI may offer while live CoinDCX data is selected. */
export const SUPPORTED_TIMEFRAMES: Timeframe[] = ["1m", "5m", "15m", "1H", "4H", "1D"];

/** Whether the app can request real candles for this timeframe. */
export function isTimeframeSupported(timeframe: Timeframe): boolean {
  return TIMEFRAME_RESOLUTIONS[timeframe] !== null;
}
