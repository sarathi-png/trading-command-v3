/**
 * Request validation for order endpoints.
 *
 * Validation happens BEFORE the risk guard and long before Delta sees
 * anything. Rejecting a malformed order locally is the cheapest possible
 * safety measure: no credential is used, no exchange call is made, and the
 * caller gets a precise reason.
 *
 * Rules mirror what Delta accepts:
 *   - symbol: 3–30 chars, letters/digits only (e.g. BTCUSD, ETHUSDT)
 *   - side:   "buy" | "sell"
 *   - type:   "market_order" | "limit_order" (the only two the app uses)
 *   - size:   finite and > 0
 *   - limit_price: required for limit orders, finite and > 0
 *   - client_order_id: 1–32 chars (Delta's documented maximum), URL-safe
 */
import { validationError } from "../errors.js";

const SYMBOL_RE = /^[A-Z0-9]{3,30}$/;
const CLIENT_ORDER_ID_RE = /^[A-Za-z0-9._-]{1,32}$/;

export interface OrderBody {
  symbol: string;
  side: "buy" | "sell";
  type: "market_order" | "limit_order";
  size: number;
  limitPrice: number | null;
  reduceOnly: boolean;
  clientOrderId: string;
  underlyings: string[];
  riskLimits?: Record<string, unknown>;
}

function asRecord(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw validationError("The request body must be a JSON object.");
  }
  return body as Record<string, unknown>;
}

export function parseOrderBody(body: unknown): OrderBody {
  const raw = asRecord(body);

  const symbol = String(raw.symbol ?? "").trim().toUpperCase();
  if (!SYMBOL_RE.test(symbol)) {
    throw validationError("symbol must be an exchange symbol such as BTCUSD.", { field: "symbol" });
  }

  const side = raw.side === "sell" ? "sell" : raw.side === "buy" ? "buy" : null;
  if (!side) {
    throw validationError('side must be "buy" or "sell".', { field: "side" });
  }

  // An UNRECOGNISED type is rejected, never coerced. Coercing "stop_market" to
  // a market order would execute immediately at the market — the opposite of
  // what the caller asked for — so anything unknown fails here.
  const requestedType = raw.order_type ?? raw.type;
  const type =
    requestedType === undefined || requestedType === null || requestedType === ""
      ? "market_order"
      : requestedType === "limit_order" || requestedType === "market_order"
        ? requestedType
        : null;
  if (!type) {
    throw validationError('order_type must be "market_order" or "limit_order".', { field: "order_type" });
  }

  const size = Number(raw.size);
  if (!Number.isFinite(size) || size <= 0) {
    throw validationError("size must be a positive number.", { field: "size" });
  }

  const rawLimitPrice = raw.limit_price;
  let limitPrice: number | null = null;
  if (rawLimitPrice !== undefined && rawLimitPrice !== null && rawLimitPrice !== "") {
    limitPrice = Number(rawLimitPrice);
    if (!Number.isFinite(limitPrice) || limitPrice <= 0) {
      throw validationError("limit_price must be a positive number when provided.", {
        field: "limit_price",
      });
    }
  }
  if (type === "limit_order" && limitPrice === null) {
    throw validationError("limit_price is required for a limit order.", { field: "limit_price" });
  }

  const clientOrderId = String(raw.client_order_id ?? raw.clientOrderId ?? "").trim();
  if (!CLIENT_ORDER_ID_RE.test(clientOrderId)) {
    throw validationError(
      "client_order_id is required and must be 1-32 characters of letters, digits, dot, dash or underscore.",
      { field: "client_order_id" }
    );
  }

  // Optional hint used to widen the venue-derived position read-off. Values are
  // sanitised to base assets; the risk guard never trusts a number from here.
  const rawUnderlyings = raw.underlying_assets ?? raw.underlyingAssets;
  const underlyings = (
    Array.isArray(rawUnderlyings)
      ? rawUnderlyings.map((value) => String(value).toUpperCase())
      : []
  ).filter((value) => /^[A-Z0-9]{2,15}$/.test(value));

  const riskLimits =
    raw.risk_limits && typeof raw.risk_limits === "object" && !Array.isArray(raw.risk_limits)
      ? (raw.risk_limits as Record<string, unknown>)
      : undefined;

  return {
    symbol,
    side,
    type,
    size,
    limitPrice,
    reduceOnly: raw.reduce_only === true,
    clientOrderId,
    underlyings,
    ...(riskLimits ? { riskLimits } : {}),
  };
}

export function parseCancelBody(body: unknown): { clientOrderId?: string; orderId?: number; productId?: number } {
  const raw = asRecord(body);
  const out: { clientOrderId?: string; orderId?: number; productId?: number } = {};

  const clientOrderId = String(raw.client_order_id ?? raw.clientOrderId ?? "").trim();
  if (clientOrderId) {
    if (!CLIENT_ORDER_ID_RE.test(clientOrderId)) {
      throw validationError("client_order_id is not a valid order id.", { field: "client_order_id" });
    }
    out.clientOrderId = clientOrderId;
  }

  if (raw.order_id !== undefined || raw.orderId !== undefined) {
    const id = Number(raw.order_id ?? raw.orderId);
    if (!Number.isInteger(id) || id <= 0) {
      throw validationError("order_id must be a positive integer.", { field: "order_id" });
    }
    out.orderId = id;
  }

  if (raw.product_id !== undefined || raw.productId !== undefined) {
    const productId = Number(raw.product_id ?? raw.productId);
    if (!Number.isInteger(productId) || productId <= 0) {
      throw validationError("product_id must be a positive integer.", { field: "product_id" });
    }
    out.productId = productId;
  }

  if (!out.clientOrderId && out.orderId === undefined && out.productId === undefined) {
    throw validationError("Provide client_order_id, order_id or product_id to cancel.", {
      field: "client_order_id",
    });
  }
  return out;
}

export function parseClosePositionBody(body: unknown): { symbol: string; size?: number; clientOrderId?: string } {
  const raw = asRecord(body);
  const symbol = String(raw.symbol ?? "").trim().toUpperCase();
  if (!SYMBOL_RE.test(symbol)) {
    throw validationError("symbol must be an exchange symbol such as BTCUSD.", { field: "symbol" });
  }

  const out: { symbol: string; size?: number; clientOrderId?: string } = { symbol };
  if (raw.size !== undefined && raw.size !== null && raw.size !== "") {
    const size = Number(raw.size);
    if (!Number.isFinite(size) || size <= 0) {
      throw validationError("size must be a positive number when provided.", { field: "size" });
    }
    out.size = size;
  }
  const clientOrderId = String(raw.client_order_id ?? raw.clientOrderId ?? "").trim();
  if (clientOrderId) {
    if (!CLIENT_ORDER_ID_RE.test(clientOrderId)) {
      throw validationError("client_order_id is not a valid order id.", { field: "client_order_id" });
    }
    out.clientOrderId = clientOrderId;
  }
  return out;
}

/** Shared helper for the order routes: strict symbol allowlist. */
export function assertSymbolAllowed(symbol: string, allowed: string[]): void {
  if (allowed.length > 0 && !allowed.includes(symbol)) {
    throw validationError(`${symbol} is not in the gateway's allowed symbol list.`, {
      field: "symbol",
      symbol,
    });
  }
}
