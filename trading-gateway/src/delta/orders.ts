/**
 * Delta order operations.
 *
 * Endpoints (all pre-existing in the project, verified against Delta's API):
 *   POST   /v2/orders                            create order
 *   DELETE /v2/orders                            cancel one order (body identifies it)
 *   GET    /v2/orders                             open orders
 *   GET    /v2/orders/client_order_id/{id}        look up one order by our id
 *
 * Every mutation goes through `DeltaClient.mutate`, which attempts the request
 * EXACTLY ONCE and raises DELTA_UNKNOWN_RESULT when the exchange may or may not
 * have processed it. Callers must reconcile — never resubmit.
 */
import { GatewayError } from "../errors.js";
import { DeltaClient } from "./client.js";
import { resolveProduct } from "./products.js";
import { positionsForUnderlying } from "./positions.js";
import type { CreateOrderPayload, DeltaOrder, PositionRow } from "./types.js";

export interface CreateOrderRequest {
  symbol: string;
  side: "buy" | "sell";
  type: "market_order" | "limit_order";
  size: number;
  reduceOnly: boolean;
  clientOrderId: string;
  limitPrice?: number | null;
}

export interface CreateOrderResult {
  order: DeltaOrder | null;
  productId: number;
  clientOrderId: string;
  /** true when Delta answered with a rejection (the order does not exist). */
  rejected: boolean;
}

/** Base asset for a derivative symbol ("BTCUSD" -> "BTC"), as the app does it. */
export function baseAssetOf(symbol: string): string {
  return symbol.toUpperCase().replace(/(USDT|USDC|USD|PERP)$/i, "");
}

/**
 * Create an order on Delta. NEVER retried automatically — see client.mutate.
 * Throws GatewayError with code DELTA_UNKNOWN_RESULT when the outcome cannot be
 * established; the caller must reconcile and must not resubmit this id.
 */
export async function createOrder(
  client: DeltaClient,
  request: CreateOrderRequest
): Promise<CreateOrderResult> {
  const product = await resolveProduct(client, request.symbol);

  const payload: CreateOrderPayload = {
    product_id: product.productId,
    order_type: request.type,
    side: request.side,
    size: request.size,
    reduce_only: request.reduceOnly,
    // Echoed by the exchange, and the key we reconcile against afterwards.
    client_order_id: request.clientOrderId,
  };
  if (request.type === "limit_order") {
    if (!Number.isFinite(request.limitPrice ?? NaN) || (request.limitPrice ?? 0) <= 0) {
      throw new GatewayError("VALIDATION_ERROR", 422, "A limit order requires a positive limit_price.");
    }
    payload.limit_price = String(request.limitPrice);
  }

  const result = await client.mutate<{ result?: DeltaOrder; success?: boolean; error?: unknown }>(
    "POST",
    "/v2/orders",
    payload,
    { auth: true }
  );

  // Delta answered: a rejection is definite — no order exists, so the caller
  // may retry with the SAME client order id (the ledger allows that case).
  if (result.status >= 400) {
    const failure = DeltaClient.failure("order creation", result, {
      symbol: request.symbol,
      side: request.side,
    });
    if (failure.code === "DELTA_API_ERROR" || failure.code === "DELTA_FORBIDDEN") {
      return { order: null, productId: product.productId, clientOrderId: request.clientOrderId, rejected: true };
    }
    throw failure;
  }

  const failed = result.json && typeof result.json === "object" && (result.json as { success?: unknown }).success === false;
  if (failed) {
    return { order: null, productId: product.productId, clientOrderId: request.clientOrderId, rejected: true };
  }

  return {
    order: (result.json as { result?: DeltaOrder })?.result ?? null,
    productId: product.productId,
    clientOrderId: request.clientOrderId,
    rejected: false,
  };
}

/** GET /v2/orders — open orders (read-only, retried by the client). */
export async function openOrders(client: DeltaClient): Promise<{ result: DeltaOrder[] }> {
  const response = await client.get<{ result?: DeltaOrder[] }>("/v2/orders", {}, { auth: true });
  client.assertSuccess("open orders", response);
  return { result: response.json?.result ?? [] };
}

export type OrderLookup =
  | { status: "found"; order: DeltaOrder }
  | { status: "not_found" }
  | { status: "unknown"; reason: string };

/**
 * Reconcile by client order id: GET /v2/orders/client_order_id/{id}.
 *
 * This is what turns an UNKNOWN submission outcome into a decision: if the
 * order is found, it exists exactly once and must not be resubmitted. If Delta
 * says it does not exist, nothing was created. Only a failure of the lookup
 * itself leaves the answer "unknown", which keeps the caller blocked.
 */
export async function orderByClientOrderId(
  client: DeltaClient,
  clientOrderId: string
): Promise<OrderLookup> {
  try {
    const response = await client.get<{ result?: DeltaOrder }>(
      `/v2/orders/client_order_id/${encodeURIComponent(clientOrderId)}`,
      {},
      { auth: true }
    );
    if (response.status === 404) return { status: "not_found" };
    if (response.status >= 400) {
      return { status: "unknown", reason: `Delta answered HTTP ${response.status} for the lookup.` };
    }
    const order = response.json?.result;
    if (!order) return { status: "unknown", reason: "Delta returned no order in the lookup response." };
    return { status: "found", order };
  } catch (error) {
    return {
      status: "unknown",
      reason: error instanceof GatewayError ? error.message : "The order lookup failed.",
    };
  }
}

export interface CancelOrderRequest {
  /** Any one identifier is enough; clientOrderId is preferred. */
  clientOrderId?: string;
  orderId?: number;
  productId?: number;
}

/** DELETE /v2/orders — cancel a single open order. Single attempt. */
export async function cancelOrder(
  client: DeltaClient,
  request: CancelOrderRequest
): Promise<{ result: DeltaOrder | null }> {
  const body: Record<string, unknown> = {};
  if (request.clientOrderId) body.client_order_id = request.clientOrderId;
  if (request.orderId !== undefined) body.id = request.orderId;
  if (request.productId !== undefined) body.product_id = request.productId;

  if (Object.keys(body).length === 0) {
    throw new GatewayError("VALIDATION_ERROR", 422, "Provide clientOrderId, orderId or productId to cancel.");
  }

  const response = await client.mutate<{ result?: DeltaOrder }>("DELETE", "/v2/orders", body, {
    auth: true,
  });
  client.assertSuccess("order cancellation", response, { clientOrderId: request.clientOrderId ?? null });
  return { result: response.json?.result ?? null };
}

export interface ClosePositionRequest {
  symbol: string;
  /** Optional explicit size; otherwise the size is read from the exchange. */
  size?: number;
}

/**
 * Close an open position with a reduce_only market order.
 *
 * The size comes from the exchange (never from the browser): the position for
 * the symbol's underlying is read first, and the opposite side is submitted
 * reduce_only so a wrong direction can only reduce, never flip, exposure.
 */
export async function closePosition(
  client: DeltaClient,
  request: ClosePositionRequest,
  clientOrderId: string
): Promise<{ order: DeltaOrder | null; productId: number }> {
  const symbol = request.symbol.toUpperCase();
  const underlying = baseAssetOf(symbol);
  const { result: rows } = await positionsForUnderlying(client, underlying);
  const position = pickPosition(rows, symbol);

  if (!position) {
    throw new GatewayError("POSITION_NOT_FOUND", 404, `No open ${symbol} position to close.`, { symbol });
  }

  const rawSize = Number(position.size ?? 0);
  const size = request.size !== undefined && request.size > 0 ? request.size : Math.abs(rawSize);
  if (!Number.isFinite(size) || size <= 0) {
    throw new GatewayError("VALIDATION_ERROR", 422, "The exchange reports no closable size for this position.", {
      symbol,
    });
  }

  const side: "buy" | "sell" = rawSize < 0 ? "buy" : "sell";
  const product = await resolveProduct(client, symbol);

  const payload: CreateOrderPayload = {
    product_id: product.productId,
    order_type: "market_order",
    side,
    size,
    reduce_only: true,
    client_order_id: clientOrderId,
  };

  const result = await client.mutate<{ result?: DeltaOrder; success?: boolean }>("POST", "/v2/orders", payload, {
    auth: true,
  });
  client.assertSuccess("position close", result, { symbol, side });
  return { order: result.json?.result ?? null, productId: product.productId };
}

function pickPosition(rows: PositionRow[], symbol: string): PositionRow | undefined {
  return rows.find((row) => {
    const rowSymbol = String(row.symbol ?? row.product_symbol ?? "").toUpperCase();
    return rowSymbol === symbol && Math.abs(Number(row.size ?? 0)) > 0;
  });
}
