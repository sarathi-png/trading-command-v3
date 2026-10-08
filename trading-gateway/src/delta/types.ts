/** Shared Delta row types (raw exchange shapes, no local derivation). */

export interface ProductRef {
  productId: number;
  symbol: string;
}

export interface DeltaOrder {
  id?: number;
  product_id?: number;
  product_symbol?: string;
  client_order_id?: string;
  side?: string;
  size?: number | string;
  unfilled_size?: number | string;
  state?: string;
  order_type?: string;
  limit_price?: string | null;
  average_fill_price?: string | null;
  reduce_only?: boolean;
  created_at?: string;
  [key: string]: unknown;
}

/** Raw wallet balance row: `balance` and `available_balance` are decimal strings. */
export interface BalanceRow {
  asset_symbol?: string;
  balance?: string;
  available_balance?: string;
  [key: string]: unknown;
}

export interface TransactionRow {
  transaction_type?: string;
  amount?: string;
  asset_symbol?: string;
  created_at?: string;
  [key: string]: unknown;
}

export interface FillRow {
  notional?: string;
  product_symbol?: string;
  side?: string;
  price?: string;
  size?: string;
  commission?: string;
  created_at?: string;
  [key: string]: unknown;
}

export interface PositionRow {
  product_id?: number;
  product_symbol?: string;
  symbol?: string;
  size?: number | string;
  side?: string;
  entry_price?: string | number;
  mark_price?: string | number;
  unrealized_pnl?: string | number;
  [key: string]: unknown;
}

export interface CreateOrderPayload {
  product_id: number;
  order_type: "market_order" | "limit_order";
  side: "buy" | "sell";
  size: number;
  reduce_only: boolean;
  client_order_id: string;
  limit_price?: string;
}
