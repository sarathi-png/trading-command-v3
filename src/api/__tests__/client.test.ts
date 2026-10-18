/**
 * API client tests.
 *
 * The mobile app is a client of the desktop backend, so the contract that
 * matters is: which URL is called, which headers travel with it, and how a
 * server error is surfaced. A tiny mock server stands in for the real API.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";

import { api, ApiError, configureApi, normaliseBaseUrl } from "../client";

interface Recorded {
  url: string;
  headers: Record<string, string | string[] | undefined>;
  method: string;
  body: string;
}

async function startMock(
  handler: (recorded: Recorded) => { status: number; body: unknown }
): Promise<{ server: Server; url: string; recorded: Recorded[] }> {
  const recorded: Recorded[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const entry: Recorded = {
        url: request.url ?? "",
        headers: request.headers,
        method: request.method ?? "GET",
        body,
      };
      recorded.push(entry);
      const result = handler(entry);
      response.writeHead(result.status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(result.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return { server, url: `http://127.0.0.1:${port}`, recorded };
}

function stop(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

test("requests carry the bearer token and the workspace header", async () => {
  const mock = await startMock(() => ({ status: 200, body: { settings: {}, capabilities: {} } }));
  try {
    configureApi({ baseUrl: mock.url, password: "secret", workspace: "paper" });
    await api.settings();
    const request = mock.recorded[0];
    assert.equal(request.headers.authorization, "Bearer secret");
    assert.equal(request.headers["x-tc-workspace"], "paper");
    assert.equal(request.url, "/api/settings");
  } finally {
    await stop(mock.server);
  }
});

test("the workspace header changes with the selected workspace", async () => {
  const mock = await startMock(() => ({ status: 200, body: { settings: {}, capabilities: {} } }));
  try {
    configureApi({ baseUrl: mock.url, password: "secret", workspace: "live" });
    await api.settings();
    assert.equal(mock.recorded[0].headers["x-tc-workspace"], "live");
  } finally {
    await stop(mock.server);
  }
});

test("server errors are surfaced with the server's message", async () => {
  const mock = await startMock(() => ({
    status: 403,
    body: { error: "Live trading is not armed. Enable LIVE mode and the master switch first." },
  }));
  try {
    configureApi({ baseUrl: mock.url, password: "secret", workspace: "live" });
    await assert.rejects(
      () => api.placeLiveOrder({ symbol: "BTCUSD", side: "buy", size: 1 }),
      (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, 403);
        assert.match(error.message, /not armed/);
        return true;
      }
    );
  } finally {
    await stop(mock.server);
  }
});

test("a missing server address fails fast with a readable message", async () => {
  configureApi({ baseUrl: "", password: "secret", workspace: "paper" });
  await assert.rejects(
    () => api.account(),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.match(error.message, /server address/i);
      return true;
    }
  );
});

test("query parameters are encoded", async () => {
  const mock = await startMock(() => ({ status: 200, body: { candles: [], source: "demo" } }));
  try {
    configureApi({ baseUrl: mock.url, password: "secret", workspace: "paper" });
    await api.candles("BTCUSD", "15m", 300);
    assert.equal(mock.recorded[0].url, "/api/market/candles?symbol=BTCUSD&timeframe=15m&limit=300");
  } finally {
    await stop(mock.server);
  }
});

test("a live order sends the fields the server expects", async () => {
  const mock = await startMock(() => ({ status: 200, body: { ok: true, clientOrderId: "x" } }));
  try {
    configureApi({ baseUrl: mock.url, password: "secret", workspace: "live" });
    await api.placeLiveOrder({
      symbol: "BTCUSD",
      side: "buy",
      type: "market_order",
      size: 0.5,
      client_order_id: "tc-abc",
    });
    const body = JSON.parse(mock.recorded[0].body);
    assert.equal(body.symbol, "BTCUSD");
    assert.equal(body.side, "buy");
    assert.equal(body.size, 0.5);
    assert.equal(body.client_order_id, "tc-abc");
  } finally {
    await stop(mock.server);
  }
});

test("a base url without a scheme is treated as https", () => {
  assert.equal(normaliseBaseUrl("example.test"), "https://example.test");
  assert.equal(normaliseBaseUrl("  https://example.test/  "), "https://example.test");
  assert.equal(normaliseBaseUrl("http://192.168.1.10:3000"), "http://192.168.1.10:3000");
  assert.equal(normaliseBaseUrl(""), "");
});
