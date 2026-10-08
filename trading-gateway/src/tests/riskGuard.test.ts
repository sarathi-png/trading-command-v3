/**
 * Risk guard: the same limits the application enforces, plus the gateway's own
 * ceilings, plus the fail-closed rule for an unverifiable daily P&L.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateOrderRisk,
  normalizeRiskLimits,
  type RiskContext,
  type RiskLimits,
} from "../risk/riskGuard.js";

const LIMITS: RiskLimits = {
  maxDailyLoss: 200,
  maxOrderValue: 5000,
  maxLeverage: 10,
  maxOpenPositions: 4,
};

const CEILINGS = { maxDailyLoss: 200, maxOrderValue: 5000, maxLeverage: 10, maxOpenPositions: 4 };

function context(overrides: Partial<RiskContext> = {}): RiskContext {
  return {
    limits: LIMITS,
    openSymbols: [],
    currentNotional: 0,
    equity: 10_000,
    dailyRealizedPnl: 0,
    ...overrides,
  };
}

test("risk: an order inside every limit is allowed", () => {
  const verdict = evaluateOrderRisk(
    { symbol: "BTCUSD", qty: 0.01, price: 60_000, reduceOnly: false },
    context()
  );
  assert.equal(verdict.allowed, true);
  assert.equal(verdict.code, "ok");
  assert.equal(verdict.orderValue, 600);
});

test("risk: unknown daily P&L blocks trading (the liveRealizedPnlToday safety net)", () => {
  const verdict = evaluateOrderRisk(
    { symbol: "BTCUSD", qty: 0.01, price: 60_000, reduceOnly: false },
    context({ dailyRealizedPnl: null })
  );
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.code, "daily_pnl_unavailable");
  assert.match(verdict.reason, /cannot be verified/i);
});

test("risk: an unverifiable daily P&L blocks even a perfect, tiny order", () => {
  const verdict = evaluateOrderRisk(
    { symbol: "BTCUSD", qty: 0.0001, price: 10, reduceOnly: false },
    context({ dailyRealizedPnl: null, limits: { ...LIMITS, maxOrderValue: 1_000_000 } })
  );
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.code, "daily_pnl_unavailable");
});

test("risk: the daily loss limit blocks once realised loss reaches it", () => {
  const verdict = evaluateOrderRisk(
    { symbol: "BTCUSD", qty: 0.01, price: 60_000, reduceOnly: false },
    context({ dailyRealizedPnl: -200 })
  );
  assert.equal(verdict.code, "max_daily_loss");
  assert.equal(
    evaluateOrderRisk(
      { symbol: "BTCUSD", qty: 0.01, price: 60_000, reduceOnly: false },
      context({ dailyRealizedPnl: -199.99 })
    ).allowed,
    true
  );
});

test("risk: order value above the cap is blocked", () => {
  const verdict = evaluateOrderRisk(
    { symbol: "BTCUSD", qty: 1, price: 6000, reduceOnly: false },
    context()
  );
  assert.equal(verdict.code, "max_order_value");
  assert.equal(verdict.orderValue, 6000);
});

test("risk: the open-position cap blocks a new symbol but not an existing one", () => {
  const ctx = context({ openSymbols: ["BTCUSD", "ETHUSD", "SOLUSD", "XRPUSD"] });
  assert.equal(
    evaluateOrderRisk({ symbol: "ADAUSD", qty: 1, price: 1, reduceOnly: false }, ctx).code,
    "max_open_positions"
  );
  assert.equal(
    evaluateOrderRisk({ symbol: "ETHUSD", qty: 1, price: 1, reduceOnly: false }, ctx).allowed,
    true
  );
  // Reducing exposure is allowed even at the cap — otherwise a full book could
  // never be de-risked.
  assert.equal(
    evaluateOrderRisk({ symbol: "ADAUSD", qty: 1, price: 1, reduceOnly: true }, ctx).allowed,
    true
  );
});

test("risk: leverage above the cap is blocked, using deployed notional plus the order", () => {
  const verdict = evaluateOrderRisk(
    { symbol: "BTCUSD", qty: 0.01, price: 60_000, reduceOnly: false },
    context({ currentNotional: 20_000, equity: 1_000 })
  );
  assert.equal(verdict.code, "max_leverage");
  assert.match(verdict.reason, /20\.6/);
});

test("risk: invalid symbol, quantity or price are refused", () => {
  const ctx = context();
  assert.equal(evaluateOrderRisk({ symbol: "", qty: 1, price: 1, reduceOnly: false }, ctx).code, "invalid_symbol");
  assert.equal(evaluateOrderRisk({ symbol: "BTCUSD", qty: 0, price: 1, reduceOnly: false }, ctx).code, "invalid_qty");
  assert.equal(evaluateOrderRisk({ symbol: "BTCUSD", qty: 1, price: 0, reduceOnly: false }, ctx).code, "invalid_price");
});

test("risk: caller-supplied limits are clamped to the gateway ceilings", () => {
  const requested = normalizeRiskLimits(
    { maxDailyLoss: 1_000_000, maxOrderValue: 1_000_000, maxLeverage: 40, maxOpenPositions: 30 },
    CEILINGS
  );
  assert.deepEqual(requested, { maxDailyLoss: 200, maxOrderValue: 5000, maxLeverage: 10, maxOpenPositions: 4 });
});

test("risk: nonsense limits fall back to safe defaults instead of disabling a cap", () => {
  const limits = normalizeRiskLimits(
    { maxDailyLoss: -1, maxOrderValue: 0, maxLeverage: NaN, maxOpenPositions: "abc" } as never,
    CEILINGS
  );
  assert.ok(limits.maxDailyLoss > 0);
  assert.ok(limits.maxOrderValue > 0);
  assert.ok(limits.maxLeverage > 0);
  assert.ok(limits.maxOpenPositions > 0);
});

test("risk: tightening beyond the ceiling is allowed (only widening is clamped)", () => {
  const limits = normalizeRiskLimits({ maxOrderValue: 100, maxOpenPositions: 1 }, CEILINGS);
  assert.equal(limits.maxOrderValue, 100);
  assert.equal(limits.maxOpenPositions, 1);
});
