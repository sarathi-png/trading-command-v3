/**
 * Venue-derived context for the risk guard.
 *
 * Everything the risk decision needs is read from Delta here — never from the
 * request body. A caller cannot claim "my equity is $1,000,000" or "I have no
 * open positions" to widen a limit.
 *
 * `dailyRealizedPnl` is the one input that comes from the gateway itself
 * (risk/dailyPnl.ts) and it returns null — which blocks. See that file.
 */
import { DeltaClient } from "../delta/client.js";
import { positionsForUnderlying, notionalOf, symbolsOf } from "../delta/positions.js";
import { baseAssetOf } from "../delta/orders.js";
import { walletBalances } from "../delta/account.js";

export interface VenueContext {
  /** Wallet equity in USD, or null when it cannot be read. */
  equity: number | null;
  /** Symbols with a non-zero position among the underlyings inspected. */
  openSymbols: string[];
  /** Total position notional in USD among the underlyings inspected. */
  currentNotional: number;
  /** Which underlyings were actually inspected (for logs/audit). */
  inspectedUnderlyings: string[];
  /** True when every requested underlying could be read. */
  complete: boolean;
}

function num(value: unknown): number {
  const n = typeof value === "string" ? Number.parseFloat(value) : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Read positions for the union of the declared underlyings and the ordered
 * symbol's own base asset, plus the wallet equity.
 *
 * `complete` is false when a position read failed: the leverage/position-limit
 * checks then treat the picture as incomplete, and the caller decides (the
 * order route blocks on incomplete context rather than assuming flat).
 */
export async function readVenueContext(
  client: DeltaClient,
  options: { symbol: string; underlyings: string[] }
): Promise<VenueContext> {
  const inspected = [
    ...new Set(
      [...options.underlyings, baseAssetOf(options.symbol)]
        .map((u) => u.trim().toUpperCase())
        .filter((u) => /^[A-Z0-9]{2,15}$/.test(u))
    ),
  ];

  const rows = [];
  let complete = true;
  for (const underlying of inspected) {
    try {
      const { result } = await positionsForUnderlying(client, underlying);
      rows.push(...result);
    } catch {
      complete = false;
    }
  }

  let equity: number | null = null;
  try {
    const balances = (await walletBalances(client)).result as
      | { asset_symbol?: string; balance?: string }[]
      | undefined;
    // Same assets the application's account panel treats as equity.
    const usd =
      balances?.find((b) => b.asset_symbol === "USD") ?? balances?.find((b) => b.asset_symbol === "USDC");
    if (usd) equity = num(usd.balance);
  } catch {
    equity = null;
  }

  return {
    equity,
    openSymbols: complete ? symbolsOf(rows) : [],
    currentNotional: notionalOf(rows),
    inspectedUnderlyings: inspected,
    complete,
  };
}

/**
 * Reference price for the order-value maths: the limit price when there is
 * one, otherwise the public ticker. Public market data, no credentials.
 */
export async function referencePrice(
  client: DeltaClient,
  symbol: string,
  limitPrice: number | null
): Promise<number | null> {
  if (limitPrice !== null && Number.isFinite(limitPrice) && limitPrice > 0) return limitPrice;

  try {
    const response = await client.get<{ result?: Record<string, unknown>[] }>(
      "/v2/tickers",
      { symbol },
      { auth: false }
    );
    const rows = response.json?.result ?? [];
    const row = rows.find((r) => String(r.symbol ?? "").toUpperCase() === symbol.toUpperCase()) ?? rows[0];
    if (!row) return null;
    const price = num(row.close) || num(row.last_price) || num(row.mark_price);
    return price > 0 ? price : null;
  } catch {
    return null;
  }
}
