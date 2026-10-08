/** Shared domain types for Trading Command. */

export type Timeframe =
  | "1m" | "3m" | "5m" | "15m" | "30m" | "1H" | "2H" | "4H" | "1D" | "1W";

export const TIMEFRAMES: Timeframe[] = [
  "1m", "3m", "5m", "15m", "30m", "1H", "2H", "4H", "1D", "1W",
];

export const TF_MINUTES: Record<Timeframe, number> = {
  "1m": 1, "3m": 3, "5m": 5, "15m": 15, "30m": 30,
  "1H": 60, "2H": 120, "4H": 240, "1D": 1440, "1W": 10080,
};

export interface Candle {
  time: number; // unix seconds UTC, start of candle
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
  change24hPct: number; // percent, e.g. +1.24
  volume24hUsd: number;
  fundingRate: number | null; // percent per 8h
  openInterest: number | null; // USD notional
  high24h: number | null;
  low24h: number | null;
  bid: number | null;
  ask: number | null;
  ts: number; // ms epoch
  source: "demo" | "delta";
  stale?: boolean;
}

export interface OrderBookLevel { price: number; size: number }
export interface OrderBook {
  symbol: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  ts: number;
  source: "demo" | "delta";
}
export interface RecentTrade { price: number; size: number; side: "buy" | "sell"; ts: number }

export type TrendState = "BULLISH" | "BEARISH" | "RANGE" | "UNCLEAR";
export type SignalStatus = "WAIT" | "WATCH" | "LONG_SETUP" | "SHORT_SETUP" | "INVALIDATED";
export type SignalOutcome =
  | "ACTIVE" | "SUPERSEDED" | "EXPIRED" | "TRIGGERED" | "INVALIDATED" | "MANUAL_OVERRIDE";

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
  outcome?: SignalOutcome;
  createdAt?: number;
}

export interface StructurePoint { time: number; price: number; kind: "HH" | "HL" | "LH" | "LL" }
export interface SRLevel {
  price: number;
  kind: "support" | "resistance";
  touches: number;
  strength: number; // 0..1 confidence
  lastTouch: number;
}

export interface Analysis {
  symbol: string;
  timeframe: Timeframe;
  trend: TrendState;
  structureSeq: string[]; // e.g. ["HH","HL","HH"]
  swings: StructurePoint[];
  levels: SRLevel[];
  emaFast: number;
  emaSlow: number;
  lastClose: number;
  signals: StrategySignal[];
  evaluatedAt: number;
}

export type DrawingType =
  | "hline" | "vline" | "trend" | "ray" | "rect" | "text" | "entry" | "stop" | "target";

export interface DrawingPoint { time: number; price: number }
export interface Drawing {
  id?: string;
  symbol: string;
  timeframe: Timeframe;
  layout: string;
  type: DrawingType;
  points: DrawingPoint[];
  color: string;
  width: number;
  opacity: number;
  locked: boolean;
  hidden: boolean;
  label: string;
  note: string;
  createdAt?: number;
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
  mode: "demo" | "paper" | "live";
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
  source: "manual" | "paper" | "seed";
}

export interface RiskLimits {
  maxDailyLoss: number;
  maxOrderValue: number;
  maxLeverage: number;
  maxOpenPositions: number;
}

export type ExecMode = "read_only" | "paper" | "live";
export type LayoutPreset = "minimal" | "trading" | "analysis" | "risk" | "terminal" | "custom";

export interface AppSettings {
  onboarded: boolean;
  mode: ExecMode;
  liveArmed: boolean; // master trading switch, OFF by default
  layout: LayoutPreset;
  dataSource: "demo" | "delta";
  accent: "teal" | "blue" | "purple" | "amber";
  density: "comfortable" | "compact";
  reduceMotion: boolean;
  timezone: "IST" | "UTC" | "local";
  watchlist: string[];
  modules: Record<string, boolean>;
  strategiesEnabled: Record<string, boolean>;
  riskLimits: RiskLimits;
  srAuto: boolean;
  srLookback: number;
  srSensitivity: number; // fraction of price used as cluster tolerance
  srMinTouches: number;
  alertSound: boolean;
  alertBrowser: boolean;
  startingBalance: number;
  seededDemo: boolean;
  /** Currency shown in RISK LIMITS. Limits are stored in USD server-side. */
  displayCurrency: "usd" | "inr";
  /** USD→INR rate used to display/edit the (USD-canonical) risk limits. */
  usdInrRate: number;
  /** TradingView webhook receiver, enabled from the dashboard. */
  tradingviewEnabled: boolean;
  /** Webhook shared secret (used when TRADINGVIEW_WEBHOOK_SECRET env is unset). */
  tradingviewSecret: string;
}

export interface AlertRule {
  id?: string;
  symbol: string;
  kind: "price_above" | "price_below" | "zone_enter" | "signal" | "pnl_below";
  level: number | null;
  level2: number | null;
  enabled: boolean;
  sound: boolean;
  browser: boolean;
  triggeredAt: number | null;
  createdAt?: number;
}

export interface SystemStatus {
  db: boolean;
  deltaMarket: "online" | "offline" | "disabled";
  /**
   * Private Delta account access. After the static-IP gateway migration this
   * reflects the GATEWAY's configuration, not any credential on Vercel.
   */
  deltaAccount: "configured" | "disconnected" | "disabled";
  strategy: boolean;
  execution: string; // READ ONLY | PAPER | LIVE DISABLED | LIVE ARMED
  webhook: boolean;
  demoMode: boolean;
  latencyMs: number | null;
  version: string;
  /** Static-IP trading gateway: the only path to private Delta endpoints. */
  gateway?: {
    configured: boolean;
    reachable: boolean;
    ready: boolean;
    host: string | null;
    liveExecutionEnabled: boolean;
    error?: string;
  };
  flags: Record<string, boolean>;
}

export interface AccountState {
  equity: number;
  availableMargin: number;
  marginUsed: number;
  openPnl: number;
  todayPnl: number;
  realizedTotal: number;
  startingBalance: number;
  source: "demo" | "delta";
  positions: {
    symbol: string;
    side: "long" | "short";
    qty: number;
    entry: number;
    upl: number;
    mark: number;
    source: "paper" | "delta";
  }[];
}
