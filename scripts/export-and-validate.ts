#!/usr/bin/env node
/**
 * CoinDCX Historical Data Export & Validation Script
 * 
 * Usage:
 *   npx ts-node scripts/export-and-validate.ts
 * 
 * Requirements:
 * - COINDCX_API_KEY and COINDCX_API_SECRET in .env
 * - Run from project root: D:\Projects\trading-command-v3
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { CoinDcxClient } from "@/lib/exchange/coindcx/client";
import { knownSymbols, toExchangeSymbol } from "@/lib/exchange/symbols";
import { TF_MINUTES } from "@/lib/types";
import { walkForwardPurged, paramGrid, DEFAULT_TREND } from "@/lib/strategy/quant/validation";
import { DEFAULT_COSTS } from "@/lib/strategy/quant/costs";

// Load environment
require("dotenv").config({ path: join(process.cwd(), ".env") });

const DATA_DIR = join(process.cwd(), "data", "candles");
const SYMBOLS = ["BTCUSD", "ETHUSD", "SOLUSD"]; // Add more as needed
const LTF = "4h";
const HTF = "1D";
const LTF_SEC = TF_MINUTES[LTF] * 60;
const HTF_SEC = TF_MINUTES[HTF] * 60;
const LOOKBACK_DAYS = 1095; // 3 years

mkdirSync(DATA_DIR, { recursive: true });

const client = new CoinDcxClient({
  baseUrl: process.env.COINDCX_BASE_URL || "https://api.coindcx.com",
  publicBaseUrl: process.env.COINDCX_PUBLIC_BASE_URL || "https://public.coindcx.com",
  credentials: {
    apiKey: process.env.COINDCX_API_KEY!,
    apiSecret: process.env.COINDCX_API_SECRET!,
  },
  exchange: "coindcx",
});

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

async function fetchCandles(symbol: string, timeframe: string, limit: number): Promise<Candle[]> {
  const pair = toExchangeSymbol(symbol);
  const resolution = timeframe === "4h" ? "4h" : "1d";
  const now = Math.floor(Date.now() / 1000);
  const from = now - (timeframe === "4h" ? 14400 : 86400) * limit;
  
  console.log(`Fetching ${symbol} ${timeframe} (${pair}) from ${new Date(from * 1000).toISOString()}...`);
  
  const candles = await client.get(`/exchange/v1/derivatives/futures/candles`, {
    params: {
      pair,
      resolution,
      from,
      to: now,
    },
  });
  
  if (!Array.isArray(candles)) {
    throw new Error(`Unexpected response for ${symbol} ${timeframe}: ${JSON.stringify(candles)}`);
  }
  
  return candles.map((c: any) => ({
    time: c.time,
    open: parseFloat(c.open),
    high: parseFloat(c.high),
    low: parseFloat(c.low),
    close: parseFloat(c.close),
    volume: parseFloat(c.volume),
  })).sort((a: Candle, b: Candle) => a.time - b.time);
}

function candlesToCSV(candles: Candle[]): string {
  const header = "time,open,high,low,close,volume";
  const rows = candles.map(c => `${c.time},${c.open},${c.high},${c.low},${c.close},${c.volume}`);
  return [header, ...rows].join("\n");
}

function parseCSV(csv: string): Candle[] {
  const lines = csv.trim().split("\n");
  if (lines.length < 2) return [];
  return lines.slice(1).map(line => {
    const [time, open, high, low, close, volume] = line.split(",").map(Number);
    return { time, open, high, low, close, volume };
  });
}

async function exportSymbol(symbol: string) {
  console.log(`\n=== Exporting ${symbol} ===`);
  
  // Calculate limits: 3 years of 4h = ~6570 bars, 1D = ~1095 bars
  const ltfLimit = Math.ceil(LOOKBACK_DAYS * 24 / 4) + 100; // ~6670
  const htfLimit = LOOKBACK_DAYS + 100; // ~1195
  
  const [ltf, htf] = await Promise.all([
    fetchCandles(symbol, LTF, ltfLimit),
    fetchCandles(symbol, HTF, htfLimit),
  ]);
  
  // Save CSVs
  const ltfPath = join(DATA_DIR, `${symbol}_${LTF}.csv`);
  const htfPath = join(DATA_DIR, `${symbol}_${HTF}.csv`);
  
  writeFileSync(ltfPath, candlesToCSV(ltf));
  writeFileSync(htfPath, candlesToCSV(htf));
  
  console.log(`Saved ${ltf.length} ${LTF} candles to ${ltfPath}`);
  console.log(`Saved ${htf.length} ${HTF} candles to ${htfPath}`);
  
  return { ltf, htf };
}

async function runValidation(symbol: string, ltf: Candle[], htf: Candle[]) {
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
  
  // Decision
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
  console.log("=== CoinDCX Data Export & Validation ===");
  console.log(`Symbols: ${SYMBOLS.join(", ")}`);
  console.log(`Timeframes: ${LTF} (LTF), ${HTF} (HTF)`);
  console.log(`Lookback: ${LOOKBACK_DAYS} days`);
  console.log(`Data dir: ${DATA_DIR}`);
  
  if (!process.env.COINDCX_API_KEY || !process.env.COINDCX_API_SECRET) {
    console.error("❌ COINDCX_API_KEY and COINDCX_API_SECRET must be set in .env");
    process.exit(1);
  }
  
  const allPassed = [];
  
  for (const symbol of SYMBOLS) {
    try {
      // Export data
      const { ltf, htf } = await exportSymbol(symbol);
      
      // Run validation
      const { passed } = await runValidation(symbol, ltf, htf);
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

main().catch(console.error);