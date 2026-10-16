/**
 * Picks the live futures wallet that the account figures are read from.
 *
 * CoinDCX futures wallets are per margin currency. A USDT-margined account has
 * a USDT wallet; an INR-margined account (the common case for Indian users)
 * has only an INR wallet. USD-like wallets are preferred. When none exists the
 * INR wallet is used, and its amounts are reported as INR so the caller can
 * convert them with the configured manual rate. No simulated balance is ever
 * substituted.
 */
import type { ExchangeBalance } from "./types";

export const USD_WALLET_ASSETS = ["USDT", "USD", "USDC"] as const;
export const INR_WALLET_ASSET = "INR";

export interface LiveWallet {
  /** Currency the amounts are denominated in. */
  currency: "USD" | "INR";
  /** Wallet asset as CoinDCX names it (e.g. USDT or INR). */
  asset: string;
  balance: number;
  available: number;
}

export function selectLiveWallet(balances: ExchangeBalance[]): LiveWallet | null {
  const assets = balances.map((b) => ({ ...b, asset: b.asset.toUpperCase() }));
  for (const asset of USD_WALLET_ASSETS) {
    const usd = assets.find((b) => b.asset === asset);
    if (usd) return { currency: "USD", asset, balance: usd.balance, available: usd.available };
  }
  const inr = assets.find((b) => b.asset === INR_WALLET_ASSET);
  if (inr) return { currency: "INR", asset: INR_WALLET_ASSET, balance: inr.balance, available: inr.available };
  return null;
}

/** Convert a wallet amount to USD using the configured manual rate (₹ per USD). */
export function toUsd(amount: number, wallet: LiveWallet, usdInrRate: number): number {
  if (wallet.currency === "USD") return amount;
  if (!Number.isFinite(usdInrRate) || usdInrRate <= 0) {
    throw new Error("INR wallet found but the USD/INR rate is not set. Set a positive rate in Settings.");
  }
  return amount / usdInrRate;
}
