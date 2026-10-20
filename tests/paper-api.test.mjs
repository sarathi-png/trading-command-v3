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

    assert.equal((await fetch(`${url}/api/account`, { headers: { cookie } })).status, 428);
    assert.equal((await fetch(`${url}/api/account`, { headers: { cookie, "x-tc-workspace": "paper" } })).status, 200);

    const request = (route, options = {}) =>
      fetch(`${url}${route}`, {
        ...options,
        headers: {
          ...options.headers,
          cookie,
          authorization: "Bearer paper-test-password",
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

    const firstClientOrderId = `test-${Date.now()}-a`;
    const placed = await json("/api/paper", {
      action: "place",
      symbol: "BTCUSD",
      side: "buy",
      type: "market",
      qty,
      client_order_id: firstClientOrderId,
    }).then((response) => response.json());
    assert.equal(placed.ok, true);
    assert.equal(placed.status, "filled");
    assert.equal(placed.positions.length, 1);
    const position = placed.positions[0];

    // A retried submission with the same key must not open a second position.
    const duplicate = await json("/api/paper", {
      action: "place",
      symbol: "BTCUSD",
      side: "buy",
      type: "market",
      qty,
      client_order_id: firstClientOrderId,
    }).then((response) => response.json());
    assert.equal(duplicate.deduplicated, true);
    assert.equal(duplicate.orderId, placed.orderId);
    assert.equal(duplicate.positions.length, 1);

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

    assert.ok(journal.entries[0].fees > 0, "automatic paper fees include opening and closing commissions");
    assert.ok(journal.entries[0].tags.includes("market-source:demo"));
    assert.deepEqual(journal.entries[0].predictionContext, [], "no invented AI association");
    assert.equal(journal.sync.configured, false);
    assert.equal(journal.fills.length, 0, "no invented CoinDCX activity");
    // The watchlist is user data: saving it must round-trip, not be replaced by
    // the full venue symbol list (the previous behaviour made saving a no-op).
    const watchlist = ["BTCUSD", "DOGEUSD"];
    assert.equal((await json("/api/settings", { watchlist })).status, 200);
    assert.deepEqual((await request("/api/settings").then(r=>r.json())).settings.watchlist, watchlist);
    assert.equal((await json("/api/settings", { watchlist: ["NOTREALUSD"] })).status, 400);
    const known = (await request("/api/market/tickers").then(r=>r.json())).known;
    assert.ok(known.includes("BTCUSD"));
    assert.equal((await json("/api/journal", { action: "seed" })).status, 405);
    assert.equal((await json("/api/journal", { symbol: "BTCUSD", entry: 1, pnl: 10000 })).status, 405);
    assert.equal((await request(`/api/journal?id=${journal.entries[0].id}`, { method: "DELETE" })).status, 405);
    assert.equal((await request("/api/journal", { method: "PATCH", headers: {"content-type":"application/json"}, body: JSON.stringify({ id: journal.entries[0].id, pnl: 10000 }) })).status, 400);
    const annotated = await request("/api/journal", { method: "PATCH", headers: {"content-type":"application/json"}, body: JSON.stringify({ id: journal.entries[0].id, notes: "Review only", tags: ["market-source:live", "review"] }) }).then(r=>r.json());
    assert.equal(annotated.entry.pnl, journal.entries[0].pnl);
    assert.equal(annotated.entry.notes, "Review only");
    assert.ok(annotated.entry.tags.includes("market-source:demo"));
    assert.ok(!annotated.entry.tags.includes("market-source:live"));
    const noLive = await json("/api/journal/sync", {}).then(r=>r.json());
    assert.equal(noLive.sync.configured, false);
    assert.equal(noLive.sync.pairs.length, known.length * 2);
    assert.equal((await json("/api/settings", { usdInrRate: 0 })).status, 400);
    assert.equal((await json("/api/settings", { displayCurrency: "inr", usdInrRate: 88 })).status, 200);
    const unchanged = await request("/api/journal").then(r=>r.json());
    assert.equal(unchanged.entries[0].entry, journal.entries[0].entry, "INR does not change execution units");

    // Partial closes and the remainder must charge each commission/profit once.
    await json("/api/paper", {action:"place",symbol:"BTCUSD",side:"buy",type:"market",qty:qty*2,client_order_id:`test-${Date.now()}-b`});
    await json("/api/paper", {action:"place",symbol:"BTCUSD",side:"sell",type:"market",qty,reduceOnly:true,client_order_id:`test-${Date.now()}-c`});
    const remainder = await request("/api/paper").then(r=>r.json());
    assert.equal(remainder.positions.length, 1);
    await json("/api/paper", {action:"close",symbol:"BTCUSD",positionId:remainder.positions[0].id});
    const completed = await request("/api/journal?export=1").then(r=>r.json());
    assert.equal(completed.entries.length,3);
    const partialRoundTrip = completed.entries.filter(e=>e.openedAt===remainder.positions[0].openedAt);
    assert.equal(partialRoundTrip.length,2);
    for(const row of partialRoundTrip) assert.ok(Math.abs(row.pnl + row.fees - (row.exit-row.entry)*row.qty) < 1e-6, "net plus fees equals that slice's gross profit");
    assert.equal(completed.paperPositions.length,0);
    assert.ok(completed.paperOrders.length>=3);

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

    // Workspace separation is request-local, not a mutable shared mode switch.
    const scoped = (workspace, route, body) => request(route, {
      method: body ? "POST" : "GET",
      headers: { "content-type": "application/json", "x-tc-workspace": workspace },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    // request() supplies explicit operator bearer auth; workspace headers still enforce route boundaries.
    assert.equal((await scoped("paper", "/api/orders")).status, 403);
    assert.equal((await scoped("live", "/api/paper")).status, 403);
    const savePaper = await scoped("paper", "/api/settings", { theme: "dark", onboarded: true, dataSource: "demo" });
    assert.equal(savePaper.status, 200);
    assert.equal((await savePaper.json()).settings.mode, "paper");
    const saveLive = await scoped("live", "/api/settings", { theme: "light", onboarded: true });
    assert.equal(saveLive.status, 200);
    const liveSettings = (await saveLive.json()).settings;
    assert.equal(liveSettings.mode, "live");
    assert.equal(liveSettings.liveArmed, false);
    const [paperProfile, liveProfile] = await Promise.all([
      scoped("paper", "/api/settings").then(r => r.json()),
      scoped("live", "/api/settings").then(r => r.json()),
    ]);
    assert.equal(paperProfile.settings.theme, "dark");
    assert.equal(liveProfile.settings.theme, "light");
    assert.equal((await scoped("paper", "/api/settings", { mode: "live" })).status, 400);
    const liveAccount = await scoped("live", "/api/account");
    assert.equal(liveAccount.status, 500);
    const liveUnavailable = await liveAccount.json();
    assert.equal(liveUnavailable.account, undefined, "Live must never fall back to a paper account");
    assert.match(liveUnavailable.error, /Live account unavailable/);
    const paperJournal = await scoped("paper", "/api/journal?mode=live").then(r => r.json());
    assert.ok(paperJournal.entries.every(e => e.mode === "paper"));
    assert.deepEqual(paperJournal.fills, []);
    const liveJournal = await scoped("live", "/api/journal?mode=paper").then(r => r.json());
    assert.ok(liveJournal.entries.every(e => e.mode === "live"));
    assert.deepEqual(liveJournal.paperOrders, []);
    assert.deepEqual(liveJournal.paperPositions, []);

    const drawingBody = { symbol: "BTCUSD", timeframe: "5m", type: "hline", points: [{ time: 1000, price: 100 }] };
    const normalDrawing = await scoped("paper", "/api/drawings", { ...drawingBody, chartType: "candles" }).then(r => r.json());
    const haDrawing = await scoped("paper", "/api/drawings", { ...drawingBody, chartType: "heikin-ashi" }).then(r => r.json());
    const drawingsFor = type => scoped("paper", `/api/drawings?symbol=BTCUSD&timeframe=5m&chartType=${type}`).then(r => r.json());
    const normalDrawings = (await drawingsFor("candles")).drawings;
    const haDrawings = (await drawingsFor("heikin-ashi")).drawings;
    assert.ok(normalDrawings.some(d => d.id === normalDrawing.drawing.id));
    assert.ok(normalDrawings.every(d => d.id !== haDrawing.drawing.id));
    assert.ok(haDrawings.some(d => d.id === haDrawing.drawing.id));
    assert.ok(haDrawings.every(d => d.id !== normalDrawing.drawing.id));
    const crossEdit = await request("/api/drawings", { method: "PATCH", headers: { "content-type": "application/json", "x-tc-workspace": "paper" }, body: JSON.stringify({ ...drawingBody, id: haDrawing.drawing.id, chartType: "candles", label: "Wrong chart" }) });
    assert.equal(crossEdit.status, 404);
    const rawAnalysis = await scoped("paper", "/api/strategy/evaluate?symbol=BTCUSD&timeframe=5m&chartType=candles").then(r => r.json());
    const signalsBeforeHa = await scoped("paper", "/api/signals").then(r => r.json());
    const haAnalysis = await scoped("paper", "/api/strategy/evaluate?symbol=BTCUSD&timeframe=5m&chartType=heikin-ashi").then(r => r.json());
    const signalsAfterHa = await scoped("paper", "/api/signals").then(r => r.json());
    assert.equal(rawAnalysis.analysis.chartType, "candles");
    assert.equal(haAnalysis.analysis.chartType, "heikin-ashi");
    assert.notEqual(rawAnalysis.analysis.lastClose, haAnalysis.analysis.lastClose);
    assert.equal(signalsBeforeHa.signals.length, signalsAfterHa.signals.length, "HA research must not enter the normal candle signal ledger");


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
