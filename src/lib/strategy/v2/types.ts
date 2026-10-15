import type { Candle, StrategySignal } from "@/lib/types";

export interface ChandelierDonchianConfig {
  chandelier: {
    atrLength: number;
    multiplier: number;
  };
  donchian: {
    periods: number[];
  };
  heikinAshi: boolean;
  timeStop: {
    enabled: boolean;
    bars: number;
  };
  risk: {
    leverage: number;
    riskPct: number;
    lotSize: number | null;
    maxPositions: number;
    mode: "auto" | "manual";
  };
}

export const DEFAULT_CHANDELIER_DONCHIAN_CONFIG: ChandelierDonchianConfig = {
  chandelier: {
    atrLength: 1,
    multiplier: 2.0,
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

export interface HeikinAshiCandle extends Candle {
  haOpen: number;
  haHigh: number;
  haLow: number;
  haClose: number;
  haColor: "green" | "red";
}

export interface ChandelierResult {
  longStop: number[];
  shortStop: number[];
  trend: ("long" | "short")[];
}

export interface DonchianResult {
  upper: number[][];
  lower: number[][];
  trend: ("green" | "red" | "neutral")[];
  middle: number[][];
}

export interface SignalState {
  signal: StrategySignal | null;
  haColor: "green" | "red" | null;
  donchianState: {
    trend: "green" | "red" | "neutral";
    periods: Record<number, { upper: number; lower: number; middle: number }>;
  };
  chandelierState: {
    trend: "long" | "short" | null;
    longStop: number | null;
    shortStop: number | null;
  };
  entry: number | null;
  stop: number | null;
  target: number | null;
  rr: number | null;
  barsSinceEntry: number | null;
}

export interface PositionSizingResult {
  qty: number;
  riskAmount: number;
  riskPct: number;
  leverage: number;
  entry: number;
  stop: number;
}

export interface BacktestResult {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  expectancy: number;
  profitFactor: number | null;
  maxDrawdown: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  dsr: number | null;
  avgWin: number;
  avgLoss: number;
  avgHoldBars: number;
  trades: BacktestTrade[];
}

export interface BacktestTrade {
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  side: "long" | "short";
  qty: number;
  pnl: number;
  pnlPct: number;
  exitReason: "chandelier" | "opposite" | "time_stop" | "end_of_data";
  barsHeld: number;
}

export interface BacktestConfig {
  initialCapital: number;
  leverage: number;
  riskPct: number;
  feeRate: number;
  slippage: number;
}
/** Bound indicator work and reject NaN/zero windows before calculating. */
export function validateStrategyConfig(config: ChandelierDonchianConfig): void {
  const integer = (n: number, min: number, max: number) => Number.isInteger(n) && n >= min && n <= max;
  if (!config || !config.chandelier || !config.donchian || !config.risk || !config.timeStop ||
      !integer(config.chandelier.atrLength, 1, 400) ||
      !Number.isFinite(config.chandelier.multiplier) || config.chandelier.multiplier <= 0 || config.chandelier.multiplier > 100 ||
      !Array.isArray(config.donchian.periods) || !config.donchian.periods.length || config.donchian.periods.length > 8 ||
      !config.donchian.periods.every(p => integer(p, 1, 400)) ||
      typeof config.heikinAshi !== "boolean" || typeof config.timeStop.enabled !== "boolean" ||
      !integer(config.timeStop.bars, 1, 10000) || !integer(config.risk.maxPositions, 1, 50) ||
      !Number.isFinite(config.risk.leverage) || config.risk.leverage < 1 || config.risk.leverage > 50 ||
      !Number.isFinite(config.risk.riskPct) || config.risk.riskPct <= 0 || config.risk.riskPct > 100 ||
      !["auto", "manual"].includes(config.risk.mode) ||
      (config.risk.lotSize !== null && (!Number.isFinite(config.risk.lotSize) || config.risk.lotSize <= 0)) ||
      (config.risk.mode === "manual" && config.risk.lotSize === null)) {
    throw new Error("Invalid strategy configuration: check indicator periods and risk limits");
  }
}
