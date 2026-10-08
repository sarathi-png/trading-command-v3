/**
 * Private Delta account reads, proxied through the static-IP gateway.
 *
 * These functions replace what `src/lib/market/delta.ts` used to do with its
 * own HMAC signing. The gateway holds the credentials and the static IP; the
 * application only ever sees the resulting data.
 *
 * Response shapes are the ones the derivation code downstream already expects
 * (the same shapes Delta returns), so balances/P&L/journal analytics keep
 * working unchanged:
 *
 *   gatewayWalletBalances()  -> [{ asset_symbol, balance, available_balance }]
 *   gatewayPositions(base)   -> [{ product_id, size, entry_price, ... }]
 */
import { gatewayRequest } from "./client";

interface GatewayResult<T> {
  success: boolean;
  result: T;
}

export interface RawBalanceRow {
  asset_symbol?: string;
  balance?: string;
  available_balance?: string;
}

export interface RawPositionRow {
  product_id?: number;
  product_symbol?: string;
  symbol?: string;
  size?: number | string;
  side?: string;
  entry_price?: string | number;
  mark_price?: string | number;
  unrealized_pnl?: string | number;
}

/** Wallet balances straight from the exchange (strings, as Delta returns them). */
export async function gatewayWalletBalances(): Promise<RawBalanceRow[]> {
  const body = await gatewayRequest<GatewayResult<RawBalanceRow[]>>("/api/account/balance");
  return body.result ?? [];
}

/** Wallet ledger rows (deposits, cashflow, commission, funding). */
export async function gatewayWalletTransactions(pageSize = 200): Promise<Record<string, unknown>[]> {
  const body = await gatewayRequest<GatewayResult<Record<string, unknown>[]>>("/api/account/transactions", {
    query: { page_size: pageSize },
  });
  return body.result ?? [];
}

/** Executed fills, used for realised P&L derivation. */
export async function gatewayFills(pageSize = 500): Promise<Record<string, unknown>[]> {
  const body = await gatewayRequest<GatewayResult<Record<string, unknown>[]>>("/api/account/fills", {
    query: { page_size: pageSize },
  });
  return body.result ?? [];
}

/**
 * Positions for ONE underlying base asset.
 *
 * Delta has no all-positions endpoint, so the caller (which knows the
 * watchlist from the database) fans out — exactly as before the migration.
 */
export async function gatewayPositionsForUnderlying(underlying: string): Promise<RawPositionRow[]> {
  const body = await gatewayRequest<GatewayResult<RawPositionRow[] | RawPositionRow>>(
    "/api/account/positions",
    { query: { underlying_asset_symbol: underlying.toUpperCase() } }
  );
  const raw = body.result;
  return Array.isArray(raw) ? raw : raw ? [raw] : [];
}

/** Open orders (Delta "active orders"). */
export async function gatewayOpenOrders(): Promise<Record<string, unknown>[]> {
  const body = await gatewayRequest<GatewayResult<Record<string, unknown>[]>>("/api/account/orders");
  return body.result ?? [];
}
