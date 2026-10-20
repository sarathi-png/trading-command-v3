import type { Candle, StrategySignal, Timeframe } from "@/lib/types";
import { DEFAULT_CHANDELIER_DONCHIAN_CONFIG, validateStrategyConfig } from "./types";
import type { ChandelierDonchianConfig, SignalState, PositionSizingResult, HeikinAshiCandle } from "./types";
import { toHeikinAshi, haColor } from "./heikin-ashi";
import { getChandelierSignal } from "./chandelier";
import { getDonchianState } from "./donchian";

export interface SignalInput {
  marketClose: number;
  /** Unix seconds of the decision bar. */
  timestamp: number;
  chandelierSignal: "buy" | "sell" | "none";
  longStop: number;
  shortStop: number;
  donchianTrend: "green" | "red" | "neutral";
  haColor: "green" | "red";
  periods: number[];
}

/**
 * Pure state→signal decision shared by the single-bar evaluator and the
 * backtest. The backtest precomputes the chandelier/donchian arrays once, so it
 * does not recompute every indicator from bar zero on every iteration.
 */
export function decideSignal(input: SignalInput): StrategySignal {
  const chandelierBuy = input.chandelierSignal === "buy";
  const chandelierSell = input.chandelierSignal === "sell";
  const donchianGreen = input.donchianTrend === "green";
  const donchianRed = input.donchianTrend === "red";
  const haGreen = input.haColor === "green";
  const haRed = input.haColor === "red";

  let status: StrategySignal["status"] = "WAIT";
  let reasons: string[] = [];
  let entry: number | null = null;
  let stop: number | null = null;
  let target: number | null = null;

  if (chandelierBuy && haGreen && donchianGreen) {
    status = "LONG_SETUP";
    entry = input.marketClose;
    stop = input.longStop;
    target = entry + 2 * (entry - stop);
    reasons = [
      "Chandelier Exit: BUY signal (price above trailing stop)",
      "Heikin Ashi: GREEN candle (bullish)",
      `Donchian Ribbon: GREEN (price above all periods: ${input.periods.join(", ")})`,
    ];
  } else if (chandelierSell && haRed && donchianRed) {
    status = "SHORT_SETUP";
    entry = input.marketClose;
    stop = input.shortStop;
    target = entry - 2 * (stop - entry);
    reasons = [
      "Chandelier Exit: SELL signal (price below trailing stop)",
      "Heikin Ashi: RED candle (bearish)",
      `Donchian Ribbon: RED (price below all periods: ${input.periods.join(", ")})`,
    ];
  } else {
    const failed: string[] = [];
    if (!chandelierBuy && !chandelierSell) failed.push("Chandelier: No clear signal");
    else if (chandelierBuy && !haGreen) failed.push("Chandelier BUY but HA not GREEN");
    else if (chandelierSell && !haRed) failed.push("Chandelier SELL but HA not RED");

    if (!donchianGreen && !donchianRed) failed.push("Donchian: Mixed/neutral");
    else if (donchianGreen && !haGreen) failed.push("Donchian GREEN but HA not GREEN");
    else if (donchianRed && !haRed) failed.push("Donchian RED but HA not RED");

    if (chandelierBuy && haGreen && !donchianGreen) {
      status = "WATCH";
      reasons = ["Chandelier BUY + HA GREEN, waiting for Donchian alignment"];
    } else if (chandelierSell && haRed && !donchianRed) {
      status = "WATCH";
      reasons = ["Chandelier SELL + HA RED, waiting for Donchian alignment"];
    } else {
      reasons = failed.length ? failed : ["No setup conditions met"];
    }
  }

  const wait = (reason: string): StrategySignal => ({
    symbol: "", timeframe: "5m" as Timeframe, strategy: "chandelier_donchian",
    status: "WAIT", price: input.marketClose, entry: null, stop: null, target: null,
    rr: null, reasons: [reason], ts: input.timestamp * 1000,
  });

  if (entry !== null && stop !== null && target !== null &&
      (!Number.isFinite(stop) || !Number.isFinite(target) || target <= 0 ||
       (status === "LONG_SETUP" ? stop >= entry : stop <= entry))) {
    return wait("Invalid stop geometry at the executable market price");
  }
  let rr: number | null = null;
  if (entry !== null && stop !== null && target !== null && entry !== stop) {
    rr = Math.abs(target - entry) / Math.abs(entry - stop);
  }

  return {
    symbol: "", timeframe: "5m" as Timeframe, strategy: "chandelier_donchian",
    status, price: input.marketClose, entry, stop, target,
    rr: rr !== null ? Number(rr.toFixed(2)) : null,
    reasons, ts: input.timestamp * 1000,
  };
}

export function evaluateChandelierDonchian(
  candles: Candle[],
  config: ChandelierDonchianConfig = DEFAULT_CHANDELIER_DONCHIAN_CONFIG
): StrategySignal {
  validateStrategyConfig(config);
  if (candles.length < Math.max(...config.donchian.periods) + 50) {
    return createWaitSignal(candles, "Insufficient data for indicators");
  }

  const haCandles: Candle[] = config.heikinAshi ? toHeikinAshi(candles) : candles;
  const lastIdx = haCandles.length - 1;
  const lastCandle = haCandles[lastIdx];
  const marketClose = candles[lastIdx].close;

  const chandelier = getChandelierSignal(
    haCandles,
    config.chandelier.atrLength,
    config.chandelier.multiplier
  );

  const donchian = getDonchianState(haCandles, config.donchian.periods);

  const haColorLast = config.heikinAshi ? haColor(lastCandle as HeikinAshiCandle) : (lastCandle.close >= lastCandle.open ? "green" : "red");

  return decideSignal({
    marketClose,
    timestamp: lastCandle.time,
    chandelierSignal: chandelier.signal,
    longStop: chandelier.longStop,
    shortStop: chandelier.shortStop,
    donchianTrend: donchian.trend,
    haColor: haColorLast,
    periods: config.donchian.periods,
  });
}

function createWaitSignal(candles: Candle[], reason: string): StrategySignal {
  const last = candles[candles.length - 1];
  return {
    symbol: "",
    timeframe: "5m" as Timeframe,
    strategy: "chandelier_donchian",
    status: "WAIT",
    price: last?.close ?? 0,
    entry: null,
    stop: null,
    target: null,
    rr: null,
    reasons: [reason],
    ts: last?.time ? last.time * 1000 : Date.now(),
  };
}

export function getSignalState(
  candles: Candle[],
  config: ChandelierDonchianConfig = DEFAULT_CHANDELIER_DONCHIAN_CONFIG
): SignalState {
  validateStrategyConfig(config);
  if (candles.length < Math.max(...config.donchian.periods) + 50) {
    return createEmptySignalState();
  }

  const haCandles: Candle[] = config.heikinAshi ? toHeikinAshi(candles) : candles;
  const lastIdx = haCandles.length - 1;
  const lastCandle = haCandles[lastIdx];

  const chandelier = getChandelierSignal(
    haCandles,
    config.chandelier.atrLength,
    config.chandelier.multiplier
  );

  const donchian = getDonchianState(haCandles, config.donchian.periods);
  const haColorLast = config.heikinAshi ? haColor(lastCandle as HeikinAshiCandle) : (lastCandle.close >= lastCandle.open ? "green" : "red");

  const signal = evaluateChandelierDonchian(candles, config);

  return {
    signal,
    haColor: haColorLast,
    donchianState: donchian,
    chandelierState: {
      trend: chandelier.trend,
      longStop: chandelier.longStop,
      shortStop: chandelier.shortStop,
    },
    entry: signal.entry,
    stop: signal.stop,
    target: signal.target,
    rr: signal.rr,
    barsSinceEntry: null,
  };
}

function createEmptySignalState(): SignalState {
  return {
    signal: null,
    haColor: null,
    donchianState: { trend: "neutral", periods: {} },
    chandelierState: { trend: null, longStop: null, shortStop: null },
    entry: null,
    stop: null,
    target: null,
    rr: null,
    barsSinceEntry: null,
  };
}

export function calculatePositionSize(
  equity: number,
  entry: number,
  stop: number,
  config: ChandelierDonchianConfig["risk"]
): PositionSizingResult {
  if (![equity, entry, stop, config.riskPct, config.leverage].every(Number.isFinite) ||
      equity <= 0 || entry <= 0 || stop <= 0 || entry === stop ||
      config.riskPct <= 0 || config.riskPct > 100 || config.leverage <= 0 ||
      (config.mode === "manual" && (config.lotSize === null || !Number.isFinite(config.lotSize) || config.lotSize <= 0))) {
    return { qty: 0, riskAmount: 0, riskPct: 0, leverage: config.leverage, entry, stop };
  }
  const riskPerUnit = Math.abs(entry - stop);
  const requested = config.mode === "manual" ? config.lotSize! : equity * config.riskPct / 100 / riskPerUnit;
  // Floor rather than round: rounding up can exceed the risk/margin budget.
  const qty = Math.floor(Math.min(requested, equity * config.leverage / entry) * 10000) / 10000;
  const riskAmount = qty * riskPerUnit;
  return { qty, riskAmount: Number(riskAmount.toFixed(2)), riskPct: riskAmount / equity * 100,
    leverage: config.leverage, entry, stop };
}

export { DEFAULT_CHANDELIER_DONCHIAN_CONFIG } from "./types";
