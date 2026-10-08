/**
 * Private position and open-order reads.
 *
 * Delta exposes positions only per underlying asset (`underlying_asset_symbol`)
 * and its open-orders feed returns every open order for the key, so both live
 * here rather than in `routes/account.ts`:
 *
 *   GET /api/account/positions?underlying_asset_symbol=BTC
 *   GET /api/account/orders
 *
 * Every route is authenticated server-to-server before it gets here.
 */
import type { RouteContext, RouteResult } from "../context.js";
import { openOrders } from "../delta/orders.js";
import { positionsForUnderlying } from "../delta/positions.js";
import { validationError } from "../errors.js";

export async function handlePositions(ctx: RouteContext): Promise<RouteResult> {
  const underlying = (ctx.url.searchParams.get("underlying_asset_symbol") ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9]{2,15}$/.test(underlying)) {
    throw validationError(
      "underlying_asset_symbol is required (the base asset, e.g. BTC — Delta has no all-positions endpoint).",
      { field: "underlying_asset_symbol" }
    );
  }
  const { result } = await positionsForUnderlying(ctx.client, underlying);
  return { status: 200, body: { success: true, result, requestId: ctx.requestId } };
}

export async function handleOpenOrders(ctx: RouteContext): Promise<RouteResult> {
  const { result } = await openOrders(ctx.client);
  return { status: 200, body: { success: true, result, requestId: ctx.requestId } };
}
