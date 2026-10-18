/**
 * Public API of the Pine runtime.
 *
 *   const result = runPine(source, candles, { symbol, timeframe });
 *
 * `runPine` never throws for a bad script: compile errors and runtime errors
 * come back in `result.errors` so the app can show them next to the editor.
 */
import { PineSyntaxError } from "./lexer";
import { parsePine } from "./parser";
import { PineEvaluator, type PineError, type PineRunOptions, type PineRunResult } from "./evaluator";
import type { BarData } from "./ta";
import type { PineValue } from "./values";

export type { PineRunOptions, PineRunResult, PineError, BarData };
export type { PinePlotResult, PineShapeResult, PineHLine } from "./evaluator";
export type { StrategyTrade, StrategyStats } from "./strategy";
export type { PineInput } from "./host";

export interface PineCompileResult extends PineRunResult {
  /** True when the script could not even be parsed. */
  compileFailed: boolean;
}

/**
 * Parse and execute a Pine Script over a series of bars.
 */
export function runPine(
  source: string,
  bars: BarData[],
  options: PineRunOptions = {}
): PineCompileResult {
  let program;
  try {
    program = parsePine(source);
  } catch (error) {
    const message = error instanceof PineSyntaxError
      ? error.message
      : error instanceof Error
        ? error.message
        : String(error);
    return emptyResult([{ message }], true);
  }

  const evaluator = new PineEvaluator(program, options);
  const result = evaluator.run(bars);
  return { ...result, compileFailed: false };
}

/** A result object for a script that failed to compile. */
export function emptyResult(errors: PineError[], compileFailed = false): PineCompileResult {
  return {
    ok: false,
    compileFailed,
    meta: { title: "Untitled script", shorttitle: "", type: "script", overlay: false },
    inputs: [],
    plots: [],
    shapes: [],
    hlines: [],
    alerts: [],
    alertConditions: [],
    trades: [],
    stats: null,
    errors,
    warnings: [],
    barCount: 0,
  };
}

/** Convert app candles into the runtime's bar shape. */
export function toBars(candles: Array<{
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}>): BarData[] {
  return candles.map((candle) => ({
    time: candle.time,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
  }));
}

export { PineSyntaxError };
export type { PineValue };
