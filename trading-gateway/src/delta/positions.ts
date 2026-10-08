/**
 * Delta positions.
 *
 * Delta has no "all positions" endpoint: GET /v2/positions requires either
 * `product_id` (returns ONE position) or `underlying_asset_symbol` (returns the
 * list for that base asset, e.g. "BTC" — not "BTCUSD"). The gateway exposes the
 * same shape as Delta and lets the caller pass the underlying, exactly as the
 * application did before the migration; the watchlist lives in the database on
 * the Vercel side, so the fan-out over underlyings stays there.
 *
 * The gateway also fans out internally for risk evaluation (see
 * `positionsForUnderlyings`).
 */
import { DeltaClient } from "./client.js";
import type { PositionRow } from "./types.js";

/** GET /v2/positions?underlying_asset_symbol=<base asset> */
export async function positionsForUnderlying(
  client: DeltaClient,
  underlyingAssetSymbol: string
): Promise<{ result: PositionRow[] }> {
  const response = await client.get<{ result?: PositionRow[] | PositionRow }>(
    "/v2/positions",
    { underlying_asset_symbol: underlyingAssetSymbol.toUpperCase() },
    { auth: true }
  );
  client.assertSuccess("positions", response, { underlyingAssetSymbol });
  const raw = response.json?.result;
  const rows = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return { result: rows };
}

/** Fan-out used by the risk guard; de-duplicated and failure-tolerant. */
export async function positionsForUnderlyings(
  client: DeltaClient,
  underlyings: string[]
): Promise<PositionRow[]> {
  const unique = [...new Set(underlyings.map((u) => u.trim().toUpperCase()).filter(Boolean))];
  const out: PositionRow[] = [];
  for (const underlying of unique) {
    try {
      const { result } = await positionsForUnderlying(client, underlying);
      out.push(...result);
    } catch {
      // A single bad underlying must not invalidate a risk decision for the
      // others; the inability to read ANY position set is handled by the
      // caller (unknown exposure blocks the order).
    }
  }
  return out;
}

/** Open exposure in quote currency (USD) for a set of position rows. */
export function notionalOf(rows: PositionRow[]): number {
  let total = 0;
  for (const row of rows) {
    const size = Math.abs(Number(row.size ?? 0));
    const price = Number(row.mark_price ?? row.entry_price ?? 0);
    if (Number.isFinite(size) && Number.isFinite(price)) total += size * price;
  }
  return total;
}

/** Symbols/base assets currently held. */
export function symbolsOf(rows: PositionRow[]): string[] {
  const out = new Set<string>();
  for (const row of rows) {
    const size = Math.abs(Number(row.size ?? 0));
    if (!size) continue;
    const symbol = String(row.symbol ?? row.product_symbol ?? "");
    if (symbol) out.add(symbol.toUpperCase());
    else if (row.product_id !== undefined) out.add(`id:${row.product_id}`);
  }
  return [...out];
}
