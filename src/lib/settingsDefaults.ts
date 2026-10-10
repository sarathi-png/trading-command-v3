import type { AppSettings } from "./types";

/**
 * Client-side mirror of the server defaults (kept separate so the client
 * bundle never imports server modules that touch the database).
 */
export const DEFAULT_SETTINGS: AppSettings = {
  onboarded: false,
  mode: "read_only",
  liveArmed: false,
  layout: "trading",
  dataSource: "live",
  accent: "teal",
  density: "comfortable",
  reduceMotion: false,
  timezone: "IST",
  watchlist: ["BTCUSD", "ETHUSD", "SOLUSD"],
  modules: {
    balance: true, margin: true, pnl: true, positions: true, orderbook: false,
    funding: false, volume: true, tradeHistory: true, strategyScore: true,
    marketStructure: true, supportResistance: true, risk: true, alerts: true,
    systemStatus: true, apiStatus: false, latency: true, journal: true, analytics: true,
  },
  strategiesEnabled: { trend: true, breakout: true, sr: true },
  riskLimits: { maxDailyLoss: 200, maxOrderValue: 5000, maxLeverage: 10, maxOpenPositions: 4 },
  srAuto: true,
  srLookback: 160,
  srSensitivity: 0.0018,
  srMinTouches: 2,
  alertSound: true,
  alertBrowser: false,
  startingBalance: 10000,
  seededDemo: false,
  displayCurrency: "usd",
  usdInrRate: 88,
  tradingviewEnabled: false,
  tradingviewSecret: "",
  theme: "dark",
};
