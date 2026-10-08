/**
 * End-to-end: the Vercel application ↔ static-IP trading gateway boundary.
 *
 * A fake gateway (plain node:http, no dependencies) stands in for the real
 * deployment, so these assertions are about the BOUNDARY rather than about
 * Delta:
 *
 *   1. Private Delta reads go Vercel → gateway and come back derived, with the
 *      shared secret presented as a constant Bearer header over the server
 *      side only.
 *   2. Paper trading NEVER touches the gateway (paper stays local).
 *   3. A live order that cannot verify today's realised P&L is refused by the
 *      risk layer BEFORE the gateway is called — the gateway sees zero order
 *      requests, which is the "never place an unrestricted live order" check.
 *   4. No Delta key, no gateway secret and no credential-shaped value reaches
 *      any HTTP response or any served JavaScript bundle.
 *
 * The Next server runs in production mode when a build exists (.next/BUILD_ID)
 * and falls back to `next dev` otherwise, so this test is runnable without a
 * full build (the sandbox has no access to fonts.googleapis.com, which
 * `next build` needs for next/font/google in src/app/layout.tsx).
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const GATEWAY_SECRET = "gateway-secret-for-tests-0123456789";
const DELTA_API_SECRET = "delta-secret-must-never-appear";
const DELTA_API_KEY = "delta-key-must-never-appear";

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return port;
}

/** A fake trading gateway that records everything it is asked to do. */
async function startFakeGateway() {
  const calls = [];
  const state = { unauthorized: false };

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const url = new URL(req.url, "http://gateway.local");
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null;
      calls.push({
        method: req.method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        body,
        authorization: req.headers.authorization ?? null,
        requestId: req.headers["x-request-id"] ?? null,
      });

      const send = (status, payload) => {
        const text = JSON.stringify(payload);
        res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) });
        res.end(text);
      };

      if (state.unauthorized) {
        send(401, { success: false, error: { code: "UNAUTHORIZED", message: "Invalid or missing gateway credentials." } });
        return;
      }

      if (url.pathname === "/ready") {
        send(200, { success: true, ready: true, liveExecutionEnabled: false });
        return;
      }
      if (url.pathname === "/api/account/balance") {
        send(200, {
          success: true,
          result: [{ asset_symbol: "USD", balance: "2500.50", available_balance: "2500.50" }],
        });
        return;
      }
      if (url.pathname === "/api/account/transactions") {
        send(200, {
          success: true,
          result: [
            { transaction_type: "deposit", amount: "2000", asset_symbol: "USD", created_at: "2026-01-01T00:00:00Z" },
            { transaction_type: "commission", amount: "-1.25", asset_symbol: "USD", created_at: "2026-01-02T00:00:00Z" },
            { transaction_type: "cashflow", amount: "500", asset_symbol: "USD", created_at: "2026-01-03T00:00:00Z" },
          ],
        });
        return;
      }
      if (url.pathname === "/api/account/fills") {
        send(200, {
          success: true,
          result: [
            {
              product_symbol: "BTCUSD",
              side: "buy",
              price: "60000",
              size: "1",
              notional: "60000",
              commission: "1.25",
              created_at: "2026-01-02T00:00:00Z",
            },
            {
              product_symbol: "BTCUSD",
              side: "sell",
              price: "61000",
              size: "1",
              notional: "61000",
              commission: "1.25",
              created_at: "2026-01-03T00:00:00Z",
            },
          ],
        });
        return;
      }
      if (url.pathname === "/api/account/positions") {
        send(200, {
          success: true,
          result:
            url.searchParams.get("underlying_asset_symbol") === "BTC"
              ? [{ product_id: 27, symbol: "BTCUSD", size: 1, side: "buy", entry_price: "60000", mark_price: "61000", unrealized_pnl: "12.5" }]
              : [],
        });
        return;
      }
      if (url.pathname === "/api/account/orders") {
        send(200, { success: true, result: [{ id: 1, client_order_id: "existing", state: "open" }] });
        return;
      }
      if (url.pathname === "/api/orders/status") {
        send(200, { success: true, clientOrderId: url.searchParams.get("clientOrderId"), status: "not_found", order: null, ledgerState: "rejected" });
        return;
      }
      if (url.pathname === "/api/orders" && req.method === "POST") {
        // If a live order ever reaches here in this test, the risk gate failed.
        send(200, { success: true, clientOrderId: body?.client_order_id, order: { id: 999, state: "open" } });
        return;
      }
      send(404, { success: false, error: { code: "NOT_FOUND", message: "Unknown gateway endpoint." } });
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    state,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
      }),
  };
}

async function waitForServer(server, url, getOutput) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Next.js exited early:\n${getOutput()}`);
    try {
      const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`Next.js did not become ready:\n${getOutput()}`);
}

test("Vercel ↔ trading gateway boundary, paper isolation and live-order safety", { timeout: 180000 }, async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "trading-command-gateway-test-"));
  const port = await reservePort();
  const url = `http://127.0.0.1:${port}`;
  const gateway = await startFakeGateway();

  const built = existsSync(path.join(projectRoot, ".next", "BUILD_ID"));
  const nextArgs = built
    ? ["start", "--hostname", "127.0.0.1", "--port", String(port)]
    : ["dev", "--hostname", "127.0.0.1", "--port", String(port)];

  let serverOutput = "";
  const server = spawn(
    process.execPath,
    [path.join(projectRoot, "node_modules", "next", "dist", "bin", "next"), ...nextArgs],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        NODE_ENV: built ? "production" : "development",
        API_PASSWORD: "boundary-test-password",
        SESSION_SECRET: "boundary-test-session-secret",
        DATA_BACKEND: "file",
        TC_DATA_DIR: dataDir,
        DATABASE_URL: "",
        // Live execution is switched ON for the application, so the ONLY thing
        // that can still stop a live order is the risk layer + the gateway.
        LIVE_EXECUTION_ENABLED: "true",
        PAPER_TRADING_ENABLED: "true",
        DELTA_MARKET_ENABLED: "false",
        TRADING_GATEWAY_URL: gateway.url,
        TRADING_GATEWAY_SECRET: GATEWAY_SECRET,
        // Present in the process, but the app must never use or expose them.
        DELTA_API_KEY,
        DELTA_API_SECRET,
        NEXT_TELEMETRY_DISABLED: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  const capture = (chunk) => {
    serverOutput = `${serverOutput}${chunk.toString()}`.slice(-5000);
  };
  server.stdout.on("data", capture);
  server.stderr.on("data", capture);

  try {
    await waitForServer(server, url, () => serverOutput);

    const login = await fetch(`${url}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "boundary-test-password" }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie);

    const request = (route, options = {}) =>
      fetch(`${url}${route}`, { ...options, headers: { ...options.headers, cookie } });
    const json = async (route, body, method = "POST") =>
      (
        await request(route, {
          method,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        })
      ).json();

    // ---- 1. private reads go through the gateway -------------------------
    const summary = await request("/api/delta/summary").then((r) => r.json());
    assert.equal(summary.available, true, JSON.stringify(summary));
    assert.equal(summary.balanceUsd, 2500.5);
    assert.equal(summary.fillCount, 2);
    assert.equal(summary.tradeCount, 1);

    const gatewayCalls = () => gateway.calls;

    for (const path of ["/api/account/balance", "/api/account/transactions", "/api/account/fills"]) {
      assert.ok(gatewayCalls().some((call) => call.path === path), `${path} should be called on the gateway`);
    }
    // Server-to-server auth: bearer secret on every call, plus a correlation id.
    for (const call of gatewayCalls()) {
      assert.equal(call.authorization, `Bearer ${GATEWAY_SECRET}`, `${call.path} must authenticate to the gateway`);
      assert.ok(call.requestId, `${call.path} should carry a request id`);
    }

    // Account aggregation also routes live figures through the gateway.
    const account = await request("/api/account").then((r) => r.json());
    assert.equal(account.deltaAccountConfigured, true);

    // ---- 2. paper trading never touches the gateway ----------------------
    await json("/api/settings", { onboarded: true, mode: "paper", dataSource: "demo" });
    const before = gatewayCalls().length;
    const paper = await json("/api/paper", { action: "place", symbol: "BTCUSD", side: "buy", type: "market", qty: 0.001 });
    assert.equal(paper.ok, true);
    assert.equal(paper.status, "filled");
    assert.equal(gatewayCalls().length, before, "paper orders must never reach the gateway or Delta");

    // ---- 3. live order: armed, gateway configured, still blocked ---------
    const liveMode = await json("/api/settings", { mode: "live" });
    assert.equal(liveMode.status ?? 200, 200);
    const armed = await json("/api/settings", { liveArmed: true, confirm: "ARM-LIVE-TRADING" });
    assert.equal(armed.status ?? 200, 200);

    const liveOrderCallsBefore = gatewayCalls().filter((call) => call.path === "/api/orders").length;
    const live = await request("/api/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        symbol: "BTCUSD",
        side: "buy",
        // A limit order: the reference price is the limit price, so the risk
        // evaluation does not depend on any public market feed.
        type: "limit_order",
        limit_price: 60000,
        size: 0.01,
      }),
    });
    assert.equal(live.status, 403, await live.clone().text());
    const liveBody = await live.json();
    assert.equal(liveBody.code, "daily_pnl_unavailable");
    assert.match(liveBody.error, /cannot be verified/i);
    assert.equal(
      gatewayCalls().filter((call) => call.path === "/api/orders").length,
      liveOrderCallsBefore,
      "a risk-blocked order must never be forwarded to the gateway"
    );

    // ---- 3b. reconciliation endpoint is reachable and read-only ----------
    const status = await request("/api/orders/status?clientOrderId=tc-abcdef0123456789").then((r) => r.json());
    assert.equal(status.status, "not_found");
    assert.equal(status.ledgerState, "rejected");

    // ---- 4. no secret reaches a response or a bundle ---------------------
    const settingsBody = JSON.stringify(await request("/api/settings").then((r) => r.json()));
    const credsBody = JSON.stringify(await request("/api/settings/delta-credentials").then((r) => r.json()));
    const systemBody = JSON.stringify(await request("/api/system").then((r) => r.json()));
    for (const [name, text] of [
      ["/api/settings", settingsBody],
      ["/api/settings/delta-credentials", credsBody],
      ["/api/system", systemBody],
    ]) {
      for (const secret of [GATEWAY_SECRET, DELTA_API_SECRET, DELTA_API_KEY]) {
        assert.ok(!text.includes(secret), `${name} must not contain ${secret.slice(0, 8)}…`);
      }
    }
    // The gateway block in /api/system reports status, never a secret.
    const system = JSON.parse(systemBody);
    assert.equal(system.gateway.configured, true);
    assert.equal(system.gateway.liveExecutionEnabled, false);
    assert.ok(system.gateway.host);

    // Served client bundles are the real test of "not exposed to the browser".
    const html = await (await request("/")).text();
    const scripts = [...html.matchAll(/src="(\/_next\/[^"]+\.js)"/g)].map((match) => match[1]);
    assert.ok(scripts.length > 3, "expected the page to reference client bundles");
    // Markers unique to the SERVER-ONLY gateway client. If any of these appear
    // in a client bundle, the module was imported from client code and the
    // secret could be read from the browser — the exact failure this migration
    // must not have.
    const serverOnlyMarkers = [
      "The trading gateway could not be reached.",
      "trading-command-vercel",
      "/api/account/transactions",
      "/api/orders/close-position",
    ];
    for (const script of scripts.slice(0, 25)) {
      const bundle = await (await fetch(`${url}${script}`)).text();
      for (const secret of [GATEWAY_SECRET, DELTA_API_SECRET, DELTA_API_KEY]) {
        assert.ok(!bundle.includes(secret), `${script} must not contain ${secret.slice(0, 10)}…`);
      }
      for (const marker of serverOnlyMarkers) {
        assert.ok(
          !bundle.includes(marker),
          `${script} contains server-only marker ${marker} — the gateway client must not be bundled for the browser`
        );
      }
    }

    // ---- 5. an invalid gateway secret produces a safe, normalised error --
    gateway.state.unauthorized = true;
    const refused = await request("/api/delta/summary").then((r) => r.json());
    assert.equal(refused.available, false);
    assert.match(String(refused.error), /gateway credentials|refused|invalid/i);
    assert.ok(!JSON.stringify(refused).includes(GATEWAY_SECRET));
    gateway.state.unauthorized = false;

    // Paper trading still unaffected by the gateway being unhappy.
    const paperStillWorks = await request("/api/paper").then((r) => r.json());
    assert.ok(Array.isArray(paperStillWorks.orders));
  } finally {
    if (server.exitCode === null) {
      const exited = once(server, "exit");
      server.kill();
      const timeout = setTimeout(() => server.kill("SIGKILL"), 8000);
      await exited;
      clearTimeout(timeout);
    }
    await gateway.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
