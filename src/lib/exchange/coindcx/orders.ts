/**
 * CoinDCX futures — orders.
 *
 *   POST /exchange/v1/derivatives/futures/orders           list orders
 *   POST /exchange/v1/derivatives/futures/orders/create    create an order
 *   POST /exchange/v1/derivatives/futures/orders/cancel    cancel one order by id
 *
 * Two venue quirks drive the design of this file, and both were read from the
 * official reference rather than assumed:
 *
 *   1. **There is no client order id.** Delta let us attach `client_order_id`
 *      and the gateway ledger de-duplicated on it. CoinDCX has no equivalent,
 *      so idempotency is entirely ours: the API route claims the request in
 *      Postgres BEFORE submitting, and an uncertain submission is reconciled
 *      by scanning the venue's recent orders (`reconcileSubmission`) instead of
 *      being retried. `POST /orders` with default page/size is the only
 *      documented way to look orders up, which is what the scan uses.
 *
 *   2. **Leverage must already match the position.** "Order leverage must be
 *      equal to position leverage" and "You should preferably set the leverage
 *      before placing the order to avoid order rejection" — so the adapter
 *      reads the current position/leverage first and calls
 *      `positions/update_leverage` only when it differs. Setting leverage is a
 *      mutation, so it is attempted once.
 *
 * Order types: only `market_order` and `limit_order` are submitted by this
 * build. The reference documents stop/take-profit enums in its "possible
 * values" list but every official code sample sends only the two order forms
 * we send, and stop orders on the order endpoint cannot be verified from the
 * documentation — so this adapter refuses them (capabilities.stopOrders =
 * false) and sends position TP/SL through `positions/create_tpsl`, which IS
 * fully documented. A live order path must never send an enum we have not
 * verified.
 */
import type { ExchangeOrder, ExchangeOrderRequest, ExchangeOrderStatus, ExchangeOrderType } from "../types";
import { toExchangeSymbol, toInternalSymbol } from "../symbols";
import { ExchangeError } from "../errors";
import { expectArray, num } from "./parse";
import type { CoinDcxClient } from "./client";
import { positionFor, updateLeverage } from "./positions";

const MARGIN = ["USDT"] as const;
const LIST_PAGE_SIZE = 100;

interface OrderRow {
  id?: string;
  pair?: string;
  side?: string;
  status?: string;
  order_type?: string;
  price?: number | string | null;
  stop_price?: number | string | null;
  avg_price?: number | string | null;
  total_quantity?: number | string;
  remaining_quantity?: number | string;
  cancelled_quantity?: number | string;
  fee_amount?: number | string;
  leverage?: number | string | null;
  created_at?: number;
  updated_at?: number;
}

/** CoinDCX status strings → the app's vocabulary. Unknown values stay unknown. */
export function normaliseStatus(raw: string | undefined): ExchangeOrderStatus {
  switch (String(raw ?? "").toLowerCase()) {
    case "initial":
    case "open":
    case "active":
      return "open";
    case "partially_filled":
    case "partially-filled":
      return "partially_filled";
    case "filled":
    case "closed":
    case "completed":
      return "filled";
    case "cancelled":
    case "canceled":
      return "cancelled";
    case "rejected":
    case "expired":
      return "rejected";
    default:
      return "unknown";
  }
}

/** The app's order vocabulary → the enum this build is allowed to send. */
export function toVenueOrderType(type: ExchangeOrderType): "market_order" | "limit_order" {
  if (type === "market") return "market_order";
  if (type === "limit") return "limit_order";
  throw new ExchangeError(
    `CoinDCX order type "${type}" is not used by this build. Position take-profit/stop-loss is sent through positions/create_tpsl instead.`,
    "EXCHANGE_NOT_SUPPORTED",
    422,
    { exchange: "coindcx", orderType: type }
  );
}

export function normaliseOrder(row: OrderRow): ExchangeOrder {
  const exchangeSymbol = String(row.pair ?? "").toUpperCase();
  const total = num(row.total_quantity);
  const remaining = num(row.remaining_quantity);
  const price = row.price === null || row.price === undefined ? null : num(row.price);
  return {
    id: String(row.id ?? ""),
    symbol: toInternalSymbol(exchangeSymbol),
    exchangeSymbol,
    side: String(row.side ?? "buy").toLowerCase() === "sell" ? "sell" : "buy",
    type: normaliseOrderType(row.order_type),
    status: normaliseStatus(row.status),
    rawStatus: String(row.status ?? ""),
    price,
    stopPrice: row.stop_price === null || row.stop_price === undefined ? null : num(row.stop_price),
    quantity: total,
    filledQuantity: Math.max(0, total - remaining),
    remainingQuantity: remaining,
    averagePrice: row.avg_price === null || row.avg_price === undefined ? null : num(row.avg_price) || null,
    leverage: row.leverage === null || row.leverage === undefined ? null : num(row.leverage),
    reduceOnly: false,
    createdAt: row.created_at ? num(row.created_at) : null,
    updatedAt: row.updated_at ? num(row.updated_at) : null,
  };
}

function normaliseOrderType(raw: string | undefined): ExchangeOrderType {
  const value = String(raw ?? "").toLowerCase();
  if (value.includes("market") && !value.includes("stop")) return "market";
  if (value.includes("stop_market")) return "stop_market";
  if (value.includes("stop_limit")) return "stop_limit";
  return "limit";
}

/** One page of the account's recent orders (no status filter — see caveats). */
export async function listOrdersPage(
  client: CoinDcxClient,
  options: { page?: number; size?: number } = {}
): Promise<ExchangeOrder[]> {
  const rows = await client.read<OrderRow[]>("/exchange/v1/derivatives/futures/orders", {
    page: options.page ?? 1,
    size: options.size ?? LIST_PAGE_SIZE,
    margin_currency_short_name: [...MARGIN],
  });
  // A non-list answer here would let reconciliation claim "not found" (and so
  // permit a retry) on a payload it never actually understood.
  return expectArray<OrderRow>(rows, "/exchange/v1/derivatives/futures/orders").map(normaliseOrder);
}

/** Open (working, not yet filled/cancelled) orders across all pairs. */
export async function openOrders(client: CoinDcxClient): Promise<ExchangeOrder[]> {
  const page = await listOrdersPage(client, { page: 1, size: LIST_PAGE_SIZE });
  return page.filter((order) => order.status === "open" || order.status === "partially_filled");
}

/** Best-effort single order lookup: the reference has no by-id GET. */
export async function findOrderById(client: CoinDcxClient, id: string, pages = 3): Promise<ExchangeOrder | null> {
  for (let page = 1; page <= pages; page++) {
    const rows = await listOrdersPage(client, { page, size: LIST_PAGE_SIZE });
    const match = rows.find((order) => order.id === id);
    if (match) return match;
    if (rows.length < LIST_PAGE_SIZE) return null;
  }
  return null;
}

export type ReconcileVerdict =
  | { status: "found"; order: ExchangeOrder }
  | { status: "not_found"; scanned: number }
  | { status: "unknown"; reason: string; scanned: number };

/**
 * Decide what happened to a submission whose response we never saw.
 *
 * Deliberately conservative:
 *   - a positive match requires exactly ONE candidate in the window
 *   - "not_found" is only returned when the scan provably reached the end of
 *     the order history; if more pages exist, the verdict is "unknown"
 *   - the caller may only treat "not_found" as permission to act again
 */
export async function reconcileSubmission(
  client: CoinDcxClient,
  request: { symbol: string; side: "buy" | "sell"; quantity: number; sinceMs: number; tolerancePct?: number },
  pages = 3
): Promise<ReconcileVerdict> {
  const pair = toExchangeSymbol(request.symbol, "coindcx");
  const tolerance = (request.tolerancePct ?? 0.5) / 100;
  const earliest = request.sinceMs - 5_000;
  const candidates: ExchangeOrder[] = [];
  let scanned = 0;
  let exhausted = false;

  for (let page = 1; page <= pages; page++) {
    const rows = await listOrdersPage(client, { page, size: LIST_PAGE_SIZE });
    scanned += rows.length;
    for (const order of rows) {
      if (order.exchangeSymbol !== pair) continue;
      if (order.side !== request.side) continue;
      if (order.createdAt === null || order.createdAt < earliest) continue;
      const ratio = request.quantity > 0 ? Math.abs(order.quantity - request.quantity) / request.quantity : 1;
      if (ratio <= tolerance) candidates.push(order);
    }
    if (rows.length < LIST_PAGE_SIZE) {
      exhausted = true;
      break;
    }
  }

  if (candidates.length === 1) return { status: "found", order: candidates[0]! };
  if (candidates.length > 1) {
    return {
      status: "unknown",
      reason: `${candidates.length} matching orders in the window — an operator must decide which one this submission created.`,
      scanned,
    };
  }
  if (!exhausted) {
    return {
      status: "unknown",
      reason: `Order scan covered ${scanned} rows but the venue has more history than this scan reached.`,
      scanned,
    };
  }
  return { status: "not_found", scanned };
}

export interface SubmitResult {
  order: ExchangeOrder;
  /** Raw venue payload, kept for the audit trail (never contains credentials). */
  raw: unknown;
}

/**
 * Create one order. The caller (src/app/api/orders/route.ts) has already
 * claimed the idempotency key and run the risk engine; this function does the
 * venue-context read, the leverage alignment and the single submission.
 */
export async function createOrder(client: CoinDcxClient, request: ExchangeOrderRequest): Promise<SubmitResult> {
  const pair = toExchangeSymbol(request.symbol, "coindcx");
  const venueType = toVenueOrderType(request.type);

  if (request.quantity <= 0 || !Number.isFinite(request.quantity)) {
    throw new ExchangeError("Order quantity must be a positive number.", "EXCHANGE_BAD_REQUEST", 422, { exchange: "coindcx", pair });
  }
  if (request.type === "limit" && (request.price === null || request.price === undefined || request.price <= 0)) {
    throw new ExchangeError("A limit order needs a positive price.", "EXCHANGE_BAD_REQUEST", 422, { exchange: "coindcx", pair });
  }

  // Venue context FIRST: leverage must already match or the venue rejects the
  // order outright (documented 422). If we cannot read the position we do not
  // guess — we fail closed, exactly as the previous gateway flow did.
  const existing = await positionFor(client, request.symbol);
  const desiredLeverage = request.leverage ?? existing?.leverage ?? null;
  if (desiredLeverage && existing && existing.leverage && desiredLeverage !== existing.leverage) {
    await updateLeverage(client, request.symbol, desiredLeverage);
  }

  const order: Record<string, unknown> = {
    side: request.side,
    pair,
    order_type: venueType,
    total_quantity: String(request.quantity),
    notification: "no_notification",
    margin_currency_short_name: [...MARGIN],
  };
  if (request.type === "limit") {
    order.price = String(request.price);
    order.time_in_force = "good_till_cancel";
  }
  if (desiredLeverage) order.leverage = desiredLeverage;
  if (request.reduceOnly) {
    // CoinDCX expresses "reduce only" by closing the position
    // (positions/exit); there is no reduce-only flag on orders/create.
    throw new ExchangeError(
      "CoinDCX has no reduce-only flag on order creation; close the position with positions/exit instead.",
      "EXCHANGE_NOT_SUPPORTED",
      422,
      { exchange: "coindcx", pair }
    );
  }

  const raw = await client.mutate<OrderRow | OrderRow[]>("/exchange/v1/derivatives/futures/orders/create", { order });

  // Documented success shape is an array with one order object. Guard anyway:
  // a "success:false" style answer must never be recorded as a submission.
  if (raw && typeof raw === "object" && !Array.isArray(raw) && (raw as { success?: boolean }).success === false) {
    throw new ExchangeError(
      `CoinDCX refused the order: ${JSON.stringify((raw as { error?: unknown; message?: unknown }).error ?? (raw as { message?: unknown }).message ?? "no reason given")}`,
      "EXCHANGE_BAD_REQUEST",
      400,
      { exchange: "coindcx", pair }
    );
  }
  const first = Array.isArray(raw) ? raw[0] : (raw as OrderRow | null);
  if (!first || !first.id) {
    throw new ExchangeError(
      "CoinDCX answered the order request without an order id, so the submission cannot be confirmed.",
      "EXCHANGE_UNKNOWN_RESULT",
      502,
      { exchange: "coindcx", pair, reconcilable: true }
    );
  }
  return { order: normaliseOrder(first), raw };
}

/** Cancel one order by venue id. Documented reply: { message: "success", status: 200 }. */
export async function cancelOrder(client: CoinDcxClient, id: string): Promise<{ message: string; raw: unknown }> {
  if (!id) throw new ExchangeError("cancelOrder needs a venue order id.", "EXCHANGE_BAD_REQUEST", 422, { exchange: "coindcx" });
  const raw = await client.mutate<{ message?: string; status?: number }>("/exchange/v1/derivatives/futures/orders/cancel", { id });
  return { message: String(raw?.message ?? "unknown"), raw };
}
