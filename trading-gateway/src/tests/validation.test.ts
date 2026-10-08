/**
 * Order request validation: every malformed shape is refused locally, before
 * any credential is used or any request reaches Delta.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { GatewayError } from "../errors.js";
import {
  assertSymbolAllowed,
  parseCancelBody,
  parseClosePositionBody,
  parseOrderBody,
} from "../middleware/validation.js";

const VALID = {
  symbol: "BTCUSD",
  side: "buy",
  order_type: "market_order",
  size: 1,
  client_order_id: "tc-0123456789abcdef",
};

function expectValidationError(fn: () => unknown, field?: string): void {
  assert.throws(fn, (error: unknown) => {
    if (!(error instanceof GatewayError)) return false;
    if (error.code !== "VALIDATION_ERROR") return false;
    return field ? error.detail.field === field : true;
  });
}

test("validation: a well-formed market order is accepted", () => {
  const parsed = parseOrderBody(VALID);
  assert.equal(parsed.symbol, "BTCUSD");
  assert.equal(parsed.side, "buy");
  assert.equal(parsed.type, "market_order");
  assert.equal(parsed.size, 1);
  assert.equal(parsed.limitPrice, null);
  assert.equal(parsed.reduceOnly, false);
  assert.equal(parsed.clientOrderId, "tc-0123456789abcdef");
});

test("validation: an invalid symbol is refused", () => {
  expectValidationError(() => parseOrderBody({ ...VALID, symbol: "BTC USDT" }), "symbol");
  expectValidationError(() => parseOrderBody({ ...VALID, symbol: "BTC-USD;DROP" }), "symbol");
  expectValidationError(() => parseOrderBody({ ...VALID, symbol: "" }), "symbol");
  expectValidationError(() => parseOrderBody({ ...VALID, symbol: "AB" }), "symbol");
  expectValidationError(() => parseOrderBody({ ...VALID, symbol: 42 }), "symbol");
  // A lowercase symbol is normalised, not rejected.
  assert.equal(parseOrderBody({ ...VALID, symbol: "ethusd" }).symbol, "ETHUSD");
});

test("validation: an invalid side is refused", () => {
  expectValidationError(() => parseOrderBody({ ...VALID, side: "long" }), "side");
  expectValidationError(() => parseOrderBody({ ...VALID, side: "BUY" }), "side");
  expectValidationError(() => parseOrderBody({ ...VALID, side: undefined }), "side");
});

test("validation: an invalid order type is refused", () => {
  expectValidationError(() => parseOrderBody({ ...VALID, order_type: "stop_market" }), "order_type");
  expectValidationError(() => parseOrderBody({ ...VALID, order_type: "bracket_order" }), "order_type");
});

test("validation: an invalid quantity is refused", () => {
  for (const size of [0, -1, NaN, Infinity, "abc", null, undefined]) {
    expectValidationError(() => parseOrderBody({ ...VALID, size }), "size");
  }
});

test("validation: a limit order requires a positive limit price", () => {
  expectValidationError(
    () => parseOrderBody({ ...VALID, order_type: "limit_order" }),
    "limit_price"
  );
  expectValidationError(
    () => parseOrderBody({ ...VALID, order_type: "limit_order", limit_price: -5 }),
    "limit_price"
  );
  const parsed = parseOrderBody({ ...VALID, order_type: "limit_order", limit_price: "89152.5" });
  assert.equal(parsed.type, "limit_order");
  assert.equal(parsed.limitPrice, 89152.5);
});

test("validation: a missing body or non-object body is refused", () => {
  expectValidationError(() => parseOrderBody(null));
  expectValidationError(() => parseOrderBody("BTCUSD"));
  expectValidationError(() => parseOrderBody([]));
});

test("validation: client_order_id is required and capped at Delta's 32 characters", () => {
  expectValidationError(() => parseOrderBody({ ...VALID, client_order_id: "" }), "client_order_id");
  expectValidationError(() => parseOrderBody({ ...VALID, client_order_id: undefined }), "client_order_id");
  expectValidationError(
    () => parseOrderBody({ ...VALID, client_order_id: "tc-" + "a".repeat(40) }),
    "client_order_id"
  );
  expectValidationError(() => parseOrderBody({ ...VALID, client_order_id: "bad id!" }), "client_order_id");
  // 32 characters is exactly the documented maximum and must be accepted.
  const maxId = "a".repeat(32);
  assert.equal(parseOrderBody({ ...VALID, client_order_id: maxId }).clientOrderId, maxId);
});

test("validation: reduce_only must be literally true", () => {
  assert.equal(parseOrderBody({ ...VALID, reduce_only: "true" }).reduceOnly, false);
  assert.equal(parseOrderBody({ ...VALID, reduce_only: true }).reduceOnly, true);
});

test("validation: the underlying hint is sanitised and never trusted as a number", () => {
  const parsed = parseOrderBody({ ...VALID, underlying_assets: ["btc", "ETH", "not a symbol", 7] });
  assert.deepEqual(parsed.underlyings, ["BTC", "ETH"]);
});

test("validation: cancel requires at least one identifier", () => {
  expectValidationError(() => parseCancelBody({}));
  expectValidationError(() => parseCancelBody({ order_id: -3 }), "order_id");
  assert.deepEqual(parseCancelBody({ client_order_id: "tc-1" }), { clientOrderId: "tc-1" });
  assert.deepEqual(parseCancelBody({ order_id: 12345 }), { orderId: 12345 });
});

test("validation: close-position requires a valid symbol", () => {
  expectValidationError(() => parseClosePositionBody({}));
  assert.deepEqual(parseClosePositionBody({ symbol: "btcusd", size: 2 }), { symbol: "BTCUSD", size: 2 });
});

test("validation: the symbol allowlist is enforced when configured", () => {
  assert.doesNotThrow(() => assertSymbolAllowed("BTCUSD", []));
  assert.doesNotThrow(() => assertSymbolAllowed("BTCUSD", ["BTCUSD", "ETHUSD"]));
  assert.throws(() => assertSymbolAllowed("SOLUSD", ["BTCUSD", "ETHUSD"]));
});
