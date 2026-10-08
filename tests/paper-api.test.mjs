import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForServer(server, url, getOutput) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Next.js exited before becoming ready:\n${getOutput()}`);
    }
    try {
      const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`Next.js did not become ready:\n${getOutput()}`);
}

/**
 * The suite normally runs against a production build (`npm test` builds first).
 * When no build exists — e.g. a sandbox that cannot reach fonts.googleapis.com,
 * which `next/font/google` in src/app/layout.tsx needs — it falls back to a dev
 * server so the API contract is still verified.
 */
const hasProductionBuild = existsSync(path.join(projectRoot, ".next", "BUILD_ID"));

test("authenticated read-only to paper order and journal flow", { timeout: 120000 }, async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "trading-command-paper-test-"));
  const port = await reservePort();
  const url = `http://127.0.0.1:${port}`;
  let serverOutput = "";
  const server = spawn(
    process.execPath,
    [
      path.join(projectRoot, "node_modules", "next", "dist", "bin", "next"),
      hasProductionBuild ? "start" : "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        NODE_ENV: hasProductionBuild ? "production" : "development",
        API_PASSWORD: "paper-test-password",
        SESSION_SECRET: "paper-test-session-secret",
        DATA_BACKEND: "file",
        TC_DATA_DIR: dataDir,
        DATABASE_URL: "",
        // Deliberately NOT set: the application must run paper trading with no
        // exchange credentials at all. If a stray COINDCX_API_KEY/SECRET (or a
        // legacy DELTA_*/TRADING_GATEWAY_* variable) were still required here,
        // this test would fail — that is the point.
        COINDCX_API_KEY: "",
        COINDCX_API_SECRET: "",
        DELTA_API_KEY: "",
        DELTA_API_SECRET: "",
        TRADING_GATEWAY_URL: "",
        TRADING_GATEWAY_SECRET: "",
        EXCHANGE_MARKET_ENABLED: "false",
        LIVE_EXECUTION_ENABLED: "false",
        PAPER_TRADING_ENABLED: "true",
        HF_TOKEN: "",
        HF_DATASET_ID: "",
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

    const health = await fetch(`${url}/api/health`).then((response) => response.json());
    assert.equal(health.ok, true);
    assert.equal(health.backend, "file");

    const unauthenticated = await fetch(`${url}/api/settings`);
    assert.equal(unauthenticated.status, 401);

    const login = await fetch(`${url}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "paper-test-password" }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookie, "login should issue a session cookie");

    const request = (route, options = {}) =>
      fetch(`${url}${route}`, {
        ...options,
        headers: {
          ...options.headers,
          cookie,
        },
      });
    const json = (route, body) =>
      request(route, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    // Credentials can no longer be entered from the dashboard at all: the
    // server reads them from its own environment. The refusal must explain that
    // and must not echo anything the caller sent.
    const credentialOverride = await json("/api/settings/exchange-credentials", {
      apiKey: "test-key",
      apiSecret: "test-secret",
    });
    assert.equal(credentialOverride.status, 409);
    const credentialError = await credentialOverride.json();
    assert.match(credentialError.error, /environment/i);
    assert.doesNotMatch(JSON.stringify(credentialError), /paper-test|test-secret|insert into/i);

    // Status reports presence and VARIABLE NAMES (unconfigured here), nothing else.
    const credentialStatus = await request("/api/settings/exchange-credentials").then((r) => r.json());
    assert.equal(credentialStatus.configured, false);
    assert.equal(credentialStatus.source, "none");
    assert.deepEqual(credentialStatus.missing, ["COINDCX_API_KEY", "COINDCX_API_SECRET"]);
    assert.equal(credentialStatus.legacyStoredKeys, false);

    const initialSettings = await request("/api/settings").then((response) => response.json());
    assert.equal(initialSettings.settings.mode, "read_only");
    assert.equal(initialSettings.capabilities.liveExecution, false);
    // No credentials in this test, so private exchange access is off while
    // paper trading keeps working.
    assert.equal(initialSettings.capabilities.exchangeAccountConfigured, false);

    const readOnlyOrder = await json("/api/paper", { symbol: "BTCUSD", qty: 0.001 });
    assert.equal(readOnlyOrder.status, 403);

    const paperMode = await json("/api/settings", {
      onboarded: true,
      mode: "paper",
      dataSource: "demo",
    });
    assert.equal(paperMode.status, 200);

    const market = await request("/api/market/tickers?symbols=BTCUSD").then((response) =>
      response.json()
    );
    assert.equal(market.source, "demo");
    const ticker = market.tickers.find((item) => item.symbol === "BTCUSD");
    assert.ok(ticker?.price > 0);
    const qty = Math.min(0.001, 1000 / ticker.price);

    const placed = await json("/api/paper", {
      action: "place",
      symbol: "BTCUSD",
      side: "buy",
      type: "market",
      qty,
    }).then((response) => response.json());
    assert.equal(placed.ok, true);
    assert.equal(placed.status, "filled");
    assert.equal(placed.positions.length, 1);
    const position = placed.positions[0];

    const closed = await json("/api/paper", {
      action: "close",
      positionId: position.id,
      symbol: position.symbol,
    });
    assert.equal(closed.status, 200);

    const paperState = await request("/api/paper").then((response) => response.json());
    assert.equal(paperState.positions.length, 0);
    assert.ok(paperState.orders.some((order) => order.status === "filled"));

    const journal = await request("/api/journal?mode=paper").then((response) => response.json());
    assert.equal(journal.entries.length, 1);
    assert.equal(journal.entries[0].mode, "paper");
    assert.equal(journal.entries[0].source, "paper");
    assert.ok(Number.isFinite(journal.entries[0].pnl));

    // ---- separation of paper from private/exchange paths -------------------
    // Private CoinDCX reads need credentials; without them they fail closed
    // with a readable message instead of falling back to demo numbers.
    const summary = await request("/api/exchange/summary").then((r) => r.json());
    assert.equal(summary.available, false);
    assert.match(String(summary.error), /not configured/i);

    // ...and nothing about that failure leaks a credential-shaped value.
    const summaryText = JSON.stringify(summary);
    assert.doesNotMatch(summaryText, /paper-test|test-secret|api[_-]?key/i);

    // Paper state still works end to end with exchange credentials absent.
    const paperAfter = await request("/api/paper").then((r) => r.json());
    assert.ok(Array.isArray(paperAfter.orders));
    assert.ok(Array.isArray(paperAfter.positions));

    const liveMode = await json("/api/settings", { mode: "live" });
    assert.equal(liveMode.status, 403);
  } finally {
    if (server.exitCode === null) {
      const exited = once(server, "exit");
      server.kill();
      const timeout = setTimeout(() => server.kill("SIGKILL"), 5000);
      await exited;
      clearTimeout(timeout);
    }
    await rm(dataDir, { recursive: true, force: true });
  }
});
