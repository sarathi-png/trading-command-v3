/**
 * Order routes — the only code path in the system that can move real money.
 *
 * POST /api/orders                create an order
 * POST /api/orders/cancel         cancel one open order
 * POST /api/orders/close-position close an open position (reduce-only market)
 * GET  /api/orders/status         reconcile one order by client order id
 *
 * Defences, in order, for a create:
 *   1. server-to-server authentication                    (middleware)
 *   2. rate limit, per caller and gateway-wide             (middleware)
 *   3. LIVE_EXECUTION_ENABLED=true on the gateway          (this file)
 *   4. schema validation (symbol/side/type/size/price/id)  (validation.ts)
 *   5. symbol allowlist                                    (validation.ts)
 *   6. idempotency claim, written durably BEFORE submission (ledger.ts)
 *   7. identical-burst duplicate guard                      (this file)
 *   8. venue-derived risk guard, incl. fail-closed daily P&L (risk/)
 *   9. single, never-retried submission to Delta            (delta/client.ts)
 *  10. unknown-outcome reconciliation, never resubmission   (this file)
 *
 * Steps 3 and 8 mean live orders stay blocked today: LIVE_EXECUTION_ENABLED
 * defaults to false on the gateway, and `liveRealizedPnlToday()` returns null.
 * That is intentional — see risk/dailyPnl.ts.
 */
import type { RouteContext, RouteResult } from "../context.js";
import { cancelOrder, closePosition, createOrder, orderByClientOrderId } from "../delta/orders.js";
import { GatewayError } from "../errors.js";
import { parseCancelBody, parseClosePositionBody, parseOrderBody, assertSymbolAllowed } from "../middleware/validation.js";
import { readVenueContext, referencePrice } from "../risk/accountContext.js";
import { evaluateOrderRisk, normalizeRiskLimits } from "../risk/riskGuard.js";

/** Window in which an identical (symbol, side, size) request is refused. */
const DUPLICATE_WINDOW_MS = 5_000;

export async function handleCreateOrder(ctx: RouteContext): Promise<RouteResult> {
  const { config, ledger, logger, requestId } = ctx;

  // ---- 3. live execution gate (fail closed) ------------------------------
  if (!config.liveExecutionEnabled) {
    logger.warn("order_blocked", {
      requestId,
      reason: "live_execution_disabled",
      endpoint: "POST /api/orders",
    });
    throw new GatewayError(
      "LIVE_EXECUTION_DISABLED",
      403,
      "Live execution is disabled on the gateway (LIVE_EXECUTION_ENABLED=false)."
    );
  }
  if (!config.deltaApiKey || !config.deltaApiSecret) {
    throw new GatewayError(
      "GATEWAY_NOT_CONFIGURED",
      503,
      "Delta API credentials are not configured on the gateway."
    );
  }

  // ---- 4./5. validation --------------------------------------------------
  const order = parseOrderBody(ctx.body);
  assertSymbolAllowed(order.symbol, config.allowedSymbols);

  // Log every order attempt (no credentials, no signatures). Reduce-only closes
  // are allowed to bypass the *position count* limit, but not the daily-loss or
  // order-value limits (see evaluateOrderRisk).
  logger.info("order_request", {
    requestId,
    symbol: order.symbol,
    side: order.side,
    type: order.type,
    size: order.size,
    reduceOnly: order.reduceOnly,
    clientOrderId: order.clientOrderId,
  });

  // ---- 6. idempotency claim, durable BEFORE submission -------------------
  const claim = ledger.begin(order.clientOrderId, {
    symbol: order.symbol,
    side: order.side,
    type: order.type,
    size: order.size,
    reduceOnly: order.reduceOnly,
    requestId,
  });

  if (claim.kind === "duplicate") {
    const record = claim.record;
    logger.warn("order_duplicate", {
      requestId,
      clientOrderId: order.clientOrderId,
      state: record.state,
      symbol: order.symbol,
    });
    if (record.state === "submitted") {
      // Same logical order: return the first result, do not place a second one.
      return {
        status: 200,
        body: {
          success: true,
          deduplicated: true,
          clientOrderId: order.clientOrderId,
          order: record.response ?? null,
          ledgerState: record.state,
          requestId,
        },
      };
    }
    // in_flight (another attempt is unresolved) or unknown (no answer yet).
    throw new GatewayError(
      record.state === "in_flight" ? "DUPLICATE_ORDER" : "ORDER_STATUS_UNKNOWN",
      409,
      record.state === "in_flight"
        ? "An identical client order id is already in flight. Reconcile before retrying."
        : "The outcome of this client order id is unknown at Delta. Reconcile before retrying.",
      {
        clientOrderId: order.clientOrderId,
        ledgerState: record.state,
        reconcile: `GET /api/orders/status?clientOrderId=${order.clientOrderId}`,
      }
    );
  }

  // ---- 7. identical-burst duplicate guard --------------------------------
  const recent = ledger.findRecentByShape(order.symbol, order.side, order.size, DUPLICATE_WINDOW_MS, {
    excludeClientOrderId: order.clientOrderId,
  });
  if (recent) {
    logger.warn("order_duplicate_shape", {
      requestId,
      clientOrderId: order.clientOrderId,
      conflictingClientOrderId: recent.clientOrderId,
      symbol: order.symbol,
      side: order.side,
      size: order.size,
    });
    throw new GatewayError(
      "DUPLICATE_ORDER",
      409,
      `An identical ${order.symbol} ${order.side} ${order.size} order was submitted moments ago. Refusing to duplicate it.`,
      { conflictingClientOrderId: recent.clientOrderId }
    );
  }

  // ---- 8. venue-derived risk guard ---------------------------------------
  const [venue, price] = await Promise.all([
    readVenueContext(ctx.client, { symbol: order.symbol, underlyings: order.underlyings }),
    referencePrice(ctx.client, order.symbol, order.limitPrice),
  ]);

  if (price === null) {
    ledger.markRejected(order.clientOrderId, { reason: "no_reference_price", requestId });
    throw new GatewayError(
      "VALIDATION_ERROR",
      422,
      "Could not determine a reference price for this order, so its risk could not be evaluated.",
      { symbol: order.symbol }
    );
  }

  if (venue.equity === null || venue.equity <= 0) {
    ledger.markRejected(order.clientOrderId, { reason: "equity_unavailable", requestId });
    logger.error("order_blocked", { requestId, reason: "equity_unavailable", symbol: order.symbol });
    throw new GatewayError(
      "RISK_BLOCKED",
      403,
      "Account equity could not be read from Delta, so position limits cannot be enforced. Refusing to trade.",
      { code: "equity_unavailable" }
    );
  }

  if (!venue.complete) {
    ledger.markRejected(order.clientOrderId, { reason: "positions_unavailable", requestId });
    logger.error("order_blocked", { requestId, reason: "positions_unavailable", symbol: order.symbol });
    throw new GatewayError(
      "RISK_BLOCKED",
      403,
      "Open positions could not be read from Delta, so exposure limits cannot be enforced. Refusing to trade.",
      { code: "positions_unavailable" }
    );
  }

  const limits = normalizeRiskLimits(order.riskLimits, {
    maxDailyLoss: config.maxDailyLoss,
    maxOrderValue: config.maxOrderValue,
    maxLeverage: config.maxLeverage,
    maxOpenPositions: config.maxOpenPositions,
  });

  const verdict = evaluateOrderRisk(
    { symbol: order.symbol, qty: order.size, price, reduceOnly: order.reduceOnly },
    {
      limits,
      openSymbols: venue.openSymbols,
      currentNotional: venue.currentNotional,
      equity: venue.equity,
      // Gateway-authoritative: null today, which blocks. Never taken from the body.
      // `ctx.readDailyPnl` is the same function in production; it is injectable
      // only for tests (see GatewayDependencies).
      dailyRealizedPnl: await ctx.readDailyPnl(ctx.client),
    }
  );

  if (!verdict.allowed) {
    ledger.markRejected(order.clientOrderId, {
      reason: verdict.code,
      requestId,
      orderValue: verdict.orderValue,
    });
    logger.warn("risk_block_triggered", {
      requestId,
      clientOrderId: order.clientOrderId,
      symbol: order.symbol,
      side: order.side,
      size: order.size,
      code: verdict.code,
      reason: verdict.reason,
      orderValue: verdict.orderValue,
    });
    throw new GatewayError("RISK_BLOCKED", 403, `Blocked by risk limit: ${verdict.reason}`, {
      code: verdict.code,
      orderValue: Number(verdict.orderValue.toFixed(2)),
    });
  }

  // ---- 9. submit, exactly once -------------------------------------------
  const startedAt = Date.now();
  try {
    const result = await createOrder(ctx.client, {
      symbol: order.symbol,
      side: order.side,
      type: order.type,
      size: order.size,
      reduceOnly: order.reduceOnly,
      clientOrderId: order.clientOrderId,
      limitPrice: order.limitPrice,
    });

    if (result.rejected) {
      ledger.markRejected(order.clientOrderId, { reason: "delta_rejected", requestId });
      logger.warn("order_rejected", {
        requestId,
        clientOrderId: order.clientOrderId,
        symbol: order.symbol,
        side: order.side,
        latencyMs: Date.now() - startedAt,
        deltaStatus: 200,
      });
      throw new GatewayError(
        "DELTA_API_ERROR",
        502,
        "Delta refused the order. Nothing was created; you may retry with the same client_order_id.",
        { clientOrderId: order.clientOrderId, reconcilable: false }
      );
    }

    const response = (result.order ?? null) as Record<string, unknown> | null;
    ledger.markSubmitted(order.clientOrderId, response, {
      meta: { symbol: order.symbol, side: order.side, size: order.size, requestId },
    });
    logger.info("order_submitted", {
      requestId,
      clientOrderId: order.clientOrderId,
      symbol: order.symbol,
      side: order.side,
      type: order.type,
      size: order.size,
      productId: result.productId,
      deltaOrderId: response?.id ?? null,
      latencyMs: Date.now() - startedAt,
      success: true,
    });
    return {
      status: 200,
      body: {
        success: true,
        clientOrderId: order.clientOrderId,
        order: response,
        risk: { code: verdict.code, orderValue: Number(verdict.orderValue.toFixed(2)) },
        requestId,
      },
    };
  } catch (error) {
    // ---- 10. unknown outcome: record it, never resubmit -------------------
    const unknown =
      error instanceof GatewayError && error.code === "DELTA_UNKNOWN_RESULT";
    if (unknown) {
      ledger.markUnknown(order.clientOrderId, { reason: "unknown_result", requestId });
      logger.error("order_unknown_result", {
        requestId,
        clientOrderId: order.clientOrderId,
        symbol: order.symbol,
        side: order.side,
        size: order.size,
        latencyMs: Date.now() - startedAt,
        reconciliationRequired: true,
      });
      throw new GatewayError(
        "ORDER_STATUS_UNKNOWN",
        502,
        "Delta did not confirm the order. The outcome is UNKNOWN — reconcile before doing anything else; do NOT resubmit blindly.",
        {
          clientOrderId: order.clientOrderId,
          reconcile: `GET /api/orders/status?clientOrderId=${order.clientOrderId}`,
        }
      );
    }
    throw error;
  }
}

/**
 * Cancel one open order.
 *
 * Allowed even when LIVE_EXECUTION_ENABLED is false: cancellation can only
 * reduce risk, and being unable to cancel because a flag is off would be a
 * worse failure mode than the flag being off.
 */
export async function handleCancelOrder(ctx: RouteContext): Promise<RouteResult> {
  const request = parseCancelBody(ctx.body);
  const startedAt = Date.now();

  if (request.clientOrderId) {
    const record = ctx.ledger.get(request.clientOrderId);
    if (record?.state === "unknown") {
      // Cancel is the correct remedy for an unknown create: try it, and if the
      // order does not exist Delta's answer tells us nothing was created.
      ctx.logger.warn("cancel_after_unknown", {
        requestId: ctx.requestId,
        clientOrderId: request.clientOrderId,
      });
    }
  }

  const { result } = await cancelOrder(ctx.client, request);

  if (request.clientOrderId) {
    ctx.ledger.markCancelled(request.clientOrderId, { requestId: ctx.requestId });
  }

  ctx.logger.info("order_cancelled", {
    requestId: ctx.requestId,
    clientOrderId: request.clientOrderId ?? null,
    orderId: request.orderId ?? null,
    latencyMs: Date.now() - startedAt,
    success: true,
  });

  return {
    status: 200,
    body: { success: true, cancelled: true, order: result, requestId: ctx.requestId },
  };
}

/**
 * Close an open position with a reduce-only market order.
 *
 * Requires LIVE_EXECUTION_ENABLED (it is still a submission). The size comes
 * from the exchange, and `reduce_only` guarantees it cannot flip exposure.
 * NOTE: this bypasses the daily-P&L gate by design — refusing to *reduce*
 * exposure because a loss limit tripped would trap the position. It is still
 * rate limited, validated and authenticated.
 */
export async function handleClosePosition(ctx: RouteContext): Promise<RouteResult> {
  if (!ctx.config.liveExecutionEnabled) {
    throw new GatewayError(
      "LIVE_EXECUTION_DISABLED",
      403,
      "Live execution is disabled on the gateway (LIVE_EXECUTION_ENABLED=false)."
    );
  }

  const request = parseClosePositionBody(ctx.body);
  const clientOrderId = request.clientOrderId ?? `close-${Date.now().toString(36)}-${ctx.requestId.slice(-8)}`;

  const claim = ctx.ledger.begin(clientOrderId, {
    symbol: request.symbol,
    side: "close",
    kind: "close_position",
    requestId: ctx.requestId,
  });
  if (claim.kind === "duplicate") {
    throw new GatewayError("DUPLICATE_ORDER", 409, "This close-position request was already handled.", {
      clientOrderId,
      ledgerState: claim.record.state,
    });
  }

  const startedAt = Date.now();
  try {
    const { order, productId } = await closePosition(
      ctx.client,
      { symbol: request.symbol, ...(request.size !== undefined ? { size: request.size } : {}) },
      clientOrderId
    );
    const response = (order ?? null) as Record<string, unknown> | null;
    ctx.ledger.markSubmitted(clientOrderId, response, { meta: { requestId: ctx.requestId } });
    ctx.logger.info("position_closed", {
      requestId: ctx.requestId,
      clientOrderId,
      symbol: request.symbol,
      productId,
      latencyMs: Date.now() - startedAt,
      success: true,
    });
    return { status: 200, body: { success: true, clientOrderId, order: response, requestId: ctx.requestId } };
  } catch (error) {
    if (error instanceof GatewayError && error.code === "DELTA_UNKNOWN_RESULT") {
      ctx.ledger.markUnknown(clientOrderId, { reason: "unknown_result", requestId: ctx.requestId });
      throw new GatewayError(
        "ORDER_STATUS_UNKNOWN",
        502,
        "Delta did not confirm the close. The outcome is UNKNOWN — reconcile before retrying.",
        { clientOrderId, reconcile: `GET /api/orders/status?clientOrderId=${clientOrderId}` }
      );
    }
    if (error instanceof GatewayError && error.code !== "DELTA_UNKNOWN_RESULT") {
      ctx.ledger.markRejected(clientOrderId, { reason: error.code, requestId: ctx.requestId });
    }
    throw error;
  }
}

/**
 * Reconcile an order by client order id.
 *
 * This is the ONLY supported way out of an UNKNOWN create: if Delta holds the
 * order, the ledger is upgraded to `submitted` (so the order is never
 * duplicated); if Delta does not, the ledger is marked `rejected` and the
 * caller may submit a new order. A failed lookup changes nothing.
 */
export async function handleOrderStatus(ctx: RouteContext): Promise<RouteResult> {
  const clientOrderId = (ctx.url.searchParams.get("clientOrderId") ?? "").trim();
  if (!/^[A-Za-z0-9._-]{1,32}$/.test(clientOrderId)) {
    throw new GatewayError("VALIDATION_ERROR", 422, "clientOrderId is required and must be 1-32 characters.", {
      field: "clientOrderId",
    });
  }

  const lookup = await orderByClientOrderId(ctx.client, clientOrderId);
  const record = ctx.ledger.get(clientOrderId);

  if (lookup.status === "found") {
    const order = lookup.order as Record<string, unknown>;
    if (record?.state !== "submitted") {
      ctx.ledger.markSubmitted(clientOrderId, order, {
        reconciled: true,
        meta: { requestId: ctx.requestId },
      });
    }
    return {
      status: 200,
      body: {
        success: true,
        clientOrderId,
        status: "found",
        order,
        ledgerState: "submitted",
        requestId: ctx.requestId,
      },
    };
  }

  if (lookup.status === "not_found") {
    if (record && record.state !== "submitted") {
      ctx.ledger.markRejected(clientOrderId, { reason: "reconciled_absent", requestId: ctx.requestId });
    }
    return {
      status: 200,
      body: {
        success: true,
        clientOrderId,
        status: "not_found",
        order: null,
        ledgerState: "rejected",
        requestId: ctx.requestId,
      },
    };
  }

  return {
    status: 200,
    body: {
      success: true,
      clientOrderId,
      status: "unknown",
      order: null,
      ledgerState: record?.state ?? "none",
      reason: lookup.reason,
      requestId: ctx.requestId,
    },
  };
}

