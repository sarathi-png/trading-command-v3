export type ChartScope = "candles" | "heikin-ashi";
export function chartDrawingLayout(chartType: ChartScope) {
  return chartType === "heikin-ashi" ? "chart:heikin-ashi" : "chart:candles";
}
/** Untyped historical drawings belong to normal candles, never to smoothed HA. */
export function drawingBelongsToChart(layout: string, chartType: ChartScope): boolean {
  return chartType === "heikin-ashi" ? layout === "chart:heikin-ashi" : layout === "chart:candles" || layout === "default";
}

import type { Analysis, StrategySignal } from "./types";
export function activeChartSignal(signals: readonly StrategySignal[] | undefined): StrategySignal | undefined {
  return signals?.find(signal => signal.entry !== null && (signal.status === "LONG_SETUP" || signal.status === "SHORT_SETUP"));
}
export function analysisBelongsToChart(analysis: Analysis, chartType: ChartScope): boolean {
  return chartType === "heikin-ashi" ? analysis.chartType === "heikin-ashi" : analysis.chartType !== "heikin-ashi";
}
