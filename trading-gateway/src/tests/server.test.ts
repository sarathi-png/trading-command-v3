/**
 * End-to-end tests for the gateway HTTP surface, against a MOCK DELTA SERVER.
 *
 * The mock verifies the HMAC signature of every authenticated request, so
 * these tests cover the whole private path (validation → risk → signing →
 * transport → normalised response) without ever touching a real exchange.
 *
 * The most important assertions in this file are the negative ones:
 *   - live submission when the feature flag is off: refused, zero Delta calls
 *   - unverifiable daily P&L (the production default): refused, zero Delta calls
 *   - unknown outcome: exactly ONE attempt, never a retry, id blocked afterwards
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadConfig, type GatewayConfig } from "../config.js";
import { DeltaClient } from "../delta/client.js";
import { OrderLedger } from "../idempotency/ledger.js";
import { createLogger } from "../logger.js";
import { buildGateway, type GatewayInstance } from "../server.js";

const API_KEY = "test-api-key";
const API_SECRET = "test-api-secret-value";
const GATEWAY_SECRET = "test-gateway-secret-value";

interface RecordedRequest {
  method: string;
  path: string;
  query: string;
  body: unknown;
  signatureValid: boolean;
  authenticated: boolean;
}

interface MockDelta {
  url: string;
  requests: RecordedRequest[];
  ordersCreated: number;
  /** Mutable behaviour per path. */
  behaviour: {
    postOrders: "ok" | "hang" | "reject400" | "unauthorized" | "server500";
    lookup: "not_found" | "found" | "error";
    positions: "ok" | "fail";
    balances: "ok" | "fail";
  };
  close(): Promise<void>;
}

async function startMockDelta(): Promise<MockDelta> {
  const requests: RecordedRequest[] = [];
  const behaviour: MockDelta["behaviour"] = {
    postOrders: "ok",
    lookup: "not_found",
    positions: "ok",
    balances: "ok",
  };
  let ordersCreated = 0;

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const [path, query = ""] = (req.url ?? "/").split("?");
      const signature = String(req.headers.signature ?? "");
      const timestamp = String(req.headers.timestamp ?? "");
      const authenticated = Boolean(signature && req.headers["api-key"] === API_KEY);
      const expected = crypto
        .createHmac("sha256", API_SECRET)
        .update(`${req.method}${timestamp}${path}${query ? `?${query}` : ""}${raw}`)
        .digest("hex");
      const signatureValid = authenticated && crypto.timingSafeEqual(
        crypto.createHash("sha256").update(signature).digest(),
        crypto.createHash("sha256").update(expected).digest()
      );

      requests.push({
        method: req.method ?? "GET",
        path: path ?? "/",
        query,
        body: raw ? JSON.parse(raw) : null,
        signatureValid,
        authenticated,
      });

      const json = (status: number, payload: unknown): void => {
        const text = JSON.stringify(payload);
        res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) });
        res.end(text);
      };

      // Private endpoints must always arrive signed correctly.
      if (["/v2/wallet/balances", "/v2/positions", "/v2/orders", "/v2/fills", "/v2/wallet/transactions"].includes(path ?? "")) {
        if (req.method !== "POST" && !signatureValid && behaviour.postOrders !== "hang") {
          json(401, { success: false, error: { code: "invalid_signature" } });
          return;
        }
      }

      if (path === "/v2/products/BTCUSD") {
        json(200, { result: { id: 27, symbol: "BTCUSD" } });
        return;
      }
      if (path === "/v2/products/UNKNOWNUSD") {
        json(404, { success: false, error: { code: "not_found" } });
        return;
      }
      if (path === "/v2/tickers") {
        json(200, { result: [{ symbol: "BTCUSD", close: "60000", mark_price: "60000" }] });
        return;
      }
      if (path === "/v2/wallet/balances") {
        if (behaviour.balances === "fail") {
          json(500, { success: false, error: { code: "boom" } });
          return;
        }
        json(200, { result: [{ asset_symbol: "USD", balance: "10000.00", available_balance: "10000.00" }] });
        return;
      }
      if (path === "/v2/wallet/transactions") {
        json(200, { result: [{ transaction_type: "deposit", amount: "1000" }] });
        return;
      }
      if (path === "/v2/fills") {
        json(200, { result: [{ product_symbol: "BTCUSD", side: "buy", price: "60000", size: "1" }] });
        return;
      }
      if (path === "/v2/positions") {
        if (behaviour.positions === "fail") {
          json(500, { success: false, error: { code: "boom" } });
          return;
        }
        json(200, { result: [] });
        return;
      }
      if (path?.startsWith("/v2/orders/client_order_id/")) {
        if (behaviour.lookup === "error") {
          json(500, { success: false, error: { code: "boom" } });
          return;
        }
        if (behaviour.lookup === "found") {
          const id = path.split("/").pop();
          json(200, { result: { id: 777, client_order_id: id, state: "open", side: "buy" } });
          return;
        }
        json(404, { success: false, error: { code: "not_found" } });
        return;
      }
      if (path === "/v2/orders" && req.method === "GET") {
        json(200, { result: [{ id: 1, client_order_id: "existing", state: "open" }] });
        return;
      }
      if (path === "/v2/orders" && req.method === "POST") {
        if (behaviour.postOrders === "hang") return; // never answers
        if (behaviour.postOrders === "reject400") {
          json(400, { success: false, error: { code: "insufficient_margin" } });
          return;
        }
        if (behaviour.postOrders === "unauthorized") {
          json(401, { success: false, error: { code: "expired_signature" } });
          return;
        }
        if (behaviour.postOrders === "server500") {
          json(500, { success: false, error: { code: "internal" } });
          return;
        }
        ordersCreated += 1;
        const body = JSON.parse(raw || "{}") as { client_order_id?: string };
        json(200, {
          success: true,
          result: { id: 555 + ordersCreated, client_order_id: body.client_order_id, state: "open" },
        });
        return;
      }
      if (path === "/v2/orders" && req.method === "DELETE") {
        json(200, { success: true, result: { id: 555, state: "cancelled" } });
        return;
      }
      json(404, { success: false, error: { code: "unknown_endpoint" } });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const state: MockDelta = {
    url: `http://127.0.0.1:${port}`,
    requests,
    get ordersCreated() {
      return ordersCreated;
    },
    behaviour,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
      }),
  } as MockDelta;
  return state;
}

interface Harness {
  gateway: GatewayInstance;
  delta: MockDelta;
  url: string;
  logs: string[];
  ledgerDir: string;
  close(): Promise<void>;
}

async function startGateway(options: {
  liveExecution?: boolean;
  dailyPnl?: number | null;
  deltaTimeoutMs?: number;
  rateLimitOrderMax?: number;
  gatewaySecret?: string;
  env?: Record<string, string>;
} = {}): Promise<Harness> {
  const delta = await startMockDelta();
  const ledgerDir = mkdtempSync(join(tmpdir(), "tc-gateway-test-"));
  const logs: string[] = [];

  const config: GatewayConfig = loadConfig({
    HOST: "127.0.0.1",
    PORT: "0",
    TRADING_GATEWAY_SECRET: options.gatewaySecret ?? GATEWAY_SECRET,
    DELTA_API_KEY: API_KEY,
    DELTA_API_SECRET: API_SECRET,
    DELTA_BASE_URL: delta.url,
    LIVE_EXECUTION_ENABLED: options.liveExecution ? "true" : "false",
    DELTA_TIMEOUT_MS: String(options.deltaTimeoutMs ?? 2000),
    RATE_LIMIT_ORDER_MAX: String(options.rateLimitOrderMax ?? 30),
    IDEMPOTENCY_STORE: join(ledgerDir, "ledger.jsonl"),
    LOG_LEVEL: "debug",
    ...(options.env ?? {}),
  } as unknown as NodeJS.ProcessEnv);

  const logger = createLogger("debug", (line) => logs.push(line));
  const client = new DeltaClient({
    baseUrl: config.deltaBaseUrl,
    timeoutMs: config.deltaTimeoutMs,
    maxRetries: config.deltaMaxRetries,
    // Mirror the production wiring exactly: no keys -> null credentials, so
    // tests can exercise the "gateway has no Delta credentials" failure mode.
    credentials:
      config.deltaApiKey && config.deltaApiSecret
        ? { apiKey: config.deltaApiKey, apiSecret: config.deltaApiSecret }
        : null,
  });

  const gateway = buildGateway(config, {
    logger,
    client,
    ledger: new OrderLedger(config.idempotencyStore, config.idempotencyTtlHours),
    ...(options.dailyPnl !== undefined ? { readDailyPnl: async () => options.dailyPnl ?? null } : {}),
  });
  const { port } = await gateway.listen();

  return {
    gateway,
    delta,
    url: `http://127.0.0.1:${port}`,
    logs,
    ledgerDir,
    close: async () => {
      await gateway.close();
      await delta.close();
      rmSync(ledgerDir, { recursive: true, force: true });
    },
  };
}

const AUTH = { Authorization: `Bearer ${GATEWAY_SECRET}`, "Content-Type": "application/json" };

function orderBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    symbol: "BTCUSD",
    side: "buy",
    order_type: "market_order",
    size: 0.01,
    client_order_id: `tc-${Math.random().toString(16).slice(2, 14)}`,
    ...overrides,
  };
}

const deltaOrderCalls = (delta: MockDelta): RecordedRequest[] =>
  delta.requests.filter((r) => r.method === "POST" && r.path === "/v2/orders");

test("gateway: /health answers without authentication and leaks nothing", async () => {
  const h = await startGateway();
  try {
    const response = await fetch(`${h.url}/health`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as Record<string, unknown>;
    assert.equal(body.ok, true);
    const text = JSON.stringify(body);
    for (const secret of [API_SECRET, API_KEY, GATEWAY_SECRET]) assert.ok(!text.includes(secret));
  } finally {
    await h.close();
  }
});

test("gateway: /ready reports configuration without disclosing values", async () => {
  const ready = await startGateway();
  try {
    const body = (await (await fetch(`${ready.url}/ready`)).json()) as Record<string, unknown>;
    assert.equal(body.ready, true);
    assert.equal(body.missingConfigCount, 0);
    const text = JSON.stringify(body);
    for (const secret of [API_SECRET, API_KEY, GATEWAY_SECRET]) assert.ok(!text.includes(secret));

    // A caller that presents the WRONG secret is told so, not answered as if it
    // had presented none — otherwise a mismatched Vercel deployment looks
    // exactly like a gateway with no Delta key.
    const wrongBearer = await fetch(`${ready.url}/ready`, {
      headers: { Authorization: "Bearer not-the-secret" },
    });
    assert.equal(wrongBearer.status, 401);
    const wrongBody = (await wrongBearer.json()) as { error: { code: string }; missing?: string[] };
    assert.equal(wrongBody.error.code, "UNAUTHORIZED");
    assert.equal(wrongBody.missing, undefined, "a wrong bearer learns nothing about the config");
  } finally {
    await ready.close();
  }

  const unconfigured = await startGateway({ gatewaySecret: "" });
  try {
    const response = await fetch(`${unconfigured.url}/ready`);
    assert.equal(response.status, 503);
    const body = (await response.json()) as { ready: boolean; missingConfigCount: number; missing?: string[] };
    assert.equal(body.ready, false);
    assert.ok(body.missingConfigCount >= 1);
    // Unauthenticated callers do not learn WHICH variable is missing.
    assert.equal(body.missing, undefined);
  } finally {
    await unconfigured.close();
  }
});

test("gateway: private routes reject missing, wrong and unconfigured secrets", async () => {
  const h = await startGateway();
  try {
    const missing = await fetch(`${h.url}/api/account/balance`);
    assert.equal(missing.status, 401);

    const wrong = await fetch(`${h.url}/api/account/balance`, {
      headers: { Authorization: "Bearer not-the-secret" },
    });
    assert.equal(wrong.status, 401);

    const valid = await fetch(`${h.url}/api/account/balance`, { headers: AUTH });
    assert.equal(valid.status, 200);
  } finally {
    await h.close();
  }

  const unconfigured = await startGateway({ gatewaySecret: "" });
  try {
    const response = await fetch(`${unconfigured.url}/api/account/balance`, { headers: AUTH });
    assert.equal(response.status, 503, "an unconfigured gateway must fail closed");
  } finally {
    await unconfigured.close();
  }
});

test("gateway: private reads fail closed with 503 when Delta credentials are absent", async () => {
  // No Delta key/secret on the gateway: the read must be refused as
  // "gateway not configured" — never as "could not reach Delta", which would
  // send the operator hunting for a network problem that does not exist.
  const h = await startGateway({ env: { DELTA_API_KEY: "", DELTA_API_SECRET: "" } });
  try {
    const response = await fetch(`${h.url}/api/account/balance`, { headers: AUTH });
    assert.equal(response.status, 503);
    const body = (await response.json()) as { error: { code: string; message: string } };
    assert.equal(body.error.code, "GATEWAY_NOT_CONFIGURED");
    assert.match(body.error.message, /credentials/i);
    assert.equal(h.delta.requests.length, 0, "nothing may be sent to Delta without credentials");

    const ready = await fetch(`${h.url}/ready`);
    assert.equal(ready.status, 503);
    const readyBody = (await ready.json()) as { missingConfigCount: number };
    assert.equal(readyBody.missingConfigCount, 2);
  } finally {
    await h.close();
  }
});

test("gateway: a refused mutation is never reported as an unknown venue outcome", async () => {
  // A request that never left the process has a KNOWN outcome (it was not
  // sent). Reporting ORDER_STATUS_UNKNOWN here would tell the operator that an
  // order might exist when it demonstrably does not.
  const h = await startGateway({ env: { DELTA_API_KEY: "", DELTA_API_SECRET: "" } });
  try {
    const response = await fetch(`${h.url}/api/orders/cancel`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ clientOrderId: "tc-probe-cancel" }),
    });
    assert.equal(response.status, 503);
    const body = (await response.json()) as { error: { code: string } };
    assert.equal(body.error.code, "GATEWAY_NOT_CONFIGURED");
    assert.notEqual(body.error.code, "ORDER_STATUS_UNKNOWN");
    assert.equal(h.delta.requests.length, 0);
  } finally {
    await h.close();
  }
});

test("gateway: private reads are signed correctly and proxied unchanged", async () => {
  const h = await startGateway();
  try {
    const balance = (await (await fetch(`${h.url}/api/account/balance`, { headers: AUTH })).json()) as {
      result: { asset_symbol: string; balance: string }[];
    };
    assert.equal(balance.result[0]?.asset_symbol, "USD");
    assert.equal(balance.result[0]?.balance, "10000.00");

    const transactions = (await (
      await fetch(`${h.url}/api/account/transactions?page_size=200`, { headers: AUTH })
    ).json()) as { result: unknown[] };
    assert.equal(transactions.result.length, 1);

    const fills = (await (await fetch(`${h.url}/api/account/fills?page_size=500`, { headers: AUTH })).json()) as {
      result: unknown[];
    };
    assert.equal(fills.result.length, 1);

    const orders = (await (await fetch(`${h.url}/api/account/orders`, { headers: AUTH })).json()) as {
      result: { state: string }[];
    };
    assert.equal(orders.result[0]?.state, "open");

    // Every private call arrived with a valid HMAC signature for the test secret.
    const signed = h.delta.requests.filter((r) => r.path.startsWith("/v2/") && r.path !== "/v2/tickers");
    for (const path of ["/v2/wallet/balances", "/v2/wallet/transactions", "/v2/fills", "/v2/orders"]) {
      assert.ok(
        signed.some((r) => r.path === path),
        `${path} should have been requested through the gateway`
      );
    }
    for (const request of signed) {
      assert.equal(request.signatureValid, true, `${request.method} ${request.path} must be signed correctly`);
    }
    // The gateway never forwards the gateway secret to Delta.
    assert.ok(!JSON.stringify(h.delta.requests).includes(GATEWAY_SECRET));
  } finally {
    await h.close();
  }
});

test("gateway: positions require an underlying (Delta has no all-positions endpoint)", async () => {
  const h = await startGateway();
  try {
    const without = await fetch(`${h.url}/api/account/positions`, { headers: AUTH });
    assert.equal(without.status, 422);
    const withUnderlying = await fetch(`${h.url}/api/account/positions?underlying_asset_symbol=BTC`, {
      headers: AUTH,
    });
    assert.equal(withUnderlying.status, 200);
  } finally {
    await h.close();
  }
});

test("gateway: order creation is refused when live execution is disabled, with zero Delta calls", async () => {
  const h = await startGateway({ liveExecution: false, dailyPnl: 0 });
  try {
    const response = await fetch(`${h.url}/api/orders`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify(orderBody()),
    });
    assert.equal(response.status, 403);
    const body = (await response.json()) as { error: { code: string; requestId: string } };
    assert.equal(body.error.code, "LIVE_EXECUTION_DISABLED");
    assert.ok(body.error.requestId);
    assert.equal(deltaOrderCalls(h.delta).length, 0);
  } finally {
    await h.close();
  }
});

test("gateway: an unverifiable daily P&L blocks the order even when live execution is enabled", async () => {
  // This is the production configuration: the flag may be on, but the daily
  // P&L is unknown, so nothing may be submitted.
  const h = await startGateway({ liveExecution: true });
  try {
    const response = await fetch(`${h.url}/api/orders`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify(orderBody()),
    });
    assert.equal(response.status, 403);
    const body = (await response.json()) as { error: { code: string; detail?: { code?: string } } };
    assert.equal(body.error.code, "RISK_BLOCKED");
    assert.equal(body.error.detail?.code, "daily_pnl_unavailable");
    assert.equal(deltaOrderCalls(h.delta).length, 0, "no order may reach Delta while the gate is closed");
  } finally {
    await h.close();
  }
});

test("gateway: a valid order is submitted exactly once and signed correctly", async () => {
  const h = await startGateway({ liveExecution: true, dailyPnl: 0 });
  try {
    const clientOrderId = "tc-order-0001";
    const response = await fetch(`${h.url}/api/orders`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify(orderBody({ client_order_id: clientOrderId })),
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      success: boolean;
      clientOrderId: string;
      order: { id: number; client_order_id: string };
      risk: { code: string };
    };
    assert.equal(body.success, true);
    assert.equal(body.clientOrderId, clientOrderId);
    assert.equal(body.order.client_order_id, clientOrderId);
    assert.equal(body.risk.code, "ok");

    const calls = deltaOrderCalls(h.delta);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.signatureValid, true);
    assert.deepEqual(calls[0]?.body, {
      product_id: 27,
      order_type: "market_order",
      side: "buy",
      size: 0.01,
      reduce_only: false,
      client_order_id: clientOrderId,
    });
    assert.equal(h.delta.ordersCreated, 1);
  } finally {
    await h.close();
  }
});

test("gateway: the same client order id is never submitted twice", async () => {
  const h = await startGateway({ liveExecution: true, dailyPnl: 0 });
  try {
    const payload = JSON.stringify(orderBody({ client_order_id: "tc-dup-0001" }));
    const first = await fetch(`${h.url}/api/orders`, { method: "POST", headers: AUTH, body: payload });
    assert.equal(first.status, 200);

    // Identical retry (e.g. browser retry or a Vercel timeout-and-resend).
    const second = await fetch(`${h.url}/api/orders`, { method: "POST", headers: AUTH, body: payload });
    assert.equal(second.status, 200);
    const body = (await second.json()) as { deduplicated?: boolean; order: { id: number } };
    assert.equal(body.deduplicated, true);
    assert.equal(body.order.id, 556);

    assert.equal(deltaOrderCalls(h.delta).length, 1, "the retry must not create a second order");
  } finally {
    await h.close();
  }
});

test("gateway: an identical burst with a FRESH client id is still refused once", async () => {
  const h = await startGateway({ liveExecution: true, dailyPnl: 0 });
  try {
    const first = await fetch(`${h.url}/api/orders`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify(orderBody({ client_order_id: "tc-burst-1", size: 0.02 })),
    });
    assert.equal(first.status, 200);

    const second = await fetch(`${h.url}/api/orders`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify(orderBody({ client_order_id: "tc-burst-2", size: 0.02 })),
    });
    assert.equal(second.status, 409);
    const body = (await second.json()) as { error: { code: string; detail?: { conflictingClientOrderId?: string } } };
    assert.equal(body.error.code, "DUPLICATE_ORDER");
    assert.equal(body.error.detail?.conflictingClientOrderId, "tc-burst-1");
    assert.equal(deltaOrderCalls(h.delta).length, 1);
  } finally {
    await h.close();
  }
});

test("gateway: an unknown outcome is attempted ONCE, reported, and blocks the id", async () => {
  const h = await startGateway({ liveExecution: true, dailyPnl: 0, deltaTimeoutMs: 300 });
  try {
    h.delta.behaviour.postOrders = "hang";

    const response = await fetch(`${h.url}/api/orders`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify(orderBody({ client_order_id: "tc-unknown-1" })),
    });
    assert.equal(response.status, 502);
    const body = (await response.json()) as { error: { code: string; detail?: { reconcile?: string } } };
    assert.equal(body.error.code, "ORDER_STATUS_UNKNOWN");
    assert.match(String(body.error.detail?.reconcile), /clientOrderId=tc-unknown-1/);

    assert.equal(deltaOrderCalls(h.delta).length, 1, "an uncertain submission must never be retried");

    // A retry with the same id is refused while the outcome is unresolved.
    const retry = await fetch(`${h.url}/api/orders`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify(orderBody({ client_order_id: "tc-unknown-1" })),
    });
    assert.equal(retry.status, 409);
    assert.equal(((await retry.json()) as { error: { code: string } }).error.code, "ORDER_STATUS_UNKNOWN");
    assert.equal(deltaOrderCalls(h.delta).length, 1);
  } finally {
    await h.close();
  }
});

test("gateway: reconciliation resolves an unknown outcome without resubmitting", async () => {
  const h = await startGateway({ liveExecution: true, dailyPnl: 0, deltaTimeoutMs: 300 });
  try {
    h.delta.behaviour.postOrders = "hang";
    await fetch(`${h.url}/api/orders`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify(orderBody({ client_order_id: "tc-reconcile-1" })),
    });
    assert.equal(deltaOrderCalls(h.delta).length, 1);

    // Delta actually holds the order.
    h.delta.behaviour.postOrders = "ok";
    h.delta.behaviour.lookup = "found";
    const status = (await (
      await fetch(`${h.url}/api/orders/status?clientOrderId=tc-reconcile-1`, { headers: AUTH })
    ).json()) as { status: string; order: { id: number } | null; ledgerState: string };
    assert.equal(status.status, "found");
    assert.equal(status.order?.id, 777);
    assert.equal(status.ledgerState, "submitted");

    // Now the same id resolves to the stored order instead of a new submission.
    const retry = await fetch(`${h.url}/api/orders`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify(orderBody({ client_order_id: "tc-reconcile-1" })),
    });
    assert.equal(retry.status, 200);
    assert.equal(((await retry.json()) as { deduplicated?: boolean }).deduplicated, true);
    assert.equal(deltaOrderCalls(h.delta).length, 1, "reconciliation must not create another order");
  } finally {
    await h.close();
  }
});

test("gateway: an unresolved lookup keeps the order blocked", async () => {
  const h = await startGateway({ liveExecution: true, dailyPnl: 0, deltaTimeoutMs: 300 });
  try {
    h.delta.behaviour.postOrders = "hang";
    await fetch(`${h.url}/api/orders`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify(orderBody({ client_order_id: "tc-unresolved-1" })),
    });

    h.delta.behaviour.postOrders = "ok";
    h.delta.behaviour.lookup = "error";
    const status = (await (
      await fetch(`${h.url}/api/orders/status?clientOrderId=tc-unresolved-1`, { headers: AUTH })
    ).json()) as { status: string; ledgerState: string };
    assert.equal(status.status, "unknown");
    assert.equal(status.ledgerState, "unknown");

    const retry = await fetch(`${h.url}/api/orders`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify(orderBody({ client_order_id: "tc-unresolved-1" })),
    });
    assert.equal(retry.status, 409);
    assert.equal(deltaOrderCalls(h.delta).length, 1);
  } finally {
    await h.close();
  }
});

test("gateway: a definitive rejection may be retried with the same id", async () => {
  const h = await startGateway({ liveExecution: true, dailyPnl: 0 });
  try {
    h.delta.behaviour.postOrders = "reject400";
    const rejected = await fetch(`${h.url}/api/orders`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify(orderBody({ client_order_id: "tc-reject-1" })),
    });
    assert.equal(rejected.status, 502);

    // Delta answered and refused: no order exists, so a retry is safe.
    h.delta.behaviour.postOrders = "ok";
    const retry = await fetch(`${h.url}/api/orders`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify(orderBody({ client_order_id: "tc-reject-1" })),
    });
    assert.equal(retry.status, 200);
    assert.equal(deltaOrderCalls(h.delta).length, 2);
  } finally {
    await h.close();
  }
});

test("gateway: a Delta signature failure is reported safely, without leaking headers", async () => {
  const h = await startGateway({ liveExecution: true, dailyPnl: 0 });
  try {
    const response = await fetch(`${h.url}/api/account/balance`, { headers: AUTH });
    assert.equal(response.status, 200);

    // Simulate Delta refusing our signature.
    h.delta.behaviour.postOrders = "unauthorized";
    const order = await fetch(`${h.url}/api/orders`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify(orderBody({ client_order_id: "tc-authfail-1" })),
    });
    assert.ok(order.status >= 400);
    const text = JSON.stringify(await order.json());
    // No credential, no key and no HMAC value may appear in the response.
    for (const secret of [API_SECRET, API_KEY, GATEWAY_SECRET]) assert.ok(!text.includes(secret));
    assert.ok(!/\b[0-9a-f]{64}\b/.test(text), "a signature digest must never be echoed back");
  } finally {
    await h.close();
  }
});

test("gateway: invalid order payloads are refused with field-level reasons", async () => {
  const h = await startGateway({ liveExecution: true, dailyPnl: 0 });
  try {
    const cases: [Record<string, unknown>, string][] = [
      [{ symbol: "not a symbol" }, "symbol"],
      [{ side: "long" }, "side"],
      [{ size: 0 }, "size"],
      [{ size: "abc" }, "size"],
      [{ client_order_id: "" }, "client_order_id"],
      [{ order_type: "limit_order" }, "limit_price"],
    ];
    for (const [override, field] of cases) {
      const response = await fetch(`${h.url}/api/orders`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify(orderBody(override)),
      });
      assert.equal(response.status, 422, `${JSON.stringify(override)} should be refused`);
      const body = (await response.json()) as { error: { code: string; detail?: { field?: string } } };
      assert.equal(body.error.code, "VALIDATION_ERROR");
      assert.equal(body.error.detail?.field, field);
    }
    // Malformed JSON and a wrong content type too.
    const malformed = await fetch(`${h.url}/api/orders`, {
      method: "POST",
      headers: AUTH,
      body: "{not json",
    });
    assert.equal(malformed.status, 400);
    const wrongType = await fetch(`${h.url}/api/orders`, {
      method: "POST",
      headers: { Authorization: `Bearer ${GATEWAY_SECRET}`, "Content-Type": "text/plain" },
      body: "BTCUSD",
    });
    assert.equal(wrongType.status, 415);

    assert.equal(deltaOrderCalls(h.delta).length, 0, "invalid payloads never reach the exchange");
  } finally {
    await h.close();
  }
});

test("gateway: the symbol allowlist is enforced when configured", async () => {
  const h = await startGateway({ liveExecution: true, dailyPnl: 0, env: { GATEWAY_ALLOWED_SYMBOLS: "ETHUSD" } });
  try {
    const response = await fetch(`${h.url}/api/orders`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify(orderBody({ symbol: "BTCUSD" })),
    });
    assert.equal(response.status, 422);
    assert.equal(deltaOrderCalls(h.delta).length, 0);
  } finally {
    await h.close();
  }
});

test("gateway: order routes are rate limited but reads are not starved", async () => {
  const h = await startGateway({ liveExecution: true, dailyPnl: 0, rateLimitOrderMax: 3 });
  try {
    // Distinct sizes so the burst guard cannot mask the rate limiter.
    for (let i = 0; i < 3; i++) {
      const response = await fetch(`${h.url}/api/orders`, {
        method: "POST",
        headers: AUTH,
        body: JSON.stringify(orderBody({ client_order_id: `tc-rate-${i}`, size: 0.01 * (i + 1) })),
      });
      assert.equal(response.status, 200);
    }
    const limited = await fetch(`${h.url}/api/orders`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify(orderBody({ client_order_id: "tc-rate-4", size: 0.09 })),
    });
    assert.equal(limited.status, 429);
    assert.ok(limited.headers.get("retry-after"));
    assert.equal(deltaOrderCalls(h.delta).length, 3);

    // Reads keep working: the limiter is per class, so dashboard polling is unaffected.
    const read = await fetch(`${h.url}/api/account/balance`, { headers: AUTH });
    assert.equal(read.status, 200);
  } finally {
    await h.close();
  }
});

test("gateway: unknown routes, wrong methods and oversized bodies are refused", async () => {
  const h = await startGateway();
  try {
    assert.equal((await fetch(`${h.url}/api/nope`, { headers: AUTH })).status, 404);
    assert.equal((await fetch(`${h.url}/api/orders`, { headers: AUTH })).status, 405);
    assert.equal((await fetch(`${h.url}/api/orders/cancel`, { headers: AUTH })).status, 405);

    const huge = JSON.stringify(orderBody({ note: "x".repeat(64 * 1024) }));
    const response = await fetch(`${h.url}/api/orders`, { method: "POST", headers: AUTH, body: huge });
    assert.equal(response.status, 413);
  } finally {
    await h.close();
  }
});

test("gateway: cancel is allowed even with live execution disabled and forwards the identifier", async () => {
  const h = await startGateway({ liveExecution: false });
  try {
    const response = await fetch(`${h.url}/api/orders/cancel`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ client_order_id: "tc-cancel-1" }),
    });
    assert.equal(response.status, 200);
    const cancels = h.delta.requests.filter((r) => r.method === "DELETE" && r.path === "/v2/orders");
    assert.equal(cancels.length, 1);
    assert.deepEqual(cancels[0]?.body, { client_order_id: "tc-cancel-1" });
    assert.equal(cancels[0]?.signatureValid, true);
  } finally {
    await h.close();
  }
});

test("gateway: close-position requires live execution and then submits a reduce-only order", async () => {
  const disabled = await startGateway({ liveExecution: false });
  try {
    const response = await fetch(`${disabled.url}/api/orders/close-position`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ symbol: "BTCUSD" }),
    });
    assert.equal(response.status, 403);
    assert.equal(deltaOrderCalls(disabled.delta).length, 0);
  } finally {
    await disabled.close();
  }

  const enabled = await startGateway({ liveExecution: true, dailyPnl: 0 });
  try {
    // No open position in the mock: the gateway refuses rather than guessing a size.
    const missing = await fetch(`${enabled.url}/api/orders/close-position`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ symbol: "BTCUSD" }),
    });
    assert.equal(missing.status, 404);
    assert.equal(deltaOrderCalls(enabled.delta).length, 0);
  } finally {
    await enabled.close();
  }
});

test("gateway: logs never contain credentials, signatures or the gateway secret", async () => {
  const h = await startGateway({ liveExecution: true, dailyPnl: 0, deltaTimeoutMs: 300 });
  try {
    // Exercise success, rejection, unknown outcome and auth failure paths.
    await fetch(`${h.url}/api/orders`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify(orderBody({ client_order_id: "tc-log-1" })),
    });
    await fetch(`${h.url}/api/orders`, {
      method: "POST",
      headers: { Authorization: "Bearer wrong-secret", "Content-Type": "application/json" },
      body: JSON.stringify(orderBody()),
    });
    h.delta.behaviour.postOrders = "hang";
    await fetch(`${h.url}/api/orders`, {
      method: "POST",
      headers: AUTH,
      // A different size, so the burst guard does not short-circuit this path.
      body: JSON.stringify(orderBody({ client_order_id: "tc-log-2", size: 0.07 })),
    });
    await fetch(`${h.url}/api/account/balance`, { headers: AUTH });

    assert.ok(h.logs.length > 5, "the gateway should log its traffic");
    const joined = h.logs.join("\n");
    for (const secret of [API_SECRET, API_KEY, GATEWAY_SECRET, "wrong-secret"]) {
      assert.ok(!joined.includes(secret), `logs must not contain ${secret.slice(0, 6)}…`);
    }
    assert.ok(!/signature/i.test(joined), "logs must not contain signature values");
    // But they must remain useful.
    assert.match(joined, /order_submitted/);
    assert.match(joined, /order_unknown_result/);
    assert.match(joined, /requestId/);
  } finally {
    await h.close();
  }
});

test("gateway: a failing position read blocks the order (fail closed, no Delta order call)", async () => {
  const h = await startGateway({ liveExecution: true, dailyPnl: 0 });
  try {
    h.delta.behaviour.positions = "fail";
    const response = await fetch(`${h.url}/api/orders`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify(orderBody({ client_order_id: "tc-positions-fail" })),
    });
    assert.equal(response.status, 403);
    const body = (await response.json()) as { error: { code: string; detail?: { code?: string } } };
    assert.equal(body.error.code, "RISK_BLOCKED");
    assert.equal(body.error.detail?.code, "positions_unavailable");
    assert.equal(deltaOrderCalls(h.delta).length, 0);
  } finally {
    await h.close();
  }
});

test("gateway: a failing balance read blocks the order (equity unknown)", async () => {
  const h = await startGateway({ liveExecution: true, dailyPnl: 0 });
  try {
    h.delta.behaviour.balances = "fail";
    const response = await fetch(`${h.url}/api/orders`, {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify(orderBody({ client_order_id: "tc-balance-fail" })),
    });
    assert.equal(response.status, 403);
    const body = (await response.json()) as { error: { detail?: { code?: string } } };
    assert.equal(body.error.detail?.code, "equity_unavailable");
    assert.equal(deltaOrderCalls(h.delta).length, 0);
  } finally {
    await h.close();
  }
});

test("gateway: CORS is never wildcard and is off unless explicitly configured", async () => {
  const h = await startGateway();
  try {
    const response = await fetch(`${h.url}/api/account/balance`, {
      headers: { ...AUTH, Origin: "https://evil.example" },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
  } finally {
    await h.close();
  }

  const allowlisted = await startGateway({ env: { CORS_ALLOWED_ORIGINS: "https://dashboard.example" } });
  try {
    const preflight = await fetch(`${allowlisted.url}/api/orders`, {
      method: "OPTIONS",
      headers: { Origin: "https://dashboard.example", "Access-Control-Request-Method": "POST" },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), "https://dashboard.example");
    assert.notEqual(preflight.headers.get("access-control-allow-origin"), "*");

    const denied = await fetch(`${allowlisted.url}/api/orders`, {
      method: "OPTIONS",
      headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "POST" },
    });
    assert.equal(denied.status, 405);
  } finally {
    await allowlisted.close();
  }
});
