/**
 * Order operations, proxied through the static-IP gateway.
 *
 * The gateway owns the idempotency ledger, the risk guard and the single-attempt
 * submission rule. This client's job is to:
 *   - send a stable `client_order_id` (required, so a retry can never duplicate)
 *   - attempt the mutation ONCE, never on an uncertain outcome
 *   - surface the gateway's normalised error (code + requestId) so the operator
 *     can reconcile
 */
import { gatewayRequest, newRequestId, TradingGatewayError } from "./client";

/**
 * Client order ids must fit Delta's 32-character limit. `tc-` + 20 hex chars is
 * 23 characters, leaves room for a caller-supplied suffix, and stays unique.
 */
export function newClientOrderId(prefix = "tc"): string {
  const random = Array.from({ length: 20 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return `${prefix}-${random}`;
}

export interface CreateLiveOrderRequest {
  symbol: string;
  side: "buy" | "sell";
  size: number;
  type: "market_order" | "limit_order";
  limitPrice?: number | null;
  reduceOnly?: boolean;
  clientOrderId: string;
  /** Base assets whose positions should be inspected for the risk maths. */
  underlyingAssets?: string[];
  /** Limits the operator configured; the gateway clamps them to its ceilings. */
  riskLimits?: Record<string, unknown>;
}

export interface LiveOrderResult {
  clientOrderId: string;
  order: Record<string, unknown> | null;
  deduplicated: boolean;
  risk?: { code: string; orderValue: number };
  requestId?: string;
}

export async function gatewayCreateOrder(request: CreateLiveOrderRequest): Promise<LiveOrderResult> {
  const requestId = newRequestId();
  const body = await gatewayRequest<{
    clientOrderId?: string;
    order?: Record<string, unknown> | null;
    deduplicated?: boolean;
    risk?: { code: string; orderValue: number };
  }>("/api/orders", {
    method: "POST",
    requestId,
    body: {
      symbol: request.symbol,
      side: request.side,
      order_type: request.type,
      size: request.size,
      client_order_id: request.clientOrderId,
      reduce_only: request.reduceOnly === true,
      ...(request.limitPrice !== null && request.limitPrice !== undefined
        ? { limit_price: request.limitPrice }
        : {}),
      ...(request.underlyingAssets?.length ? { underlying_assets: request.underlyingAssets } : {}),
      ...(request.riskLimits ? { risk_limits: request.riskLimits } : {}),
    },
  });
  return {
    clientOrderId: body.clientOrderId ?? request.clientOrderId,
    order: body.order ?? null,
    deduplicated: body.deduplicated === true,
    ...(body.risk ? { risk: body.risk } : {}),
    requestId,
  };
}

export async function gatewayCancelOrder(input: {
  clientOrderId?: string;
  orderId?: number;
}): Promise<{ cancelled: boolean; order: Record<string, unknown> | null }> {
  const body = await gatewayRequest<{ cancelled?: boolean; order?: Record<string, unknown> | null }>(
    "/api/orders/cancel",
    {
      method: "POST",
      body: {
        ...(input.clientOrderId ? { client_order_id: input.clientOrderId } : {}),
        ...(input.orderId !== undefined ? { order_id: input.orderId } : {}),
      },
    }
  );
  return { cancelled: body.cancelled === true, order: body.order ?? null };
}

export async function gatewayClosePosition(input: {
  symbol: string;
  size?: number;
  clientOrderId?: string;
}): Promise<{ clientOrderId: string; order: Record<string, unknown> | null }> {
  const body = await gatewayRequest<{ clientOrderId?: string; order?: Record<string, unknown> | null }>(
    "/api/orders/close-position",
    {
      method: "POST",
      body: {
        symbol: input.symbol,
        ...(input.size !== undefined ? { size: input.size } : {}),
        ...(input.clientOrderId ? { client_order_id: input.clientOrderId } : {}),
      },
    }
  );
  return { clientOrderId: body.clientOrderId ?? input.clientOrderId ?? "", order: body.order ?? null };
}

export type OrderStatusResult =
  | { status: "found"; order: Record<string, unknown> | null; ledgerState: string }
  | { status: "not_found"; order: null; ledgerState: string }
  | { status: "unknown"; order: null; reason?: string; ledgerState: string };

/** Reconcile an order that may or may not have reached Delta. */
export async function gatewayOrderStatus(clientOrderId: string): Promise<OrderStatusResult> {
  const body = await gatewayRequest<{
    status: "found" | "not_found" | "unknown";
    order?: Record<string, unknown> | null;
    ledgerState?: string;
    reason?: string;
  }>("/api/orders/status", { query: { clientOrderId } });
  if (body.status === "found") {
    return { status: "found", order: body.order ?? null, ledgerState: body.ledgerState ?? "submitted" };
  }
  if (body.status === "not_found") {
    return { status: "not_found", order: null, ledgerState: body.ledgerState ?? "rejected" };
  }
  return {
    status: "unknown",
    order: null,
    ledgerState: body.ledgerState ?? "unknown",
    ...(body.reason ? { reason: body.reason } : {}),
  };
}

export { TradingGatewayError };
