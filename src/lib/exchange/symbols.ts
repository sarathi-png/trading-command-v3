/**
 * Symbol adapter.
 *
 * Two vocabularies, one canonical form:
 *
 *   1. The application's canonical symbol — what the watchlist, the database,
 *      the strategy engine and the UI already use: "BTCUSD", "ETHUSD", …
 *      It is preserved exactly so no stored data or screen had to change.
 *   2. The venue's instrument identifier — CoinDCX futures pairs look like
 *      "B-BTC_USDT" (base B-, quote _USDT). Always taken from the venue's own
 *      instrument list at runtime when available; the static map below is only
 *      the deterministic default and the basis for tests.
 *
 * Nothing outside this module may hard-code a venue pair into UI or business
 * logic; components speak canonical symbols only.
 */
import type { ExchangeInstrument, InternalSymbol } from "./types";
import { ExchangeError } from "./errors";

/** Canonical symbol → CoinDCX futures pair (USDT-margined perpetuals). */
const COINDCX_PAIRS: Record<string, string> = {
  BTCUSD: "B-BTC_USDT",
  ETHUSD: "B-ETH_USDT",
  SOLUSD: "B-SOL_USDT",
  XRPUSD: "B-XRP_USDT",
  BNBUSD: "B-BNB_USDT",
  DOGEUSD: "B-DOGE_USDT",
  ADAUSD: "B-ADA_USDT",
  AVAXUSD: "B-AVAX_USDT",
  LINKUSD: "B-LINK_USDT",
  MATICUSD: "B-MATIC_USDT",
  LTCUSD: "B-LTC_USDT",
  DOTUSD: "B-DOT_USDT",
  TRXUSD: "B-TRX_USDT",
  SUIUSD: "B-SUI_USDT",
  APTUSD: "B-APT_USDT",
  ARBUSD: "B-ARB_USDT",
  OPUSD: "B-OP_USDT",
  INJUSD: "B-INJ_USDT",
  TIAUSD: "B-TIA_USDT",
  NEARUSD: "B-NEAR_USDT",
};

/** Reverse index, built once. */
const INTERNAL_BY_PAIR: Record<string, string> = Object.fromEntries(
  Object.entries(COINDCX_PAIRS).map(([internal, pair]) => [pair.toUpperCase(), internal])
);

/** "BTCUSD" → "BTC"; tolerant of "BTC-USDT", "BTCUSDT", "B-BTC_USDT". */
export function baseAssetOf(symbol: string): string {
  const trimmed = symbol.trim().toUpperCase();
  if (!trimmed) return "";
  if (trimmed.startsWith("B-")) return trimmed.slice(2).split("_")[0] ?? "";
  const match = /^([A-Z0-9]{2,10}?)(?:[-_/]?)(USD|USDT|INR|USDC)?$/.exec(trimmed.replace(/[-_/]/g, ""));
  return match?.[1] ?? trimmed;
}

/** Canonical app symbol → venue pair. Throws for unsupported instruments. */
export function toExchangeSymbol(symbol: InternalSymbol, exchange = "coindcx"): string {
  const canonical = symbol.trim().toUpperCase();
  if (exchange !== "coindcx") {
    throw new ExchangeError(`Unsupported exchange "${exchange}".`, "EXCHANGE_NOT_SUPPORTED", 501, { exchange });
  }
  const pair = COINDCX_PAIRS[canonical];
  if (!pair) {
    throw new ExchangeError(
      `${canonical} is not a supported CoinDCX futures instrument on this deployment.`,
      "EXCHANGE_NOT_SUPPORTED",
      422,
      { exchange, symbol: canonical }
    );
  }
  return pair;
}

/** Venue pair → canonical app symbol. Unknown pairs are passed through as-is. */
export function toInternalSymbol(exchangeSymbol: string): string {
  const trimmed = exchangeSymbol.trim().toUpperCase();
  const known = INTERNAL_BY_PAIR[trimmed];
  if (known) return known;
  if (trimmed.startsWith("B-")) return `${trimmed.slice(2).split("_")[0]}USD`;
  return trimmed;
}

/** True when the app can route this symbol to the venue. */
export function isSupportedSymbol(symbol: InternalSymbol, exchange = "coindcx"): boolean {
  try {
    toExchangeSymbol(symbol, exchange);
    return true;
  } catch {
    return false;
  }
}

/** All canonical symbols this build knows how to route. */
export function knownSymbols(): string[] {
  return Object.keys(COINDCX_PAIRS);
}

/**
 * Normalised instrument descriptor for a canonical symbol, without a network
 * call. `tickSize`/`minQuantity`/`maxLeverage` stay undefined here and are
 * filled from the venue's instrument endpoint when precision matters (order
 * price/quantity rounding happens in the adapter, not in the UI).
 */
export function instrumentFor(symbol: InternalSymbol, exchange = "coindcx"): ExchangeInstrument {
  const canonical = symbol.trim().toUpperCase();
  const exchangeSymbol = toExchangeSymbol(canonical, exchange);
  return {
    symbol: canonical,
    exchangeSymbol,
    baseAsset: baseAssetOf(exchangeSymbol),
    quoteAsset: "USDT",
    contractType: "perpetual",
    settleAsset: "USDT",
  };
}
