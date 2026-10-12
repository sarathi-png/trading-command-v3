import type { Candle, StrategySignal, Timeframe } from "@/lib/types";

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
  trend: ("green" | "red")[];
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
  profitFactor: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  dsr: number;
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