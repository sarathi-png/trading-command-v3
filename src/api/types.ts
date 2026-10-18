/**
 * Types shared with the desktop backend.
 *
 * These mirror the shapes returned by the Next.js API in the parent project
 * (src/lib/types.ts and the route handlers). The mobile app is a pure client
 * of that API — it never talks to CoinDCX directly.
 */

export type Timeframe = "1m" | "3m" | "5m" | "15m" | "30m" | "1H" | "2H" | "4H" | "1D" | "1W";

export const TIMEFRAMES: Timeframe[] = [
  "1m", "3m", "5m", "15m", "30m", "1H", "2H", "4H", "1D", "1W",
];

export const TF_MINUTES: Record<Timeframe, number> = {
  "1m": 1, "3m": 3, "5m": 5, "15m": 15, "30m": 30,
  "1H": 60, "2H": 120, "4H": 240, "1D": 1440, "1W": 10080,
};

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Ticker {
  symbol: string;
  price: number;
  markPrice: number | null;
  change24hPct: number;
  change24hAvailable?: boolean;
  volume24hUsd: number;
  fundingRate: number | null;
  openInterest: number | null;
  high24h: number | null;
  low24h: number | null;
  bid: number | null;
  ask: number | null;
  ts: number;
  source: "demo" | "live";
  stale?: boolean;
}

export interface OrderBookLevel { price: number; size: number }
export interface OrderBook {
  symbol: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  ts: number;
  source: "demo" | "live";
}

export type TrendState = "BULLISH" | "BEARISH" | "RANGE" | "UNCLEAR";
export type SignalStatus = "WAIT" | "WATCH" | "LONG_SETUP" | "SHORT_SETUP" | "INVALIDATED";

export interface StrategySignal {
  id?: string;
  symbol: string;
  timeframe: Timeframe;
  strategy: string;
  status: SignalStatus;
  price: number;
  entry: number | null;
  stop: number | null;
  target: number | null;
  rr: number | null;
  reasons: string[];
  ts: number;
  outcome?: string;
}

export interface SRLevel {
  price: number;
  kind: "support" | "resistance";
  touches: number;
  strength: number;
  lastTouch: number;
}

export interface Analysis {
  chartType?: "candles" | "heikin-ashi";
  symbol: string;
  timeframe: Timeframe;
  trend: TrendState;
  structureSeq: string[];
  swings: Array<{ time: number; price: number; kind: string }>;
  levels: SRLevel[];
  emaFast: number;
  emaSlow: number;
  lastClose: number;
  signals: StrategySignal[];
  evaluatedAt: number;
}

export interface QuantConfluence {
  score: number;
  direction: "LONG" | "SHORT" | "NEUTRAL";
  components: { trend: number; zone: number; momentum: number; volume: number };
  reasons: string[];
  atr: number | null;
}

export interface QuantPayload {
  confluence: QuantConfluence;
  htfSource: string;
  regime: "trend" | "range";
  metaProba: number | null;
  metaGate: { passed: boolean; reason: string };
}

export interface PaperOrder {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  type: "market" | "limit" | "stop_market" | "stop_limit";
  qty: number;
  price: number | null;
  stopPrice: number | null;
  status: "open" | "filled" | "cancelled" | "rejected";
  filledPrice: number | null;
  reduceOnly: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface PaperPosition {
  id: string;
  symbol: string;
  side: "long" | "short";
  qty: number;
  entry: number;
  stop: number | null;
  target: number | null;
  realizedPnl: number;
  openedAt: number;
  updatedAt: number;
}

export interface JournalEntry {
  id?: string;
  mode: string;
  symbol: string;
  direction: "long" | "short";
  entry: number;
  exit: number | null;
  qty: number;
  fees: number;
  pnl: number;
  strategy: string;
  reason: string;
  notes: string;
  emotion: string;
  tags: string[];
  openedAt: number;
  closedAt: number | null;
  source: string;
}

export interface AccountPosition {
  symbol: string;
  side: "long" | "short";
  qty: number;
  entry: number;
  upl: number;
  mark: number;
  source: "paper" | "live";
}

export interface AccountState {
  equity: number;
  availableMargin: number;
  marginUsed: number;
  openPnl: number;
  todayPnl: number;
  realizedTotal: number;
  startingBalance: number;
  source: "demo" | "live";
  positions: AccountPosition[];
  balanceCurrency?: string;
  balanceAsset?: string;
  fxRate?: number | null;
}

export interface RiskLimits {
  maxDailyLoss: number;
  maxOrderValue: number;
  maxLeverage: number;
  maxOpenPositions: number;
}

export type ExecMode = "read_only" | "paper" | "live";

export interface AppSettings {
  onboarded: boolean;
  mode: ExecMode;
  liveArmed: boolean;
  layout: string;
  dataSource: "live" | "demo";
  accent: string;
  density: string;
  reduceMotion: boolean;
  colorblindPalette: boolean;
  chartLabelMode: "compact" | "full";
  timezone: string;
  watchlist: string[];
  modules: Record<string, boolean>;
  strategiesEnabled: Record<string, boolean>;
  riskLimits: RiskLimits;
  srAuto: boolean;
  srLookback: number;
  srSensitivity: number;
  srMinTouches: number;
  alertSound: boolean;
  alertBrowser: boolean;
  startingBalance: number;
  seededDemo: boolean;
  displayCurrency: "usd" | "inr";
  usdInrRate: number;
  tradingviewEnabled: boolean;
  tradingviewSecret: string;
  theme: "dark" | "light";
  aiPrediction?: { enabled: boolean; provider: string; autoRun: boolean };
}

export interface SystemStatus {
  db: boolean;
  exchangeMarket: "online" | "offline" | "disabled";
  exchangeAccount: "configured" | "disconnected" | "disabled";
  strategy: boolean;
  execution: string;
  webhook: boolean;
  demoMode: boolean;
  latencyMs: number | null;
  version: string;
  exchange?: {
    configured: boolean;
    exchange: string;
    baseUrl: string;
    missing: string[];
    reachable: boolean;
    liveExecutionEnabled: boolean;
    clientOrderIds: boolean;
    orderReconciliation: boolean;
    error?: string;
  };
  flags: Record<string, boolean>;
}

export interface AlertRule {
  id?: string;
  symbol: string;
  kind: "price_above" | "price_below" | "zone_enter" | "signal" | "pnl_below" | "strategy_signal";
  level: number | null;
  level2: number | null;
  enabled: boolean;
  sound: boolean;
  browser: boolean;
  triggeredAt: number | null;
  createdAt?: number;
}

export interface Mover {
  symbol: string;
  price: number;
  changePct: number;
  direction: "up" | "down";
  reason?: string;
}
