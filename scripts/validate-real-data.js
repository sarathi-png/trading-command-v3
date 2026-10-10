#!/usr/bin/env node
/**
 * Standalone Real Data Validation Script
 * 
 * Run AFTER: npm run build
 * Then: node scripts/validate-real-data.js
 * 
 * This script uses the compiled JS from the build output.
 */

const fs = require("fs");
const path = require("path");

// Load environment
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const DATA_DIR = path.join(__dirname, "..", "data", "candles");
const SYMBOLS = ["BTCUSD", "ETHUSD", "SOLUSD"];
const LTF = "4h";
const HTF = "1D";
const LTF_SEC = 14400;
const HTF_SEC = 86400;
const LOOKBACK_DAYS = 1095;

// Import compiled modules
const { CoinDcxClient } = require("../output/quant-js/lib/exchange/coindcx/client");
const { knownSymbols, toExchangeSymbol } = require("../output/quant-js/lib/exchange/symbols");
const { walkForwardPurged, paramGrid, DEFAULT_TREND } = require("../output/quant-js/lib/strategy/quant/validation");
const { DEFAULT_COSTS } = require("../output/quant-js/lib/strategy/quant/costs");
const { TF_MINUTES } = require("../output/quant-js/lib/types");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const client = new CoinDcxClient({
  baseUrl: process.env.COINDCX_BASE_URL || "https://api.coindcx.com",
  publicBaseUrl: process.env.COINDCX_PUBLIC_BASE_URL || "https://public.coindcx.com",
  credentials: {
    apiKey: process.env.COINDCX_API_KEY!,
    apiSecret: process.env.COINDCX_API_SECRET!,
  },
  exchange: "coindcx",
});

async function fetchCandles(symbol, timeframe, limit) {
  const pair = toExchangeSymbol(symbol);
  const resolution = timeframe === "4h" ? "4h" : "1d";
  const now = Math.floor(Date.now() / 1000);
  const from = now - (timeframe === "4h" ? 14400 : 86400) * limit;
  
  console.log(`Fetching ${symbol} ${timeframe} (${pair}) from ${new Date(from * 1000).toISOString()}...`);
  
  const candles = await client.get("/exchange/v1/derivatives/futures/candles", {
    params: { pair, resolution, from, to: now },
  });
  
  if (!Array.isArray(candles)) {
    throw new Error(`Unexpected response for ${symbol} ${timeframe}: ${JSON.stringify(candles)}`);
  }
  
  return candles.map(c => ({
    time: c.time,
    open: parseFloat(c.open),
    high: parseFloat(c.high),
    low: parseFloat(c.low),
    close: parseFloat(c.close),
    volume: parseFloat(c.volume),
  })).sort((a, b) => a.time - b.time);
}

function candlesToCSV(candles) {
  const header = "time,open,high,low,close,volume";
  const rows = candles.map(c => `${c.time},${c.open},${c.high},${c.low},${c.close},${c.volume}`);
  return [header, ...rows].join("\n");
}

async function exportSymbol(symbol) {
  console.log(`\n=== Exporting ${symbol} ===`);
  
  const ltfLimit = Math.ceil(LOOKBACK_DAYS * 24 / 4) + 100;
  const htfLimit = LOOKBACK_DAYS + 100;
  
  const [ltf, htf] = await Promise.all([
    fetchCandles(symbol, LTF, ltfLimit),
    fetchCandles(symbol, HTF, htfLimit),
  ]);
  
  const ltfPath = path.join(DATA_DIR, `${symbol}_${LTF}.csv`);
  const htfPath = path.join(DATA_DIR, `${symbol}_${HTF}.csv`);
  
  fs.writeFileSync(ltfPath, candlesToCSV(ltf));
  fs.writeFileSync(htfPath, candlesToCSV(htf));
  
  console.log(`Saved ${ltf.length} ${LTF} candles to ${ltfPath}`);
  console.log(`Saved ${htf.length} ${HTF} candles to ${htfPath}`);
  
  return { ltf, htf };
}

function runValidation(symbol, ltf, htf) {
  console.log(`\n=== Validating ${symbol} ===`);
  
  const cfg = {
    params: DEFAULT_TREND,
    costs: DEFAULT_COSTS,
    ltfSec: LTF_SEC,
    htfSec: HTF_SEC,
  };
  
  const grid = paramGrid(DEFAULT_TREND);
  console.log(`Testing ${grid.length} parameter combinations...`);
  
  const result = walkForwardPurged(ltf, htf, cfg, grid, {
    folds: 4,
    controlSeeds: 100,
    minTrainTrades: 30,
  });
  
  console.log(`\n--- ${symbol} Validation Results ---`);
  console.log(`OOS Trades: ${result.oos.length}`);
  console.log(`OOS Expectancy: ${result.oosReport.expectancyR.toFixed(4)} R`);
  console.log(`Profit Factor: ${result.oosReport.profitFactor.toFixed(3)}`);
  console.log(`Max Drawdown: ${result.oosReport.maxDrawdownPct.toFixed(2)}%`);
  console.log(`Total Return: ${result.oosReport.totalReturnPct.toFixed(2)}%`);
  console.log(`Long Expectancy: ${result.oosReport.longExpectancyR?.toFixed(4) ?? "N/A"} R`);
  console.log(`Short Expectancy: ${result.oosReport.shortExpectancyR?.toFixed(4) ?? "N/A"} R`);
  console.log(`DSR: ${result.oosReport.dsr?.toFixed(4) ?? "N/A"}`);
  console.log(`Control p-value: ${result.controlPValue.toFixed(4)}`);
  console.log(`Fold Expectancies: ${result.foldExpectancies.map(e => e.toFixed(4)).join(", ")}`);
  
  // Profit probability
  const longs = result.oos.filter(t => t.side === 1);
  const shorts = result.oos.filter(t => t.side === -1);
  const probLong = longs.length >= 30 ? longs.filter(t => t.netR > 0).length / longs.length : 0.5;
  const probShort = shorts.length >= 30 ? shorts.filter(t => t.netR > 0).length / shorts.length : 0.5;
  console.log(`Profit Probability - Long: ${(probLong * 100).toFixed(1)}% (${longs.length} trades)`);
  console.log(`Profit Probability - Short: ${(probShort * 100).toFixed(1)}% (${shorts.length} trades)`);
  
  const passed = 
    result.oosReport.expectancyR > 0 &&
    (result.oosReport.dsr ?? 0) > 0.5 &&
    result.controlPValue < 0.05;
  
  console.log(`\n>>> ${passed ? "✅ PASSED" : "❌ FAILED"} validation thresholds`);
  console.log(`   Expectancy > 0: ${result.oosReport.expectancyR > 0 ? "✓" : "✗"}`);
  console.log(`   DSR > 0.5: ${(result.oosReport.dsr ?? 0) > 0.5 ? "✓" : "✗"}`);
  console.log(`   p-value < 0.05: ${result.controlPValue < 0.05 ? "✓" : "✗"}`);
  
  return { passed, result };
}

async function main() {
  console.log("=== CoinDCX Real Data Validation ===");
  console.log(`Symbols: ${SYMBOLS.join(", ")}`);
  console.log(`Timeframes: ${LTF} (LTF), ${HTF} (HTF)`);
  console.log(`Lookback: ${LOOKBACK_DAYS} days`);
  console.log(`Data dir: ${DATA_DIR}`);
  
  if (!process.env.COINDCX_API_KEY || !process.env.COINDCX_API_SECRET) {
    console.error("❌ COINDCX_API_KEY and COINDCX_API_SECRET must be set in .env");
    process.exit(1);
  }
  
  // Check if compiled output exists
  const quantOutput = path.join(__dirname, "..", "output", "quant-js");
  if (!fs.existsSync(quantOutput)) {
    console.error("❌ Compiled output not found. Run 'npm run build' first.");
    process.exit(1);
  }
  
  const allPassed = [];
  
  for (const symbol of SYMBOLS) {
    try {
      const { ltf, htf } = await exportSymbol(symbol);
      const { passed } = runValidation(symbol, ltf, htf);
      allPassed.push(passed);
    } catch (error) {
      console.error(`❌ Error processing ${symbol}:`, error);
      allPassed.push(false);
    }
  }
  
  console.log("\n=== SUMMARY ===");
  SYMBOLS.forEach((symbol, i) => {
    console.log(`${symbol}: ${allPassed[i] ? "✅ PASSED" : "❌ FAILED"}`);
  });
  
  const overall = allPassed.every(p => p);
  console.log(`\nOverall: ${overall ? "✅ ALL PASSED - Ready to deploy" : "❌ SOME FAILED - Do not deploy"}`);
  
  process.exit(overall ? 0 : 1);
}

main().catch(e => {
  console.error("Fatal error:", e);
  process.exit(1);
});