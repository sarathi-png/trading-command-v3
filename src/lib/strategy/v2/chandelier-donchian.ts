import type { Candle, StrategySignal, Timeframe } from "@/lib/types";
import type { ChandelierDonchianConfig, SignalState, PositionSizingResult, HeikinAshiCandle } from "./types";
import { toHeikinAshi, haColor } from "./heikin-ashi";
import { chandelierExit, getChandelierSignal } from "./chandelier";
import { donchianRibbon, getDonchianState } from "./donchian";

export function evaluateChandelierDonchian(
  candles: Candle[],
  config: ChandelierDonchianConfig = DEFAULT_CHANDELIER_DONCHIAN_CONFIG
): StrategySignal {
  if (candles.length < Math.max(...config.donchian.periods) + 50) {
    return createWaitSignal(candles, "Insufficient data for indicators");
  }

  const haCandles: Candle[] = config.heikinAshi ? toHeikinAshi(candles) : candles;
  const lastIdx = haCandles.length - 1;
  const lastCandle = haCandles[lastIdx];
  const prevCandle = haCandles[lastIdx - 1];

  const chandelier = getChandelierSignal(
    haCandles,
    config.chandelier.atrLength,
    config.chandelier.multiplier
  );

  const donchian = getDonchianState(haCandles, config.donchian.periods);

  const haColorLast = config.heikinAshi ? haColor(lastCandle as HeikinAshiCandle) : (lastCandle.close >= lastCandle.open ? "green" : "red");
  const haColorPrev = prevCandle ? (config.heikinAshi ? haColor(prevCandle as HeikinAshiCandle) : (prevCandle.close >= prevCandle.open ? "green" : "red")) : haColorLast;

  const chandelierBuy = chandelier.signal === "buy";
  const chandelierSell = chandelier.signal === "sell";
  const donchianGreen = donchian.trend === "green";
  const donchianRed = donchian.trend === "red";
  const haGreen = haColorLast === "green";
  const haRed = haColorLast === "red";

  let status: StrategySignal["status"] = "WAIT";
  let reasons: string[] = [];
  let entry: number | null = null;
  let stop: number | null = null;
  let target: number | null = null;

  if (chandelierBuy && haGreen && donchianGreen) {
    status = "LONG_SETUP";
    entry = lastCandle.close;
    stop = chandelier.longStop;
    target = entry + 2 * (entry - stop);
    reasons = [
      "Chandelier Exit: BUY signal (price above trailing stop)",
      "Heikin Ashi: GREEN candle (bullish)",
      `Donchian Ribbon: GREEN (price above all periods: ${config.donchian.periods.join(", ")})`,
    ];
  } else if (chandelierSell && haRed && donchianRed) {
    status = "SHORT_SETUP";
    entry = lastCandle.close;
    stop = chandelier.shortStop;
    target = entry - 2 * (stop - entry);
    reasons = [
      "Chandelier Exit: SELL signal (price below trailing stop)",
      "Heikin Ashi: RED candle (bearish)",
      `Donchian Ribbon: RED (price below all periods: ${config.donchian.periods.join(", ")})`,
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

  let rr: number | null = null;
  if (entry !== null && stop !== null && target !== null && entry !== stop) {
    rr = Math.abs(target - entry) / Math.abs(entry - stop);
  }

  return {
    symbol: "",
    timeframe: "5m" as Timeframe,
    strategy: "chandelier_donchian",
    status,
    price: lastCandle.close,
    entry,
    stop,
    target,
    rr: rr !== null ? Number(rr.toFixed(2)) : null,
    reasons,
    ts: lastCandle.time * 1000,
  };
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
  const riskAmount = equity * (config.riskPct / 100);
  const riskPerUnit = Math.abs(entry - stop);

  let qty: number;
  if (config.mode === "manual" && config.lotSize !== null) {
    qty = config.lotSize;
  } else {
    qty = riskAmount / riskPerUnit;
  }

  const notional = qty * entry;
  const marginRequired = notional / config.leverage;

  if (marginRequired > equity) {
    qty = (equity * config.leverage) / entry;
  }

  return {
    qty: Number(qty.toFixed(4)),
    riskAmount: Number(riskAmount.toFixed(2)),
    riskPct: config.riskPct,
    leverage: config.leverage,
    entry,
    stop,
  };
}

export const DEFAULT_CHANDELIER_DONCHIAN_CONFIG: ChandelierDonchianConfig = {
  chandelier: {
    atrLength: 20,
    multiplier: 3.0,
  },
  donchian: {
    periods: [20, 50, 100, 200],
  },
  heikinAshi: true,
  timeStop: {
    enabled: true,
    bars: 48,
  },
  risk: {
    leverage: 10,
    riskPct: 1.0,
    lotSize: null,
    maxPositions: 1,
    mode: "auto",
  },
};