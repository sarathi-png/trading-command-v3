/**
 * Normalised live account data, built from the gateway's raw payloads.
 *
 * This is a port of the two helpers that used to live in
 * `src/lib/market/delta.ts` (`deltaWalletBalances`, `deltaPositions`) with the
 * transport swapped from direct signed Delta calls to the static-IP gateway.
 * The normalisation is unchanged, so every screen that consumed them keeps
 * working:
 *
 *   - balances: `balance` is a plain decimal string, NOT scaled by 1e6
 *   - positions: absolute size, side from `side`/sign, symbol from `symbol`
 *     or the product-id map (an id→symbol lookup on the PUBLIC products
 *     endpoint, cached for 60 s)
 */
import { http } from "@/lib/market/delta";
import { getSettings } from "@/lib/settings";
import { gatewayPositionsForUnderlying, gatewayWalletBalances } from "./account";
import { baseAssetOf } from "./symbols";

interface ProductRow {
  id?: number;
  symbol?: string;
}

let productsCache: { at: number; map: Map<number, string> } | null = null;

/** Product id → symbol, via the PUBLIC products endpoint (no credentials). */
async function productIdSymbolMap(): Promise<Map<number, string>> {
  if (productsCache && Date.now() - productsCache.at < 60_000) return productsCache.map;
  try {
    const data = (await http("GET", "/v2/products", {}, null, false)) as { result?: ProductRow[] };
    const map = new Map<number, string>();
    for (const product of data.result ?? []) {
      if (product.id !== undefined && product.symbol) map.set(Number(product.id), String(product.symbol));
    }
    productsCache = { at: Date.now(), map };
    return map;
  } catch {
    return productsCache?.map ?? new Map();
  }
}

export interface LivePosition {
  symbol: string;
  side: "long" | "short";
  qty: number;
  entry: number;
  upl: number;
  mark: number;
}

/** Wallet balances: `[{ asset, balance }]`, decimal strings parsed as-is. */
export async function liveWalletBalances(): Promise<{ asset: string; balance: number }[]> {
  const rows = await gatewayWalletBalances();
  return rows.map((row) => ({
    asset: String(row.asset_symbol ?? "?"),
    balance: Number.parseFloat(String(row.balance ?? "0")) || 0,
  }));
}

/**
 * Open positions across the watchlist's underlying assets.
 *
 * Delta has no "all positions" endpoint: GET /v2/positions requires either
 * product_id (one position) or underlying_asset_symbol (the list for that base
 * asset, e.g. "BTC"). The watchlist lives in our database, so the fan-out
 * happens here and each underlying is fetched through the gateway.
 */
export async function livePositions(): Promise<LivePosition[]> {
  const settings = await getSettings();
  const underlyings = [...new Set(settings.watchlist.map((symbol) => baseAssetOf(symbol)).filter(Boolean))];
  if (underlyings.length === 0) underlyings.push("BTC");

  const idMap = await productIdSymbolMap();
  const out: LivePosition[] = [];

  for (const underlying of underlyings) {
    const rows = await gatewayPositionsForUnderlying(underlying);
    for (const row of rows) {
      const qty = Math.abs(Number(row.size ?? 0));
      if (!qty || qty <= 0) continue;
      const symbol = String(row.symbol ?? row.product_symbol ?? "") || idMap.get(Number(row.product_id ?? -1)) || "";
      if (!symbol) continue;
      const side: "long" | "short" =
        String(row.side ?? "").toLowerCase() === "short" || Number(row.size) < 0 ? "short" : "long";
      out.push({
        symbol,
        side,
        qty,
        entry: Number(row.entry_price ?? 0),
        upl: Number(row.unrealized_pnl ?? 0),
        mark: Number(row.mark_price ?? 0),
      });
    }
  }
  return out;
}
