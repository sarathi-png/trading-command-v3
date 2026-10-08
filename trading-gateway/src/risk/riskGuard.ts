/**
 * Gateway risk guard — the last check before an order reaches Delta.
 *
 * This is a deliberate copy of the application's risk layer
 * (src/lib/risk.ts in the repository root): same limits, same block codes, same
 * fail-closed rule for an unverifiable daily P&L. Duplicating it is the point —
 * the gateway is the last hop before the exchange, and a risk layer that only
 * exists upstream disappears the moment anything bypasses the application.
 *
 * It is stricter than the application in two ways:
 *   1. Caller-supplied limits are clamped to server-side ceilings
 *      (GATEWAY_MAX_*), so a bug or a compromised caller cannot widen them.
 *   2. `dailyRealizedPnl` comes from the gateway's own module
 *      (risk/dailyPnl.ts), NOT from the request body. It returns null today,
 *      which blocks live submission at this layer as well.
 *
 * `evaluateOrderRisk` is pure: no database, no clock, no network.
 */

export interface RiskLimits {
  maxDailyLoss: number;
  maxOrderValue: number;
  maxLeverage: number;
  maxOpenPositions: number;
}

export interface RiskCeilings {
  maxDailyLoss: number;
  maxOrderValue: number;
  maxLeverage: number;
  maxOpenPositions: number;
}

export interface RiskInput {
  symbol: string;
  qty: number;
  price: number;
  reduceOnly: boolean;
}

export interface RiskContext {
  limits: RiskLimits;
  /** Symbols that already hold an open position (venue-derived). */
  openSymbols: string[];
  /** Total notional currently deployed, for the leverage test (venue-derived). */
  currentNotional: number;
  /** Account equity used as the leverage denominator (venue-derived). */
  equity: number;
  /**
   * Realised P&L since UTC midnight, or null when it cannot be determined.
   * null BLOCKS trading — see risk/dailyPnl.ts.
   */
  dailyRealizedPnl: number | null;
}

export interface RiskVerdict {
  allowed: boolean;
  code: string;
  reason: string;
  orderValue: number;
}

function block(code: string, reason: string, orderValue: number): RiskVerdict {
  return { allowed: false, code, reason, orderValue };
}

function finite(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

/**
 * Normalise requested limits and clamp them to the gateway ceilings.
 * A ceiling of 0 disables that specific ceiling (useful for tests), but the
 * resulting limit is still a positive finite number.
 */
export function normalizeRiskLimits(
  input: Partial<RiskLimits> | undefined,
  ceilings: RiskCeilings
): RiskLimits {
  const requested: RiskLimits = {
    maxDailyLoss: finite(input?.maxDailyLoss, 200),
    maxOrderValue: finite(input?.maxOrderValue, 5000),
    maxLeverage: Math.min(finite(input?.maxLeverage, 10), 50),
    maxOpenPositions: Math.min(Math.round(finite(input?.maxOpenPositions, 4)), 50),
  };
  const cap = (value: number, ceiling: number): number =>
    ceiling > 0 ? Math.min(value, ceiling) : value;
  return {
    maxDailyLoss: cap(requested.maxDailyLoss, ceilings.maxDailyLoss),
    maxOrderValue: cap(requested.maxOrderValue, ceilings.maxOrderValue),
    maxLeverage: Math.min(cap(requested.maxLeverage, ceilings.maxLeverage), 50),
    maxOpenPositions: Math.min(cap(requested.maxOpenPositions, ceilings.maxOpenPositions), 50),
  };
}

export function evaluateOrderRisk(input: RiskInput, ctx: RiskContext): RiskVerdict {
  const { limits } = ctx;

  if (!input.symbol || typeof input.symbol !== "string") {
    return block("invalid_symbol", "Order has no symbol.", 0);
  }
  if (!Number.isFinite(input.qty) || input.qty <= 0) {
    return block("invalid_qty", `Quantity must be positive, got ${input.qty}.`, 0);
  }
  if (!Number.isFinite(input.price) || input.price <= 0) {
    return block("invalid_price", `Price must be positive, got ${input.price}.`, 0);
  }

  const orderValue = input.qty * input.price;

  if (limits.maxOrderValue > 0 && orderValue > limits.maxOrderValue) {
    return block(
      "max_order_value",
      `Order value $${orderValue.toFixed(2)} exceeds the $${limits.maxOrderValue} limit.`,
      orderValue
    );
  }

  // Fail closed when the daily loss figure is unknown.
  if (ctx.dailyRealizedPnl === null || !Number.isFinite(ctx.dailyRealizedPnl)) {
    return block(
      "daily_pnl_unavailable",
      "Today's realised P&L cannot be verified, so the daily loss limit cannot be enforced. Refusing to trade.",
      orderValue
    );
  }
  if (limits.maxDailyLoss > 0 && ctx.dailyRealizedPnl <= -limits.maxDailyLoss) {
    return block(
      "max_daily_loss",
      `Daily loss limit reached ($${ctx.dailyRealizedPnl.toFixed(2)} <= -$${limits.maxDailyLoss}).`,
      orderValue
    );
  }

  if (
    !input.reduceOnly &&
    !ctx.openSymbols.includes(input.symbol) &&
    limits.maxOpenPositions > 0 &&
    ctx.openSymbols.length >= limits.maxOpenPositions
  ) {
    return block(
      "max_open_positions",
      `Open position limit reached (${ctx.openSymbols.length}/${limits.maxOpenPositions}).`,
      orderValue
    );
  }

  if (limits.maxLeverage > 0 && ctx.equity > 0) {
    const exposure = ctx.currentNotional + orderValue;
    const leverage = exposure / ctx.equity;
    if (leverage > limits.maxLeverage) {
      return block(
        "max_leverage",
        `Exposure ${leverage.toFixed(2)}x equity exceeds the ${limits.maxLeverage}x limit.`,
        orderValue
      );
    }
  }

  return { allowed: true, code: "ok", reason: "Within all risk limits.", orderValue };
}
