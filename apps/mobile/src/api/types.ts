/**
 * API response types used by the mobile client.
 *
 * These mirror the server models the app actually reads. They are copied
 * rather than imported from `src/lib/types.ts` because `apps/mobile` is a
 * separate install: importing across the app boundary would drag server-only
 * modules (and the Node runtime) into a React Native bundle.
 *
 * When the backend changes a response key, update this file in the same PR.
 */

export type Timeframe = "1m" | "3m" | "5m" | "15m" | "30m" | "1H" | "2H" | "4H" | "1D" | "1W";

export type SignalStatus = "WAIT" | "WATCH" | "LONG_SETUP" | "SHORT_SETUP" | "INVALIDATED";
export type SignalOutcome =
  | "ACTIVE" | "SUPERSEDED" | "EXPIRED" | "TRIGGERED" | "INVALIDATED" | "MANUAL_OVERRIDE";

export type Mode = "read_only" | "paper" | "live";
export type Workspace = "paper" | "live";

export interface LoginResponse {
  token: string;
  expiresAt: number;
}

export interface HealthResponse {
  ok: boolean;
  backend?: string;
  schema?: boolean;
  ready?: boolean;
  status?: string;
}

export interface SystemStatus {
  db: boolean;
  exchangeMarket: "online" | "offline" | "disabled";
  exchangeAccount: "configured" | "disconnected" | "disabled";
  strategy: boolean;
  execution: string;
  webhook: boolean;
  demoMode: boolean;
  version: string;
  exchange: {
    configured: boolean;
    exchange: string;
    liveExecutionEnabled: boolean;
    missing?: string[];
    error?: string;
  };
  market: {
    provider: string;
    label: string;
    dataSource: "demo" | "live";
    orderbook: boolean;
    recentTrades: boolean;
  };
  flags: Record<string, boolean>;
}

export interface Ticker {
  symbol: string;
  price: number;
  markPrice: number | null;
  change24hPct: number;
  change24hAvailable?: boolean;
  volume24hUsd: number;
  bid: number | null;
  ask: number | null;
  ts: number;
  source: "demo" | "live";
  stale?: boolean;
}

export interface TickerEnvelope {
  tickers: Ticker[];
  source?: string;
  provider?: string;
  asOf: string | null;
  stale: boolean;
  known?: string[];
  error?: string;
}

export interface SettingsResponse {
  settings: {
    mode: Mode;
    dataSource: "demo" | "live";
    liveArmed: boolean;
    watchlist: string[];
    startingBalance: number;
    displayCurrency: "usd" | "inr";
    usdInrRate: number;
  };
  capabilities: {
    exchangeAccountConfigured: boolean;
    exchangeMarket: boolean;
    paperTrading: boolean;
    liveExecution: boolean;
    webhook: boolean;
    orderbook: boolean;
    strategyEngine: boolean;
  };
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
  openedAt: string;
  updatedAt: string;
  /** Mark price used for the last sync. */
  mark: number;
  /** Unrealized P&L at `mark`. */
  upl: number;
  notional: number;
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
  clientOrderId: string | null;
  filledPrice: number | null;
  reduceOnly: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PaperFill {
  id: string;
  orderId: string | null;
  positionId: string | null;
  symbol: string;
  side: "long" | "short";
  kind: "open" | "add" | "reduce" | "close";
  qty: number;
  price: number;
  fee: number;
  realizedPnl: number;
  createdAt: string;
}

export interface PaperEvent {
  kind: string;
  message: string;
}

export interface PaperState {
  positions: PaperPosition[];
  orders: PaperOrder[];
  fills: PaperFill[];
  events?: PaperEvent[];
  mode?: Mode;
  error?: string;
}

export interface SignalRow {
  id: string;
  symbol: string;
  timeframe: Timeframe;
  strategy: string;
  status: SignalStatus;
  outcome: SignalOutcome;
  price: number;
  entry: number | null;
  stop: number | null;
  target: number | null;
  rr: number | null;
  reasons: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SignalsResponse {
  signals: SignalRow[];
}

export interface PlacePaperOrderBody {
  action: "place";
  symbol: string;
  side: "buy" | "sell";
  type: "market";
  qty: number;
  client_order_id: string;
  stop?: number;
  target?: number;
}
