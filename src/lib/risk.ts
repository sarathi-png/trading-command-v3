/**
 * Risk evaluation shared by the paper and live order paths.
 *
 * Previously these limits only guarded paper fills: the live route checked
 * that it was *armed* and then sent the order, so `maxDailyLoss`,
 * `maxOrderValue`, `maxOpenPositions` and `maxLeverage` were documented as
 * protecting real orders while in fact applying to none of them. This module is
 * the single implementation both paths call.
 *
 * `evaluateOrderRisk` is deliberately pure: no database, no clock, no network.
 * That keeps it trivially unit-testable and makes the rules auditable in one
 * place.
 */

export interface RiskLimits {
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
  /** Symbols that already hold an open position. */
  openSymbols: string[];
  /** Total notional currently deployed, for the leverage test. */
  currentNotional: number;
  /** Account equity used as the leverage denominator. */
  equity: number;
  /**
   * Realised P&L since UTC midnight, or null when it cannot be determined.
   * null blocks trading: a daily-loss limit that silently assumes zero loss is
   * not a limit.
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

/** Reject absurd limits rather than trusting whatever was written to settings. */
export function normalizeRiskLimits(input: Partial<RiskLimits>): RiskLimits {
  const finite = (v: unknown, fallback: number): number => {
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return n;
  };
  return {
    maxDailyLoss: finite(input.maxDailyLoss, 200),
    maxOrderValue: finite(input.maxOrderValue, 5000),
    maxLeverage: Math.min(finite(input.maxLeverage, 10), 50),
    maxOpenPositions: Math.max(1, Math.min(Math.round(finite(input.maxOpenPositions, 4)), 50)),
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
  if (!Number.isFinite(orderValue)) return block("invalid_order_value", "Order value is not finite.", 0);
  if (!input.reduceOnly && (!Number.isFinite(ctx.equity) || ctx.equity <= 0 ||
      !Number.isFinite(ctx.currentNotional) || ctx.currentNotional < 0)) {
    return block("invalid_risk_context", "Equity or exposure cannot be verified.", orderValue);
  }


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

  if (!input.reduceOnly && limits.maxLeverage > 0 && ctx.equity > 0) {
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

  return {
    allowed: true,
    code: "ok",
    reason: "Within all risk limits.",
    orderValue,
  };
}