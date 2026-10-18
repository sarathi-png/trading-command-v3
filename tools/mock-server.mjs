/**
 * A development stand-in for the Trading Command backend.
 *
 * The real server lives in the parent repository and needs Postgres and
 * exchange credentials. This mock serves the same routes with deterministic
 * synthetic data, so the mobile app can be run and clicked through without
 * either. It is a development tool: it is NOT a trading system, it holds no
 * credentials, and it never talks to an exchange.
 *
 *   node tools/mock-server.mjs [--port 8081] [--root web-build]
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const args = process.argv.slice(2);
const readArg = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const PORT = Number(readArg("port", process.env.PORT || 8081));
const ROOT = resolve(here, "..", readArg("root", "web-build"));
const PASSWORD = process.env.MOCK_API_PASSWORD || "demo";

/* ------------------------------------------------------------------ */
/* Synthetic market data                                              */
/* ------------------------------------------------------------------ */

const SYMBOLS = ["BTCUSD", "ETHUSD", "SOLUSD", "XRPUSD", "BNBUSD", "DOGEUSD", "ADAUSD", "AVAXUSD"];
const BASE_PRICE = {
  BTCUSD: 61250, ETHUSD: 3420, SOLUSD: 148, XRPUSD: 0.62,
  BNBUSD: 585, DOGEUSD: 0.138, ADAUSD: 0.41, AVAXUSD: 27.4,
};
const TIMEFRAME_MINUTES = { "1m": 1, "5m": 5, "15m": 15, "30m": 30, "1h": 60, "4h": 240, "1d": 1440 };

/** A deterministic pseudo-random generator, so every run looks the same. */
function seeded(seed) {
  let value = seed % 2147483647;
  if (value <= 0) value += 2147483646;
  return () => (value = (value * 16807) % 2147483647) / 2147483647;
}

function symbolSeed(symbol) {
  let total = 0;
  for (const character of symbol) total += character.charCodeAt(0) * 37;
  return total;
}

/** A random walk with a gentle drift, in five-minute steps. */
function buildCandles(symbol, timeframe, limit) {
  const minutes = TIMEFRAME_MINUTES[timeframe] ?? 15;
  const random = seeded(symbolSeed(symbol) + minutes * 7);
  const step = minutes * 60;
  const now = Math.floor(Date.now() / 1000 / step) * step;
  const start = BASE_PRICE[symbol] ?? 100;
  const candles = [];
  let price = start * (0.94 + random() * 0.12);
  for (let index = limit - 1; index >= 0; index--) {
    const time = now - index * step;
    const open = price;
    const drift = (random() - 0.48) * 0.012;
    const close = open * (1 + drift);
    const high = Math.max(open, close) * (1 + random() * 0.003);
    const low = Math.min(open, close) * (1 - random() * 0.003);
    const volume = 500 + random() * 2500;
    candles.push({
      time, open: round(open), high: round(high), low: round(low), close: round(close), volume: Math.round(volume),
    });
    price = close;
  }
  return candles;
}

function round(value) {
  return Number(value.toFixed(value > 100 ? 2 : value > 1 ? 4 : 6));
}

function buildTicker(symbol) {
  const candles = buildCandles(symbol, "15m", 96);
  const last = candles[candles.length - 1];
  const first = candles[0];
  const change24hPct = ((last.close - first.close) / first.close) * 100;
  return {
    symbol,
    price: last.close,
    markPrice: last.close,
    change24hPct: round(change24hPct),
    change24hAvailable: true,
    volume24hUsd: Math.round(1_000_000 + Math.abs(change24hPct) * 90_000),
    fundingRate: 0.0001,
    openInterest: null,
    high24h: Math.max(...candles.map((candle) => candle.high)),
    low24h: Math.min(...candles.map((candle) => candle.low)),
    bid: round(last.close * 0.9999),
    ask: round(last.close * 1.0001),
    ts: Date.now(),
    source: "demo",
    stale: false,
  };
}

/* ------------------------------------------------------------------ */
/* Static files                                                        */
/* ------------------------------------------------------------------ */

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

async function serveStatic(pathname, response) {
  const clean = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  let filePath = join(ROOT, clean);
  if (!filePath.startsWith(ROOT)) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = join(filePath, "index.html");
  } catch {
    // A single-page app: unknown paths fall back to index.html.
    filePath = join(ROOT, "index.html");
  }
  try {
    const body = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": MIME[extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(body);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
  }
}

/* ------------------------------------------------------------------ */
/* The API                                                             */
/* ------------------------------------------------------------------ */

const SETTINGS = {
  onboarded: true,
  mode: "paper",
  liveArmed: false,
  layout: "default",
  dataSource: "demo",
  accent: "#3d7eff",
  density: "comfortable",
  reduceMotion: false,
  colorblindPalette: false,
  chartLabelMode: "compact",
  timezone: "UTC",
  watchlist: ["BTCUSD", "ETHUSD", "SOLUSD"],
  modules: {},
  strategiesEnabled: { emaRibbon: true, donchian: true },
  riskLimits: { maxDailyLoss: 500, maxOrderValue: 5000, maxLeverage: 3, maxOpenPositions: 5 },
  srAuto: true,
  srLookback: 60,
  srSensitivity: 1,
  srMinTouches: 2,
  alertSound: false,
  alertBrowser: false,
  startingBalance: 10000,
  seededDemo: true,
  displayCurrency: "usd",
  usdInrRate: 83.2,
  tradingviewEnabled: false,
  tradingviewSecret: "",
  theme: "dark",
};

const SYSTEM = {
  db: true,
  exchangeMarket: "online",
  exchangeAccount: "disconnected",
  strategy: true,
  execution: "paper",
  webhook: false,
  demoMode: true,
  latencyMs: 42,
  version: "mock-1.0.0",
  exchange: {
    configured: false,
    exchange: "coindcx",
    baseUrl: "https://api.coindcx.com",
    missing: ["COINDCX_API_KEY", "COINDCX_API_SECRET"],
    reachable: false,
    liveExecutionEnabled: false,
    clientOrderIds: true,
    orderReconciliation: true,
  },
  flags: { PAPER_TRADING: true, LIVE_TRADING: false, AI: false, ALERTS: true },
};

const JOURNAL = [
  { id: "j1", mode: "paper", symbol: "BTCUSD", direction: "long", entry: 60120, exit: 61480, qty: 0.05, fees: 1.2, pnl: 68, strategy: "donchian", reason: "Channel breakout with EMA confirmation", notes: "Held through the pullback.", emotion: "calm", tags: ["breakout"], openedAt: Date.now() - 86400000 * 3, closedAt: Date.now() - 86400000 * 2, source: "paper" },
  { id: "j2", mode: "paper", symbol: "ETHUSD", direction: "short", entry: 3490, exit: 3410, qty: 0.4, fees: 0.9, pnl: 32, strategy: "rsi-macd", reason: "RSI overbought into resistance", notes: "", emotion: "neutral", tags: ["fade"], openedAt: Date.now() - 86400000 * 5, closedAt: Date.now() - 86400000 * 4, source: "paper" },
  { id: "j3", mode: "paper", symbol: "SOLUSD", direction: "long", entry: 142.2, exit: 138.6, qty: 4, fees: 0.6, pnl: -14.4, strategy: "supertrend", reason: "Trend flip, stopped out", notes: "Stop was too tight.", emotion: "impatient", tags: ["stopped"], openedAt: Date.now() - 86400000 * 7, closedAt: Date.now() - 86400000 * 6, source: "paper" },
  { id: "j4", mode: "paper", symbol: "XRPUSD", direction: "long", entry: 0.604, exit: 0.632, qty: 5000, fees: 0.4, pnl: 140, strategy: "donchian", reason: "Breakout of the weekly range", notes: "", emotion: "confident", tags: ["breakout", "swing"], openedAt: Date.now() - 86400000 * 9, closedAt: Date.now() - 86400000 * 8, source: "paper" },
];

function buildAnalysis(symbol, timeframe, candles) {
  const closes = candles.map((candle) => candle.close);
  const last = closes[closes.length - 1] ?? 0;
  const fast = closes.slice(-21).reduce((a, b) => a + b, 0) / Math.min(21, closes.length);
  const slow = closes.slice(-55).reduce((a, b) => a + b, 0) / Math.min(55, closes.length);
  const highs = candles.map((candle) => candle.high);
  const lows = candles.map((candle) => candle.low);
  const levels = [
    { price: round(Math.max(...highs.slice(-30))), kind: "resistance", touches: 3, strength: 0.8, lastTouch: Date.now() },
    { price: round(Math.min(...lows.slice(-30))), kind: "support", touches: 2, strength: 0.6, lastTouch: Date.now() },
  ];
  const bullish = fast > slow;
  return {
    chartType: "candles",
    symbol,
    timeframe,
    trend: bullish ? "BULLISH" : "BEARISH",
    structureSeq: bullish ? ["HH", "HL"] : ["LH", "LL"],
    swings: [],
    levels,
    emaFast: round(fast),
    emaSlow: round(slow),
    lastClose: round(last),
    signals: [
      {
        id: `${symbol}-1`,
        symbol,
        timeframe,
        strategy: "Donchian Breakout",
        status: bullish ? "LONG_SETUP" : "SHORT_SETUP",
        price: round(last),
        entry: round(last * (bullish ? 1.002 : 0.998)),
        stop: round(last * (bullish ? 0.988 : 1.012)),
        target: round(last * (bullish ? 1.03 : 0.97)),
        rr: 2,
        reasons: ["EMA 21 above EMA 55", "Higher low held into the pullback"],
        ts: Date.now(),
      },
    ],
    evaluatedAt: Date.now(),
  };
}

function buildAccount() {
  const btc = buildTicker("BTCUSD");
  const eth = buildTicker("ETHUSD");
  return {
    account: {
      equity: 10284.6,
      availableMargin: 9214.6,
      marginUsed: 1070,
      openPnl: 84.6,
      todayPnl: 142.3,
      realizedTotal: 284.6,
      startingBalance: 10000,
      source: "demo",
      positions: [
        { symbol: "BTCUSD", side: "long", qty: 0.05, entry: 60120, upl: 56.5, mark: btc.price, source: "paper" },
        { symbol: "ETHUSD", side: "short", qty: 0.4, entry: 3490, upl: 28.1, mark: eth.price, source: "paper" },
      ],
      balanceCurrency: "USDT",
      balanceAsset: "USDT",
      fxRate: null,
    },
    mode: "paper",
    liveArmed: false,
    exchangeAccountConfigured: false,
    paperTradingEnabled: true,
  };
}

function send(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-TC-Workspace",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  });
  response.end(payload);
}

function handleApi(request, response, url) {
  const path = url.pathname;
  const method = request.method ?? "GET";
  const authorized = (request.headers.authorization ?? "").replace(/^Bearer\s+/i, "") === PASSWORD;

  if (path === "/api/health") return send(response, 200, { ok: true, version: SYSTEM.version });
  if (path === "/api/auth/login") {
    if (method !== "POST") return send(response, 405, { error: "Method not allowed" });
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      let password = "";
      try { password = JSON.parse(body || "{}").password ?? ""; } catch { password = ""; }
      if (password !== PASSWORD) return send(response, 401, { error: "Invalid credentials." });
      return send(response, 200, { ok: true, expiresInMs: 43_200_000 });
    });
    return undefined;
  }
  if (path === "/api/auth/logout") return send(response, 200, { ok: true });

  if (!authorized) return send(response, 401, { error: "Not signed in." });

  if (path === "/api/system") return send(response, 200, SYSTEM);
  if (path === "/api/settings") {
    if (method === "GET") return send(response, 200, { settings: SETTINGS, capabilities: { paperTrading: true, liveTrading: false, alerts: true } });
    if (method === "PATCH" || method === "POST") {
      let body = "";
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        try {
          const patch = JSON.parse(body || "{}");
          Object.assign(SETTINGS, patch);
          delete SETTINGS.confirm;
        } catch { /* ignore */ }
        return send(response, 200, { settings: SETTINGS });
      });
      return undefined;
    }
  }
  if (path === "/api/market/candles") {
    const symbol = (url.searchParams.get("symbol") || "BTCUSD").toUpperCase();
    const timeframe = url.searchParams.get("timeframe") || "15m";
    const limit = Math.min(Number(url.searchParams.get("limit") || 300), 500);
    return send(response, 200, { symbol, timeframe, candles: buildCandles(symbol, timeframe, limit), source: "demo" });
  }
  if (path === "/api/market/tickers") {
    const requested = (url.searchParams.get("symbols") || "").split(",").map((value) => value.trim().toUpperCase()).filter(Boolean);
    const symbols = requested.length ? requested : SYMBOLS;
    return send(response, 200, { tickers: symbols.map(buildTicker), source: "demo", known: SYMBOLS });
  }
  if (path === "/api/market/movers") {
    const tickers = SYMBOLS.map(buildTicker).sort((a, b) => Math.abs(b.change24hPct) - Math.abs(a.change24hPct));
    return send(response, 200, {
      movers: tickers.slice(0, 6).map((ticker) => ({
        symbol: ticker.symbol, price: ticker.price, changePct: ticker.change24hPct,
        direction: ticker.change24hPct >= 0 ? "up" : "down",
      })),
      source: "demo",
      asOf: Date.now(),
    });
  }
  if (path === "/api/market/orderbook") {
    const symbol = (url.searchParams.get("symbol") || "BTCUSD").toUpperCase();
    const ticker = buildTicker(symbol);
    return send(response, 200, {
      orderbook: {
        symbol,
        bids: Array.from({ length: 8 }, (_, index) => ({ price: round(ticker.bid * (1 - index * 0.0004)), size: 0.4 + index * 0.3 })),
        asks: Array.from({ length: 8 }, (_, index) => ({ price: round(ticker.ask * (1 + index * 0.0004)), size: 0.5 + index * 0.2 })),
        ts: Date.now(),
        source: "demo",
      },
      trades: [],
    });
  }
  if (path === "/api/strategy/evaluate") {
    const symbol = (url.searchParams.get("symbol") || "BTCUSD").toUpperCase();
    const timeframe = url.searchParams.get("timeframe") || "15m";
    const chartType = url.searchParams.get("chartType") || "candles";
    const analysis = buildAnalysis(symbol, timeframe, buildCandles(symbol, timeframe, 200));
    analysis.chartType = chartType === "heikin-ashi" ? "heikin-ashi" : "candles";
    return send(response, 200, {
      analysis,
      quant: {
        confluence: { score: 62, direction: "LONG", components: { trend: 70, zone: 55, momentum: 64, volume: 48 }, reasons: ["Trend and momentum agree", "Volume below average"], atr: 412.5 },
        htfSource: "1h",
        regime: "trend",
        metaProba: 0.58,
        metaGate: { passed: true, reason: "sufficient history" },
      },
      chartType: analysis.chartType,
      source: "demo",
      enabled: true,
    });
  }
  if (path === "/api/account") return send(response, 200, buildAccount());
  if (path === "/api/paper") {
    if (method === "GET") {
      return send(response, 200, {
        positions: [
          { id: "p1", symbol: "BTCUSD", side: "long", qty: 0.05, entry: 60120, stop: 59000, target: 62500, realizedPnl: 0, openedAt: Date.now() - 3600000, updatedAt: Date.now() },
        ],
        orders: [],
        events: [{ type: "fill", message: "BTCUSD long 0.05 filled at 60120", ts: Date.now() - 3600000 }],
        mode: "paper",
      });
    }
    if (method === "POST") {
      let body = "";
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        let parsed = {};
        try { parsed = JSON.parse(body || "{}"); } catch { parsed = {}; }
        return send(response, 200, { ok: true, accepted: parsed, positions: [], orders: [], events: [] });
      });
      return undefined;
    }
  }
  if (path === "/api/orders") {
    if (method === "GET") {
      return send(response, 200, {
        liveExecutionFlag: false, mode: "paper", liveArmed: false, exchangeConfigured: false,
        routedVia: "coindcx", capabilities: { liveTrading: false, paperTrading: true },
      });
    }
    return send(response, 403, { error: "Live trading is not armed. Enable LIVE mode and the master switch first." });
  }
  if (path === "/api/positions/close") return send(response, 403, { error: "Live trading is not armed." });
  if (path === "/api/journal") {
    if (method === "GET") return send(response, 200, { entries: JOURNAL, total: JOURNAL.length, legacyCount: 0 });
    return send(response, 200, { entry: JOURNAL[0] });
  }
  if (path === "/api/signals") return send(response, 200, { signals: [] });
  if (path === "/api/alerts") return send(response, 200, { rules: [] });
  if (path === "/api/audit") return send(response, 200, { events: [] });
  return send(response, 404, { error: `Unknown route ${path}` });
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, X-TC-Workspace",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    });
    response.end();
    return;
  }
  if (url.pathname.startsWith("/api/")) {
    try {
      handleApi(request, response, url);
    } catch (error) {
      send(response, 500, { error: error instanceof Error ? error.message : "Mock failure" });
    }
    return;
  }
  void serveStatic(url.pathname, response);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`mock server on http://0.0.0.0:${PORT}  (password: ${PASSWORD}, static root: ${ROOT})`);
});
