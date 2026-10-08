/**
 * Deterministic signing vectors.
 *
 * The expected signatures below were produced by an INDEPENDENT implementation
 * (Python's hmac/hashlib) from the documented Delta algorithm:
 *
 *   HMAC_SHA256(secret, METHOD + timestamp + path + queryString + body)
 *
 * Hard-coding them means this test fails if the canonical payload ever changes
 * shape — which is exactly the bug class that silently breaks every private
 * request while still "working" against a mock that does not verify anything.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAuthHeaders,
  buildQueryString,
  buildSignaturePayload,
  buildUrl,
  nowSeconds,
  signRequest,
} from "../delta/signing.js";

const SECRET = "test-secret-abc";

interface Vector {
  name: string;
  method: "GET" | "POST" | "DELETE";
  timestamp: string;
  path: string;
  query?: Record<string, string | number>;
  body?: string;
  payload: string;
  signature: string;
}

const VECTORS: Vector[] = [
  {
    name: "GET without query string",
    method: "GET",
    timestamp: "1700000000",
    path: "/v2/wallet/balances",
    payload: "GET1700000000/v2/wallet/balances",
    signature: "d183c29376291793a157be04e51691507c46348b7b21e032acc91cd49443e9ab",
  },
  {
    name: "GET with query string",
    method: "GET",
    timestamp: "1700000000",
    path: "/v2/wallet/transactions",
    query: { page_size: 200 },
    payload: "GET1700000000/v2/wallet/transactions?page_size=200",
    signature: "301d351c9d9cf60050d3d6a7c43610d09d3b8c9fcca810823eeda8106b98257c",
  },
  {
    name: "POST with JSON body",
    method: "POST",
    timestamp: "1700000001",
    path: "/v2/orders",
    body: '{"product_id":27,"order_type":"market_order","side":"buy","size":1,"reduce_only":false,"client_order_id":"tc-abc123"}',
    payload:
      'POST1700000001/v2/orders{"product_id":27,"order_type":"market_order","side":"buy","size":1,"reduce_only":false,"client_order_id":"tc-abc123"}',
    signature: "d38a11d9f4c0a35734614f49f85513ee1286c8c4c32b4d67e8e082bb1b4e07f2",
  },
  {
    name: "DELETE with JSON body",
    method: "DELETE",
    timestamp: "1700000002",
    path: "/v2/orders",
    body: '{"client_order_id":"tc-abc123"}',
    payload: 'DELETE1700000002/v2/orders{"client_order_id":"tc-abc123"}',
    signature: "5adf9b5755f8ec8fd286d48f7427b2d8ec8e415ffd75a6e3ff872dea223ade50",
  },
  {
    name: "GET with the identifier inside the path",
    method: "GET",
    timestamp: "1700000003",
    path: "/v2/orders/client_order_id/tc-abc123",
    payload: "GET1700000003/v2/orders/client_order_id/tc-abc123",
    signature: "6977e87bc6669d25c86207d5874f5ce6b63c5bdf0b072f0ff6868460443c127a",
  },
  {
    name: "GET with several query parameters",
    method: "GET",
    timestamp: "1700000004",
    path: "/v2/history/candles",
    query: { symbol: "BTCUSD", resolution: "1h", start: 1699999000, end: 1700000000 },
    payload:
      "GET1700000004/v2/history/candles?symbol=BTCUSD&resolution=1h&start=1699999000&end=1700000000",
    signature: "860d412682fc82c158d0f5bb2f690cf2683b201a6aac955d3f7d8514c7de179f",
  },
];

test("signing: deterministic vectors match the documented Delta algorithm", () => {
  for (const vector of VECTORS) {
    const payload = buildSignaturePayload({
      method: vector.method,
      timestamp: vector.timestamp,
      path: vector.path,
      query: vector.query ?? {},
      body: vector.body ?? "",
    });
    assert.equal(payload, vector.payload, `${vector.name}: canonical payload`);

    const signature = signRequest(SECRET, {
      method: vector.method,
      timestamp: vector.timestamp,
      path: vector.path,
      query: vector.query ?? {},
      body: vector.body ?? "",
    });
    assert.equal(signature, vector.signature, `${vector.name}: signature`);
    assert.match(signature, /^[0-9a-f]{64}$/, `${vector.name}: lowercase hex`);
  }
});

test("signing: the timestamp is part of the signature (replay is detectable)", () => {
  const a = signRequest(SECRET, { method: "GET", timestamp: "1700000000", path: "/v2/wallet/balances" });
  const b = signRequest(SECRET, { method: "GET", timestamp: "1700000001", path: "/v2/wallet/balances" });
  assert.notEqual(a, b);
});

test("signing: the method is part of the signature", () => {
  const get = signRequest(SECRET, { method: "GET", timestamp: "1700000000", path: "/v2/orders" });
  const post = signRequest(SECRET, { method: "POST", timestamp: "1700000000", path: "/v2/orders" });
  assert.notEqual(get, post);
});

test("signing: a different secret produces a different signature", () => {
  const input = { method: "GET" as const, timestamp: "1700000000", path: "/v2/wallet/balances" };
  assert.notEqual(signRequest(SECRET, input), signRequest("another-secret", input));
});

test("signing: omitted and empty query parameters do not change the payload", () => {
  const base = buildSignaturePayload({ method: "GET", timestamp: "1", path: "/v2/tickers" });
  const empty = buildSignaturePayload({ method: "GET", timestamp: "1", path: "/v2/tickers", query: {} });
  const undefinedValue = buildSignaturePayload({
    method: "GET",
    timestamp: "1",
    path: "/v2/tickers",
    query: { symbol: undefined },
  });
  assert.equal(base, "GET1/v2/tickers");
  assert.equal(empty, base);
  assert.equal(undefinedValue, base);
});

test("signing: query values are percent-encoded, exactly as they are sent", () => {
  assert.equal(buildQueryString({ symbol: "BTCUSD", note: "a b&c" }), "symbol=BTCUSD&note=a%20b%26c");
  assert.equal(
    buildUrl("https://api.india.delta.exchange", "/v2/orderbook", { symbol: "BTCUSD", limit: 14 }),
    "https://api.india.delta.exchange/v2/orderbook?symbol=BTCUSD&limit=14"
  );
});

test("signing: auth headers carry api-key, timestamp and signature only", () => {
  const headers = buildAuthHeaders("key-1", SECRET, {
    method: "GET",
    timestamp: "1700000000",
    path: "/v2/wallet/balances",
  });
  assert.deepEqual(Object.keys(headers).sort(), ["api-key", "signature", "timestamp"]);
  assert.equal(headers["api-key"], "key-1");
  assert.equal(headers.timestamp, "1700000000");
  assert.equal(headers.signature, VECTORS[0]!.signature);
  // The secret must never be echoed into a header value.
  assert.ok(!JSON.stringify(headers).includes(SECRET));
});

test("signing: timestamps are unix seconds, not milliseconds", () => {
  assert.equal(nowSeconds(1_700_000_000_123), "1700000000");
  assert.equal(nowSeconds(1_700_000_000_999), "1700000000");
});
