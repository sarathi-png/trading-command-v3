/**
 * Trend-following core: Donchian breakout on the execution timeframe, filtered by a
 * regime (SMA) on a HIGHER timeframe. This single function is the decision rule for
 * BOTH the backtest and the live engine — there must be no second copy of it.
 *
 * Causality: every value used at bar i depends only on bars <= i (execution) and
 * HTF bars whose CLOSE time is <= the close time of bar i.
 */
import type { Candle } from "@/lib/types";
import { atr, sma } from "./indicators";

export interface TrendParams {
  donchian: number;     // breakout lookback (execution bars)
  atrPeriod: number;
  regimeSma: number;    // SMA length on the higher timeframe
  stopAtr: number;      // initial stop distance, in ATR
  trailAtr: number;     // chandelier trail distance, in ATR (ratchets only)
  maxBars: number;      // time stop, execution bars
}

export const DEFAULT_TREND: TrendParams = {
  donchian: 20, atrPeriod: 14, regimeSma: 100, stopAtr: 2, trailAtr: 3, maxBars: 300,
};

export interface TrendContext {
  ltf: Candle[];
  atr: (number | null)[];
  htfCloseIdx: number[];       // for each ltf bar: index of last CLOSED htf bar, or -1
  htfClose: number[];
  htfSma: (number | null)[];
}

/**
 * Build the causal context. ltfSec / htfSec are candle durations in seconds.
 * An HTF bar is usable at ltf bar i only if (htf.time + htfSec) <= (ltf[i].time + ltfSec).
 */
export function prepareTrend(
  ltf: Candle[], htf: Candle[], p: TrendParams, ltfSec: number, htfSec: number
): TrendContext {
  const htfClose = htf.map((c) => c.close);
  const htfCloseIdx: number[] = new Array(ltf.length).fill(-1);
  let k = -1;
  for (let i = 0; i < ltf.length; i++) {
    const closeTime = ltf[i].time + ltfSec;
    while (k + 1 < htf.length && htf[k + 1].time + htfSec <= closeTime) k++;
    htfCloseIdx[i] = k;
  }
  return {
    ltf,
    atr: atr(ltf, p.atrPeriod),
    htfCloseIdx,
    htfClose,
    htfSma: sma(htfClose, p.regimeSma),
  };
}

export interface TrendSignal {
  side: 1 | -1 | 0;
  atr: number | null;
  regime: "LONG" | "SHORT" | "NONE";
}

/** Decision at the CLOSE of ltf bar i. Entry is taken at the next bar's open by the caller. */
export function trendSignalAt(ctx: TrendContext, i: number, p: TrendParams): TrendSignal {
  const none: TrendSignal = { side: 0, atr: null, regime: "NONE" };
  if (i < p.donchian || i >= ctx.ltf.length) return none;
  const a = ctx.atr[i];
  const h = ctx.htfCloseIdx[i];
  if (a === null || h < 0) return none;
  const ma = ctx.htfSma[h];
  if (ma === null) return none;

  const regime: "LONG" | "SHORT" | "NONE" =
    ctx.htfClose[h] > ma ? "LONG" : ctx.htfClose[h] < ma ? "SHORT" : "NONE";
  if (regime === "NONE") return { side: 0, atr: a, regime };

  let hh = -Infinity, ll = Infinity;
  for (let j = i - p.donchian; j < i; j++) {
    if (ctx.ltf[j].high > hh) hh = ctx.ltf[j].high;
    if (ctx.ltf[j].low < ll) ll = ctx.ltf[j].low;
  }
  const c = ctx.ltf[i].close;
  if (regime === "LONG" && c > hh) return { side: 1, atr: a, regime };
  if (regime === "SHORT" && c < ll) return { side: -1, atr: a, regime };
  return { side: 0, atr: a, regime };
}
