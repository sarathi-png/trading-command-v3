/** Ranking and conservative setup assessment are independent, testable steps. */
import type { Candle, Ticker } from "../types";
import { buildAiContext } from "../ai/context";
import { ruleVerdict } from "../ai/rules";
export interface MoverAssessment {
  stance: "BUY-SIDE CANDIDATE" | "SELL-SIDE CANDIDATE" | "WAIT";
  reasons: string[];
  entry: number | null;
  stop: number | null;
  barTime: number | null;
}
export interface MoverRow {
  ticker: Ticker;
  assessment: MoverAssessment;
}
export interface MoversReport {
  gainers: MoverRow[];
  losers: MoverRow[];
  universe: number;
  excluded: number;
  source: "live" | "demo";
  asOf: number;
  scope: string;
}
export function rankMovers(tickers: Ticker[], now = Date.now()) {
  const valid = [
    ...new Map(
      tickers
        .filter(
          (t) =>
            t.change24hAvailable !== false &&
            Number.isFinite(t.change24hPct) &&
            Number.isFinite(t.price) &&
            t.price > 0 &&
            Number.isFinite(t.volume24hUsd) &&
            t.volume24hUsd > 0 &&
            !t.stale &&
            Number.isFinite(t.ts) &&
            now - t.ts < 120_000 &&
            t.ts <= now + 60_000,
        )
        .map((t) => [t.symbol, t]),
    ).values(),
  ];
  const gainers = valid
    .filter((t) => t.change24hPct > 0)
    .sort(
      (a, b) =>
        b.change24hPct - a.change24hPct || a.symbol.localeCompare(b.symbol),
    )
    .slice(0, 10);
  const losers = valid
    .filter((t) => t.change24hPct < 0)
    .sort(
      (a, b) =>
        a.change24hPct - b.change24hPct || a.symbol.localeCompare(b.symbol),
    )
    .slice(0, 10);
  return { gainers, losers, excluded: tickers.length - valid.length };
}
export function assessMover(
  symbol: string,
  candles: Candle[],
  now = Date.now(),
): MoverAssessment {
  const closed = candles.filter((c) => (c.time + 300) * 1000 <= now);
  const last = closed.at(-1);
  const wait = (reasons: string[]): MoverAssessment => ({
    stance: "WAIT",
    reasons,
    entry: last?.close ?? null,
    stop: null,
    barTime: last ? last.time * 1000 : null,
  });
  if (!last || closed.length < 250)
    return wait(["Insufficient closed 5-minute candles; no setup assessment."]);
  if (now - (last.time + 300) * 1000 > 600000)
    return wait(["Candle evidence is stale."]);
  const input = { symbol, timeframe: "5m", candles: closed };
  const raw = buildAiContext({ ...input, chartType: "candles" }),
    ha = buildAiContext({ ...input, chartType: "heikin-ashi" });
  const a = ruleVerdict(raw),
    b = ruleVerdict(ha);
  const reasons = [
    `Normal chart: ${a.direction}; Heikin-Ashi + Chandelier/Donchian: ${b.direction}.`,
  ];
  const technical = raw.technical!;
  if (a.direction === "NEUTRAL" || a.direction !== b.direction)
    return wait([
      ...reasons,
      "The two chart views do not agree on a direction.",
    ]);
  if (technical.indicators.adx14 === null || technical.indicators.adx14 < 20)
    return wait([
      ...reasons,
      "Average Directional Index 14 is below 20 or unavailable; weak trend strength.",
    ]);
  if (
    !technical.strategies.some(
      (s) => s.name.startsWith("VWAP + RSI") && s.direction === a.direction,
    )
  )
    return wait([
      ...reasons,
      "Volume Weighted Average Price / Relative Strength Index / EMA 21 confirmation is incomplete.",
    ]);
  const stop = a.invalidation;
  if (
    stop === null ||
    !Number.isFinite(stop) ||
    (a.direction === "LONG" ? stop >= last.close : stop <= last.close)
  )
    return wait([
      ...reasons,
      "No valid invalidation price; wait rather than invent a stop.",
    ]);
  return {
    stance:
      a.direction === "LONG" ? "BUY-SIDE CANDIDATE" : "SELL-SIDE CANDIDATE",
    reasons: [
      ...reasons,
      "Trend strength and VWAP / RSI / EMA 21 agree. Review liquidity, spread, fees, funding and position risk before any decision.",
    ],
    entry: last.close,
    stop,
    barTime: last.time * 1000,
  };
}
