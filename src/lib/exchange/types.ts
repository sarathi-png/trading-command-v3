/**
 * Normalised exchange types.
 *
 * The application never sees a raw venue payload: every provider normalises
 * into the shapes below, and the UI, risk engine, analytics and journal keep
 * working against one vocabulary no matter which venue is configured.
 *
 * These are deliberately a superset of the models the app already had
 * (`Candle`, `Ticker`, `OrderBook`, `LivePosition`, wallet rows) so preserving
 * the existing screens costs no translation layer.
 */

/** Canonical identifiers understood across the app: "BTCUSD", "ETHUSD", … */
export type InternalSymbol = string;

export interface ExchangeInstrument {
  /** Canonical app symbol, e.g. "BTCUSD". */
  symbol: InternalSymbol;
  /** Venue pair identifier as the API expects it, e.g. "B-BTC_USDT". */
  exchangeSymbol: string;
  baseAsset: string;
  quoteAsset: string;
  /** "perpetual" | "futures" | "spot" */
  contractType: string;
  /** Margin/settlement currency short name, e.g. "USDT" or "INR". */
  settleAsset: string;
  tickSize?: number;
  minQuantity?: number;
  maxLeverage?: number;
  /** Venue says the instrument is exit-only (position reduction still allowed). */
  exitOnly?: boolean;
}

export interface ExchangeBalance {
  asset: string;
  balance: number;
  available: number;
}

export interface ExchangePosition {
  /** Canonical app symbol. */
  symbol: InternalSymbol;
  exchangeSymbol: string;
  side: "long" | "short";
  /** Absolute size in base units; `side` carries the direction. */
  qty: number;
  entry: number;
  mark: number;
  /** Unrealised P&L in the account's settlement currency (USDT). */
  upl: number;
  leverage: number | null;
  liquidationPrice: number | null;
  /** Margin locked in this position, when the venue reports it. */
  margin: number | null;
  /** Venue position id — stable per pair on CoinDCX. */
  exchangePositionId: string | null;
}

export type ExchangeOrderSide = "buy" | "sell";
export type ExchangeOrderType = "market" | "limit" | "stop_market" | "stop_limit";
export type ExchangeOrderStatus = "open" | "partially_filled" | "filled" | "cancelled" | "rejected" | "unknown";

export interface ExchangeOrder {
  /** Venue order id. */
  id: string;
  symbol: InternalSymbol;
  exchangeSymbol: string;
  side: ExchangeOrderSide;
  type: ExchangeOrderType;
  status: ExchangeOrderStatus;
  /** Venue status string, kept verbatim for audit/debugging. */
  rawStatus: string;
  price: number | null;
  stopPrice: number | null;
  quantity: number;
  filledQuantity: number;
  remainingQuantity: number;
  averagePrice: number | null;
  leverage: number | null;
  /** True when the venue/compat layer knows the order only reduces exposure. */
  reduceOnly: boolean;
  createdAt: number | null;
  updatedAt: number | null;
  /** Untouched venue payload (already credential-free). */
  raw?: unknown;
}

export interface ExchangeFill {
  id: string | null;
  symbol: InternalSymbol;
  exchangeSymbol: string;
  side: ExchangeOrderSide;
  price: number;
  quantity: number;
  fee: number;
  /** Realised P&L attributed to the fill, when the venue reports it. */
  realizedPnl: number | null;
  isMaker: boolean | null;
  ts: number;
}

export interface ExchangeTicker {
  symbol: InternalSymbol;
  exchangeSymbol: string;
  price: number;
  /** 24h stats are optional: not every venue endpoint carries them. */
  change24hPct: number | null;
  high24h: number | null;
  low24h: number | null;
  volume24hUsd: number | null;
  bid: number | null;
  ask: number | null;
  markPrice: number | null;
  fundingRate: number | null;
  ts: number;
}

export interface ExchangeCandle {
  time: number; // unix seconds UTC, candle open
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ExchangeOrderBook {
  symbol: InternalSymbol;
  exchangeSymbol: string;
  bids: { price: number; size: number }[];
  asks: { price: number; size: number }[];
  ts: number;
}

/** What the configured venue can actually do — drives UI capability badges. */
export interface ExchangeCapabilities {
  exchange: string;
  privateReads: boolean;
  marketOrders: boolean;
  limitOrders: boolean;
  stopOrders: boolean;
  takeProfitStopLoss: boolean;
  editOrder: boolean;
  closePosition: boolean;
  reduceOnlyOrders: boolean;
  leverageControl: boolean;
  clientOrderIds: boolean;
  publicMarketData: boolean;
  /** Venue can reconcile an uncertain order submission by listing orders. */
  orderReconciliation: boolean;
}

/** Order request the app builds; the adapter translates it. */
export interface ExchangeOrderRequest {
  symbol: InternalSymbol;
  side: ExchangeOrderSide;
  type: ExchangeOrderType;
  quantity: number;
  price?: number | null;
  stopPrice?: number | null;
  leverage?: number | null;
  reduceOnly?: boolean;
  /** Only used when the venue supports client order ids. */
  clientOrderId?: string | null;
  /** Caller-supplied idempotency key used for reconciliation regardless. */
  reconciliationKey?: string | null;
}
