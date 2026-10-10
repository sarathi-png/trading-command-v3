#!/usr/bin/env node
/**
 * CSV-Based Validation Script
 * 
 * Use this if you have manually exported CSV files from CoinDCX.
 * Place CSV files in data/candles/ as:
 *   - BTCUSD_4h.csv
 *   - BTCUSD_1D.csv
 *   - ETHUSD_4h.csv
 *   - ETHUSD_1D.csv
 *   etc.
 * 
 * Run: node scripts/validate-from-csv.js
 */

const fs = require("fs");
const path = require("path");

// Load compiled modules
const { walkForwardPurged, paramGrid, DEFAULT_TREND } = require("../output/quant-js/lib/strategy/quant/validation");
const { DEFAULT_COSTS } = require("../output/quant-js/lib/strategy/quant/costs");

const DATA_DIR = path.join(__dirname, "..", "data", "candles");
const SYMBOLS = ["BTCUSD", "ETHUSD", "SOLUSD", "XRPUSD", "BNBUSD", "SOLUSD", "ADAUSD", "AVAXUSD", "LINKUSD", "MATICUSD"];
const LTF = "4h";
const HTF = "1D";
const LTF_SEC = 14400;
const HTF_SEC = 86400;

function parseCSV(csv) {
  const lines = csv.trim().split("\n");
  if (lines.length < 2) return [];
  return lines.slice(1).map(line => {
    const [time, open, high, low, close, volume] = line.split(",").map(Number);
    return { time, open, high, low, close, volume };
  }).filter(c => !isNaN(c.time) && !isNaN(c.close));
}

function loadSymbol(symbol) {
  const ltfPath = path.join(DATA_DIR, `${symbol}_${LTF}.csv`);
  const htfPath = path.join(DATA_DIR, `${symbol}_${HTF}.csv`);
  
  if (!fs.existsSync(ltfPath) || !fs.existsSync(htfPath)) {
    console.log(`⚠️  Missing CSV files for ${symbol}, skipping`);
    return null;
  }
  
  const ltf = parseCSV(fs.readFileSync(ltfPath, "utf8"));
  const htf = parseCSV(fs.readFileSync(htfPath, "utf8"));
  
  console.log(`Loaded ${symbol}: ${ltf.length} ${LTF} bars, ${htf.length} ${HTF} bars`);
  return { ltf, htf };
}

function runValidation(symbol, ltf, htf) {
  console.log(`\n=== Validating ${symbol} ===`);
  
  const cfg = {
    params: DEFAULT_TREND,
    costs: DEFAULT_COSTS,
    ltfSec: 14400,
    htfSec: 86400,
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

function main() {
  console.log("=== CSV-Based Validation ===");
  console.log(`Data dir: ${path.join(__dirname, "..", "data", "candles")}`);
  
  const quantOutput = path.join(__dirname, "..", "output", "quant-js");
  if (!fs.existsSync(quantOutput)) {
    console.error("❌ Compiled output not found. Run 'npm run build' first.");
    process.exit(1);
  }
  
  const allPassed = [];
  
  for (const symbol of SYMBOLS) {
    const data = loadSymbol(symbol);
    if (!data) continue;
    
    try {
      const { passed } = runValidation(symbol, data.ltf, data.htf);
      allPassed.push({ symbol, passed });
    } catch (error) {
      console.error(`❌ Error validating ${symbol}:`, error);
      allPassed.push({ symbol, passed: false });
    }
  }
  
  console.log("\n=== SUMMARY ===");
  allPassed.forEach(({ symbol, passed }) => {
    console.log(`${symbol}: ${passed ? "✅ PASSED" : "❌ FAILED"}`);
  });
  
  const overall = allPassed.every(p => p.passed);
  console.log(`\nOverall: ${overall ? "✅ ALL PASSED - Ready to deploy" : "❌ SOME FAILED - Do not deploy"}`);
  
  process.exit(overall ? 0 : 1);
}

main().catch(e => {
  console.error("Fatal error:", e);
  process.exit(1);
});