/**
 * End-to-end: the Vercel application ↔ CoinDCX boundary.
 *
 * A fake CoinDCX venue (plain node:http, no dependencies) stands in for the
 * real one, and the app is pointed at it with COINDCX_BASE_URL /
 * COINDCX_PUBLIC_BASE_URL. The assertions are about the BOUNDARY, not about
 * CoinDCX's product:
 *
 *   1. Private reads go Vercel → CoinDCX directly, signed with
 *      X-AUTH-APIKEY + X-AUTH-SIGNATURE, and the venue re-verifies the HMAC
 *      over the exact bytes it received.
 *   2. The retired static-IP gateway receives NOTHING: the migration's whole
 *      point is that no middle hop is needed.
 *   3. Live orders fail closed before any venue call whenever today's realised
 *      P&L cannot be verified (unknown ≠ zero).
 *   4. When the figure IS verifiable, the order reaches the venue exactly once,
 *      with the canonical symbol mapped to the venue pair — and "exactly once"
 *      is asserted by counting requests at the venue.
 *   5. Reduce-only is refused locally, because CoinDCX has no such flag and
 *      silently dropping it could increase exposure.
 *   6. Paper trading never touches the venue.
 *   7. No API key, secret or server-only marker reaches any response or any
 *      served JavaScript bundle.
 *
 * The Next server runs in production mode when a build exists (.next/BUILD_ID)
 * and falls back to `next dev` otherwise, so this test is runnable without a
 * full build (the sandbox has no access to fonts.googleapis.com, which
 * `next build` needs for next/font/google in src/app/layout.tsx).
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
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
const COINDCX_API_KEY = "coindcx-api-key-must-never-appear";
const COINDCX_API_SECRET = "coindcx-api-secret-must-never-appear";
const GATEWAY_SECRET = "retired-gateway-secret-must-never-appear";
const DELTA_API_SECRET = "delta-secret-must-never-appear";

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

/**
 * A fake CoinDCX venue.
 *
 * `state.dailyPnlShape` drives the positions/transactions answer:
 *   "array"   → a readable array (the app can prove today's realised P&L)
 *   "unknown" → a payload the adapter cannot interpret (the app must NOT guess)
 */
async function startFakeVenue() {
  const calls = [];
  const state = { dailyPnlShape: "array", pnlToday: -12.5 };

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const url = new URL(req.url, "http://coindcx.mock");
      const body = Buffer.concat(chunks).toString("utf8");
      const signature = String(req.headers["x-auth-signature"] ?? "");
      const expected = body
        ? crypto.createHmac("sha256", COINDCX_API_SECRET).update(body, "utf8").digest("hex")
        : "";
      const parsed = (() => {
        try {
          return JSON.parse(body);
        } catch {
          return null;
        }
      })();
      calls.push({
        method: req.method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        body: parsed,
        rawBody: body,
        apiKey: req.headers["x-auth-apikey"] ?? null,
        signatureValid: signature.length > 0 && signature === expected,
        timestampIsMillis: typeof parsed?.timestamp === "number" && parsed.timestamp > 1e12,
      });

      const send = (status, payload) => {
        const text = JSON.stringify(payload);
        res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) });
        res.end(text);
      };

      const p = url.pathname;

      // ---- private reads -------------------------------------------------
      if (p === "/exchange/v1/derivatives/futures/wallets") {
        send(200, [{ currency_short_name: "USDT", balance: 2500.5, available_balance: 2500.5 }]);
        return;
      }
      if (p === "/exchange/v1/derivatives/futures/wallets/transactions") {
        send(200, [
          { transaction_type: "deposit", amount: 2000, currency_short_name: "USDT", created_at: 1767225600000 },
        ]);
        return;
      }
      if (p === "/exchange/v1/derivatives/futures/trades") {
        // The trades endpoint is per pair and the pair travels in the SIGNED
        // BODY (CoinDCX signs the body, not the query string), so the mock
        // reads it from there rather than from searchParams.
        if (parsed?.pair !== "B-BTC_USDT") {
          send(200, []);
          return;
        }
        send(200, [
          {
            price: 60000,
            quantity: 0.01,
            is_maker: false,
            fee_amount: 3,
            pair: "B-BTC_USDT",
            side: "buy",
            timestamp: 1767225600000,
            order_id: "fill-buy",
          },
          {
            price: 61000,
            quantity: 0.01,
            is_maker: false,
            fee_amount: 3.05,
            pair: "B-BTC_USDT",
            side: "sell",
            timestamp: 1767312000000,
            order_id: "fill-sell",
          },
        ]);
        return;
      }
      if (p === "/exchange/v1/derivatives/futures/positions/transactions") {
        if (state.dailyPnlShape === "unknown") {
          send(200, { unexpected: "shape" });
          return;
        }
        send(200, [
          {
            pair: "B-BTC_USDT",
            stage: "exit",
            amount: state.pnlToday,
            fee_amount: 3.05,
            created_at: Date.now(),
            source: "user",
          },
        ]);
        return;
      }
      if (p === "/exchange/v1/derivatives/futures/positions") {
        send(200, []);
        return;
      }
      if (p === "/exchange/v1/derivatives/futures/orders") {
        send(200, []);
        return;
      }
      if (p === "/exchange/v1/derivatives/futures/orders/create") {
        send(200, [
          {
            id: "venue-order-1",
            pair: "B-BTC_USDT",
            side: "buy",
            status: "initial",
            order_type: "limit_order",
            price: 60000,
            avg_price: 0,
            total_quantity: 0.01,
            remaining_quantity: 0.01,
            cancelled_quantity: 0,
            leverage: 10,
            created_at: Date.now(),
            updated_at: Date.now(),
          },
        ]);
        return;
      }

      // ---- public market data -------------------------------------------
      if (p === "/market_data/v3/current_prices/futures/rt") {
        send(200, { ts: Date.now(), prices: { "B-BTC_USDT": { ls: 60000, pc: 1.2, h: 61000, l: 59000, v: 1000, mp: 60010 } } });
        return;
      }
      if (p === "/exchange/v1/derivatives/futures/data/active_instruments") {
        send(200, [{ pair: "B-BTC_USDT", base_currency_short_name: "BTC", min_quantity: 0.001 }]);
        return;
      }

      send(404, { message: "unknown endpoint" });
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
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

/** A retired-gateway listener: it must never be contacted. */
async function startRetiredGateway() {
  const calls = [];
  const server = http.createServer((req, res) => {
    calls.push(req.url);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  return {
    url: `http://127.0.0.1:${port}`,
    calls,
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

test("Vercel ↔ CoinDCX boundary, paper isolation and live-order safety", { timeout: 180000 }, async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "trading-command-exchange-test-"));
  const port = await reservePort();
  const url = `http://127.0.0.1:${port}`;
  const venue = await startFakeVenue();
  const retiredGateway = await startRetiredGateway();

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
        // that can still stop a live order is the risk layer.
        LIVE_EXECUTION_ENABLED: "true",
        PAPER_TRADING_ENABLED: "true",
        EXCHANGE_MARKET_ENABLED: "false",
        COINDCX_BASE_URL: venue.url,
        COINDCX_PUBLIC_BASE_URL: venue.url,
        COINDCX_API_KEY,
        COINDCX_API_SECRET,
        // Present in the process but must be ignored by the migrated app.
        TRADING_GATEWAY_URL: retiredGateway.url,
        TRADING_GATEWAY_SECRET: GATEWAY_SECRET,
        DELTA_API_KEY: "delta-key-must-never-appear",
        DELTA_API_SECRET,
        NEXT_TELEMETRY_DISABLED: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  const capture = (chunk) => {
    serverOutput = `${serverOutput}${chunk.toString()}`.slice(-6000);
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
    const createCalls = () => venue.calls.filter((call) => call.path.endsWith("/orders/create"));

    // ---- 1. private reads go straight to CoinDCX, signed correctly -------
    const summary = await request("/api/exchange/summary").then((r) => r.json());
    assert.equal(summary.available, true, JSON.stringify(summary));
    assert.equal(summary.balanceUsd, 2500.5);
    assert.equal(summary.fillCount, 2);
    assert.equal(summary.tradeCount, 1);
    // 0.01 BTC at 60k → 61k is +10 USDT, minus both fills' fees (3.00 + 3.05).
    assert.equal(summary.derivedPnlUsd, 3.95, "FIFO P&L must be net of BOTH fills' fees");
    assert.equal(summary.realizedPnlUsd, -12.5, "venue-booked P&L comes from positions/transactions");

    const walletCalls = venue.calls.filter((call) => call.path.endsWith("/wallets"));
    assert.ok(walletCalls.length >= 1, "the wallet endpoint must be called directly on CoinDCX");
    for (const call of venue.calls) {
      assert.equal(call.apiKey, COINDCX_API_KEY, `${call.path} must present the API key header`);
      assert.equal(call.signatureValid, true, `${call.path} must carry a signature over the exact body sent`);
      assert.equal(call.timestampIsMillis, true, `${call.path} must send a millisecond timestamp in the body`);
    }

    // ---- 2. the retired gateway hop is really gone -----------------------
    assert.equal(retiredGateway.calls.length, 0, "the static-IP gateway must not be contacted any more");

    // ---- 3. an unverifiable daily P&L blocks the order BEFORE any venue call
    venue.state.dailyPnlShape = "unknown";
    await json("/api/settings", { onboarded: true, mode: "live" });
    await json("/api/settings", { liveArmed: true, confirm: "ARM-LIVE-TRADING" });

    const blocked = await request("/api/orders", {
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
    assert.equal(blocked.status, 403, await blocked.clone().text());
    const blockedBody = await blocked.json();
    assert.equal(blockedBody.code, "daily_pnl_unavailable");
    assert.match(blockedBody.error, /cannot be verified/i);
    assert.equal(createCalls().length, 0, "a risk-blocked order must never reach the venue");

    // ---- 3b. reduce-only is refused locally (CoinDCX has no such flag) ---
    const reduceOnly = await request("/api/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ symbol: "BTCUSD", side: "sell", type: "market_order", size: 0.01, reduce_only: true }),
    });
    assert.equal(reduceOnly.status, 422);
    assert.equal((await reduceOnly.json()).code, "REDUCE_ONLY_UNSUPPORTED");
    assert.equal(createCalls().length, 0);

    // ---- 4. a verifiable day lets the order through — exactly once -------
    venue.state.dailyPnlShape = "array";
    venue.state.pnlToday = -12.5;
    const placed = await request("/api/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        symbol: "BTCUSD",
        side: "buy",
        type: "limit_order",
        limit_price: 60000,
        size: 0.01,
        client_order_id: "tc-boundary-test-0001",
      }),
    });
    assert.equal(placed.status, 200, await placed.clone().text());
    const placedBody = await placed.json();
    assert.equal(placedBody.ok, true);
    assert.equal(placedBody.order.id, "venue-order-1");

    const creates = createCalls();
    assert.equal(creates.length, 1, "the order must be submitted exactly once");
    assert.equal(creates[0].signatureValid, true);
    assert.equal(creates[0].body.order.pair, "B-BTC_USDT", "the canonical symbol must be mapped to the venue pair");
    assert.equal(creates[0].body.order.order_type, "limit_order");
    assert.equal(creates[0].body.order.total_quantity, "0.01");

    // A repeat of the same client order id is deduplicated, NOT resubmitted.
    const duplicate = await request("/api/orders", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        symbol: "BTCUSD",
        side: "buy",
        type: "limit_order",
        limit_price: 60000,
        size: 0.01,
        client_order_id: "tc-boundary-test-0001",
      }),
    });
    assert.equal(duplicate.status, 200);
    assert.equal((await duplicate.json()).deduplicated, true);
    assert.equal(createCalls().length, 1, "a retried request must not place a second order");

    // ---- 4b. reconciliation endpoint answers honestly --------------------
    const reconciled = await request("/api/orders/status?clientOrderId=tc-boundary-test-0001").then((r) => r.json());
    assert.equal(reconciled.status, "submitted");
    assert.equal(reconciled.exchangeOrderId, "venue-order-1");
    const unknownId = await request("/api/orders/status?clientOrderId=tc-never-seen-0002");
    assert.equal(unknownId.status, 404);

    // ---- 4c. closing a position that does not exist is refused ----------
    const closeFlat = await request("/api/positions/close", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ symbol: "BTCUSD" }),
    });
    assert.equal(closeFlat.status, 409);

    // ---- 5. paper trading never touches the venue ------------------------
    await json("/api/settings", { mode: "paper", dataSource: "demo" });
    const before = venue.calls.length;
    const paper = await json("/api/paper", { action: "place", symbol: "BTCUSD", side: "buy", type: "market", qty: 0.001 });
    assert.equal(paper.ok, true);
    assert.equal(paper.status, "filled");
    assert.equal(venue.calls.length, before, "paper orders must never reach CoinDCX");

    // ---- 6. no secret reaches a response or a bundle ---------------------
    const responses = {
      "/api/settings": JSON.stringify(await request("/api/settings").then((r) => r.json())),
      "/api/settings/exchange-credentials": JSON.stringify(
        await request("/api/settings/exchange-credentials").then((r) => r.json())
      ),
      "/api/system": JSON.stringify(await request("/api/system").then((r) => r.json())),
      "/api/exchange/summary": JSON.stringify(await request("/api/exchange/summary").then((r) => r.json())),
    };
    for (const [name, text] of Object.entries(responses)) {
      for (const secret of [COINDCX_API_SECRET, COINDCX_API_KEY, GATEWAY_SECRET, DELTA_API_SECRET]) {
        assert.ok(!text.includes(secret), `${name} must not contain ${secret.slice(0, 10)}…`);
      }
    }
    // The credential endpoint reports NAMES and hosts only.
    const creds = JSON.parse(responses["/api/settings/exchange-credentials"]);
    assert.equal(creds.configured, true);
    assert.equal(creds.source, "environment");
    // Posting keys to the app is refused rather than silently discarded.
    const attemptedSave = await request("/api/settings/exchange-credentials", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ apiKey: COINDCX_API_KEY, apiSecret: COINDCX_API_SECRET }),
    });
    assert.equal(attemptedSave.status, 409);
    assert.equal((await attemptedSave.json()).code, "CREDENTIALS_ENVIRONMENT_ONLY");

    // ---- 7. served client bundles carry no secret and no server-only code
    const html = await (await request("/")).text();
    const scripts = [...html.matchAll(/src="(\/_next\/[^"]+\.js)"/g)].map((match) => match[1]);
    assert.ok(scripts.length > 3, "expected the page to reference client bundles");
    // Markers unique to the SERVER-ONLY exchange client. If any of these appear
    // in a client bundle, the module was imported from client code and a secret
    // could be read from the browser — the exact failure this design must not
    // have.
    // NOTE: bare environment-variable NAMES are deliberately NOT used as
    // markers — the settings screen renders them by design, so finding one in a
    // bundle is expected. These strings exist only inside the server-only
    // exchange client.
    const serverOnlyMarkers = [
      "X-AUTH-SIGNATURE",
      "positions/create_tpsl",
      "CoinDCX rejected the API key or signature",
      "derivatives/futures/orders/create",
    ];
    for (const script of scripts.slice(0, 30)) {
      const bundle = await (await fetch(`${url}${script}`)).text();
      for (const secret of [COINDCX_API_SECRET, COINDCX_API_KEY, GATEWAY_SECRET, DELTA_API_SECRET]) {
        assert.ok(!bundle.includes(secret), `${script} must not contain ${secret.slice(0, 10)}…`);
      }
      for (const marker of serverOnlyMarkers) {
        assert.ok(
          !bundle.includes(marker),
          `${script} contains server-only marker ${marker} — the exchange client must not be bundled for the browser`
        );
      }
    }
  } finally {
    if (server.exitCode === null) {
      const exited = once(server, "exit");
      server.kill();
      const timeout = setTimeout(() => server.kill("SIGKILL"), 8000);
      await exited;
      clearTimeout(timeout);
    }
    await venue.close();
    await retiredGateway.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
