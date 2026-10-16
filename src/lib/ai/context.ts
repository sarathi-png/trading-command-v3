/**
 * Evidence snapshot for the AI predictor.
 *
 * One deterministic function turns candles into the numbers a model reasons
 * over. Doing this locally (instead of asking the model to compute indicators
 * from raw prices) means:
 *   - the model cannot invent an ATR or a Donchian level that is not on screen
 *   - the same snapshot is stored with the prediction, so a later review can
 *     see exactly what the model was shown
 *   - the whole module is pure: no clock, no network, unit-testable
 */
import { analyseTechnical } from "./technical";
import type { Candle } from "@/lib/types";
import { toHeikinAshi } from "../strategy/v2/heikin-ashi";
import { getChandelierSignal } from "../strategy/v2/chandelier";
import { getDonchianState } from "../strategy/v2/donchian";
import { wilderAtr } from "../strategy/v2/chandelier";
import type { AiChartType, AiContext } from "./types";

export interface BuildContextInput {
  symbol: string;
  timeframe: string;
  chartType: AiChartType;
  /** Closed candles, oldest first. */
  candles: Candle[];
  atrLength?: number;
  multiplier?: number;
  donchianPeriods?: number[];
}

function finiteOrNull(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

/**
 * Build the snapshot. Throws only when there is genuinely nothing to look at —
 * a partially warmed-up series still yields a usable (if less confident) view,
 * because the model is told which indicators are missing.
 */
export function buildAiContext(input: BuildContextInput): AiContext {
  const { symbol, timeframe, chartType, candles } = input;
  const atrLength = input.atrLength ?? 1;
  const multiplier = input.multiplier ?? 2.0;
  const periods = input.donchianPeriods ?? [20, 50, 100, 200];

  if (!candles.length) throw new Error("No candles available for the AI snapshot");

  const last = candles[candles.length - 1];
  const lastClose = last.close;

  // Chandelier Exit and the Donchian ribbon follow the strategy engine's own
  // choice: they are computed on Heikin-Ashi candles when the strategy runs in
  // Heikin-Ashi mode, on raw candles otherwise.
  const series: Candle[] = chartType === "heikin-ashi" ? (toHeikinAshi(candles) as unknown as Candle[]) : candles;

  const atrSeries = wilderAtr(series, atrLength);
  const atr = finiteOrNull(atrSeries[atrSeries.length - 1]);

  let chandelier: AiContext["chandelier"] = {
    trend: null, signal: "none", longStop: null, shortStop: null, stopDistanceAtr: null,
  };
  try {
    const ch = getChandelierSignal(series, atrLength, multiplier);
    const active = ch.signal === "buy" ? ch.longStop : ch.signal === "sell" ? ch.shortStop : NaN;
    chandelier = {
      trend: ch.trend,
      signal: ch.signal,
      longStop: finiteOrNull(ch.longStop),
      shortStop: finiteOrNull(ch.shortStop),
      stopDistanceAtr: atr && Number.isFinite(active) ? Number((Math.abs(lastClose - active) / atr).toFixed(2)) : null,
    };
  } catch {
    // A short series cannot produce a trailing stop; the model is told so.
  }

  let donchian: AiContext["donchian"] = { trend: "neutral", periods: {}, alignedPeriods: 0 };
  try {
    const dc = getDonchianState(series, periods);
    const cleanPeriods: Record<number, { upper: number; lower: number; middle: number }> = {};
    let aligned = 0;
    for (const p of periods) {
      const row = dc.periods[p];
      if (!row) continue;
      const upper = finiteOrNull(row.upper);
      const lower = finiteOrNull(row.lower);
      const middle = finiteOrNull(row.middle);
      if (upper === null || lower === null) continue;
      cleanPeriods[p] = { upper, lower, middle: middle ?? Number(((upper + lower) / 2).toFixed(6)) };
      if (lastClose > upper || lastClose < lower) aligned++;
    }
    donchian = { trend: dc.trend, periods: cleanPeriods, alignedPeriods: aligned };
  } catch {
    // Never let an indicator warmup break the prediction path.
  }

  // Heikin-Ashi colour streak: how many consecutive same-colour HA candles.
  let haColor: "green" | "red" | null = null;
  let consecutive = 0;
  if (series.length) {
    const ha = toHeikinAshi(candles);
    const colors = ha.map((c) => c.haColor);
    haColor = colors[colors.length - 1] ?? null;
    for (let i = colors.length - 1; i >= 0 && colors[i] === haColor; i--) consecutive++;
  }

  const lookback = Math.min(20, candles.length);
  const window = candles.slice(-lookback);
  const rangeHigh = Math.max(...window.map((c) => c.high));
  const rangeLow = Math.min(...window.map((c) => c.low));
  const firstOfWindow = window[0];
  const changePct = firstOfWindow.open !== 0 ? ((lastClose - firstOfWindow.open) / firstOfWindow.open) * 100 : 0;

  // Simple structure tally: closes making higher highs / lower lows over the window.
  let higherHighs = 0;
  let lowerLows = 0;
  for (let i = 1; i < window.length; i++) {
    if (window[i].high > window[i - 1].high) higherHighs++;
    if (window[i].low < window[i - 1].low) lowerLows++;
  }

  return {
    technical: analyseTechnical(candles),
    symbol,
    timeframe,
    chartType,
    bars: candles.length,
    lastBarTime: last.time * 1000,
    lastClose,
    atrLength,
    chandelierMultiplier: multiplier,
    indicatorSignature: `atr:${atrLength};mult:${multiplier};dc:${periods.join(",")}`,
    atr,
    atrPct: atr && lastClose ? Number(((atr / lastClose) * 100).toFixed(3)) : null,
    chandelier,
    donchian,
    heikinAshi: { color: haColor, consecutive },
    priceAction: {
      changePct: Number(changePct.toFixed(3)),
      rangeHigh: Number(rangeHigh.toFixed(6)),
      rangeLow: Number(rangeLow.toFixed(6)),
      higherHighs,
      lowerLows,
    },
  };
}
