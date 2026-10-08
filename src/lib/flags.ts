/**
 * Feature flags, resolved from environment variables.
 * Sensitive capabilities default to OFF.
 */

function envBool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return v === "true" || v === "1";
}

/** First non-empty value among equivalent names (rename support). */
function envBoolAny(names: string[], fallback: boolean): boolean {
  for (const name of names) {
    const v = process.env[name];
    if (v !== undefined && v !== "") return v === "true" || v === "1";
  }
  return fallback;
}

export const flags = {
  /**
   * Public exchange market data via REST (no credentials required).
   * EXCHANGE_MARKET_ENABLED is the current name; DELTA_MARKET_ENABLED is still
   * honoured so an existing deployment's environment keeps working.
   */
  exchangeMarket: () => envBoolAny(["EXCHANGE_MARKET_ENABLED", "DELTA_MARKET_ENABLED"], true),
  // NOTE: there is deliberately no `accountEnabled` flag here. Configuration is
  // decided by whether COINDCX_API_KEY/COINDCX_API_SECRET are present — use
  // `exchangeAccountConfigured()` from "@/lib/credentials".
  paperTrading: () => envBool("PAPER_TRADING_ENABLED", true),
  liveExecution: () => envBool("LIVE_EXECUTION_ENABLED", false),
  orderbook: () => envBool("ORDERBOOK_ENABLED", true),
  strategyEngine: () => envBool("STRATEGY_ENGINE_ENABLED", true),
  autoSR: () => envBool("AUTO_S_R_ENABLED", true),
  journal: () => envBool("JOURNAL_ENABLED", true),
  analytics: () => envBool("ANALYTICS_ENABLED", true),
  tradingviewWebhook: () => envBool("TRADINGVIEW_WEBHOOK_ENABLED", false),
  telegram: () => envBool("TELEGRAM_ENABLED", false),
};

export const APP_VERSION = "1.1.0";

/** Public CoinDCX REST base for market data (no credentials). */
export const COINDCX_BASE_URL = process.env.COINDCX_BASE_URL || "https://api.coindcx.com";
/** Public data host used for candlesticks and order-book depth. */
export const COINDCX_PUBLIC_BASE_URL =
  process.env.COINDCX_PUBLIC_BASE_URL || "https://public.coindcx.com";

export const PAPER_FEE_RATE = 0.0005; // 0.05% taker per side
