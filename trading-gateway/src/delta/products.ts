/**
 * Delta Exchange India product lookup.
 *
 * Public endpoint (no credentials), kept on the gateway because order
 * submission needs a numeric product_id: the caller sends a symbol like
 * "BTCUSD" and the gateway resolves it here.
 *
 * Endpoint: GET /v2/products/{symbol}  ->  { result: { id, symbol, ... } }
 */
import { GatewayError } from "../errors.js";
import { DeltaClient } from "./client.js";
import type { ProductRef } from "./types.js";

const PRODUCT_TTL_MS = 5 * 60 * 1000;

/** Cached symbol -> product_id map, so a busy order path does not re-query. */
const cache = new Map<string, { at: number; product: ProductRef }>();

export async function resolveProduct(client: DeltaClient, symbol: string): Promise<ProductRef> {
  const key = symbol.toUpperCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < PRODUCT_TTL_MS) return hit.product;

  let result;
  try {
    result = await client.get<{ result?: { id?: number; symbol?: string } }>(
      `/v2/products/${encodeURIComponent(key)}`,
      {},
      { auth: false }
    );
  } catch (error) {
    if (error instanceof GatewayError && error.code === "DELTA_NOT_FOUND") throw error;
    throw error;
  }

  const id = result.json?.result?.id;
  if (!Number.isFinite(id)) {
    throw new GatewayError(
      "UNKNOWN_SYMBOL",
      404,
      `Delta does not know a product called ${key}.`,
      { symbol: key }
    );
  }
  const product: ProductRef = { productId: Number(id), symbol: String(result.json?.result?.symbol ?? key) };
  cache.set(key, { at: Date.now(), product });
  return product;
}

/** Test helper: drop the cached product map. */
export function clearProductCache(): void {
  cache.clear();
}
