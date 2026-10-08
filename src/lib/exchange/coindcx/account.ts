/**
 * CoinDCX futures — private account reads.
 *
 *   POST /exchange/v1/derivatives/futures/wallets               wallet balances
 *   GET  /exchange/v1/derivatives/futures/wallets/transactions  ledger
 *   POST /exchange/v1/derivatives/futures/trades                fills
 *   POST /exchange/v1/derivatives/futures/positions/transactions realised P&L per trade
 *
 * Parsing note (honest limitation): the official reference documents the
 * request bodies for these endpoints in full, but does not print the *wallet*
 * response body. It is therefore parsed defensively across the shapes CoinDCX
 * uses for wallet payloads, and an unrecognised shape raises a normalised
 * error instead of silently reporting a zero balance — a wrong balance must
 * never look like a funded account.
 */
import type { ExchangeBalance, ExchangeFill } from "../types";
import { toExchangeSymbol, toInternalSymbol } from "../symbols";
import { ExchangeError } from "../errors";
import { expectArray, num } from "./parse";
import type { CoinDcxClient } from "./client";

const MARGIN = ["USDT"] as const;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** YYYY-MM-DD in UTC — the format CoinDCX's trade endpoint expects. */
export function isoDate(ms: number): string {
  const date = new Date(ms);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

interface WalletRow {
  currency_short_name?: string;
  balance?: number | string;
  locked_balance?: number | string;
  available_balance?: number | string;
  total_balance?: number | string;
  wallet?: Record<string, unknown>;
}

/**
 * Wallet balances, normalised to `{ asset, balance, available }`.
 *
 * CoinDCX futures wallets are per margin currency (USDT for USDT-margined
 * futures, INR for INR-margined). The response has been seen both as a bare
 * array of currency rows and as a single object keyed by currency, so both are
 * accepted; anything else is reported rather than guessed at.
 */
export async function walletBalances(client: CoinDcxClient): Promise<ExchangeBalance[]> {
  // The signer stamps a fresh millisecond timestamp into the body.
  const raw = await client.read<unknown>("/exchange/v1/derivatives/futures/wallets");

  const rows: WalletRow[] = [];
  if (Array.isArray(raw)) {
    rows.push(...(raw as WalletRow[]));
  } else if (raw && typeof raw === "object") {
    const object = raw as Record<string, unknown>;
    // Shape A: single wallet object with a `balance` field.
    if ("balance" in object || "available_balance" in object) {
      rows.push(object as WalletRow);
    } else {
      // Shape B: keyed by currency short name, e.g. { USDT: {...}, INR: {...} }
      for (const [asset, value] of Object.entries(object)) {
        if (value && typeof value === "object") {
          rows.push({ currency_short_name: asset, ...(value as WalletRow) });
          continue;
        }
        // A bare number is a balance; a NUMERIC string is a balance. Anything
        // else (a flag, a nested label, a status field) is not, and must not be
        // coerced into a zero balance by `num()`.
        const numeric = typeof value === "number" ? value : Number(value);
        if (Number.isFinite(numeric) && String(value).trim() !== "") {
          rows.push({ currency_short_name: asset, balance: numeric });
        }
      }
    }
  }

  const balances: ExchangeBalance[] = [];
  for (const row of rows) {
    const nested = (row.wallet ?? {}) as Record<string, unknown>;
    const asset = String(row.currency_short_name ?? nested.currency_short_name ?? "").toUpperCase();
    if (!asset) continue;
    const balance = num(row.total_balance ?? row.balance ?? nested.balance);
    const available = num(row.available_balance ?? nested.available_balance ?? row.balance ?? balance, balance);
    balances.push({ asset, balance, available });
  }

  if (balances.length === 0) {
    throw new ExchangeError(
      "CoinDCX returned a wallet payload this build does not recognise. Refusing to report a balance rather than guess one.",
      "EXCHANGE_API_ERROR",
      502,
      { exchange: "coindcx", path: "/exchange/v1/derivatives/futures/wallets", responseShape: Array.isArray(raw) ? "array" : typeof raw }
    );
  }
  return balances;
}

/** Ledger entries (deposits, withdrawals, fees, funding, transfers). */
export async function walletTransactions(
  client: CoinDcxClient,
  options: { page?: number; size?: number } = {}
): Promise<{ type: string; amount: number; asset: string; ts: number }[]> {
  const rows = await client.read<
    { transaction_type?: string; type?: string; amount?: number | string; currency_short_name?: string; balance_currency_short_name?: string; created_at?: number | string }[]
  >("/exchange/v1/derivatives/futures/wallets/transactions", {
    page: options.page ?? 1,
    size: options.size ?? 100,
  }, "GET");

  return expectArray<(typeof rows)[number]>(rows, "/exchange/v1/derivatives/futures/wallets/transactions").map((row) => ({
    type: String(row.transaction_type ?? row.type ?? "unknown"),
    amount: num(row.amount),
    asset: String(row.currency_short_name ?? row.balance_currency_short_name ?? "USDT").toUpperCase(),
    ts: num(row.created_at, Date.now()),
  }));
}

/**
 * Executed fills for a pair over a date window.
 *
 * CoinDCX requires `pair`, `from_date`, `to_date` and pagination, so callers
 * must ask per instrument (the app's analytics already work per symbol).
 */
export async function fills(
  client: CoinDcxClient,
  input: { symbol: string; fromMs: number; toMs: number; page?: number; size?: number } = {
    symbol: "BTCUSD",
    fromMs: Date.now() - 7 * 86_400_000,
    toMs: Date.now(),
  }
): Promise<ExchangeFill[]> {
  const pair = toExchangeSymbol(input.symbol, "coindcx");
  const rows = await client.read<
    { price?: number | string; quantity?: number | string; is_maker?: boolean; fee_amount?: number | string; pair?: string; side?: string; timestamp?: number | string; order_id?: string }[]
  >("/exchange/v1/derivatives/futures/trades", {
    pair,
    from_date: isoDate(input.fromMs),
    to_date: isoDate(input.toMs),
    page: input.page ?? 1,
    size: input.size ?? 100,
    margin_currency_short_name: [...MARGIN],
  });

  return expectArray<(typeof rows)[number]>(rows, "/exchange/v1/derivatives/futures/trades").map((row) => {
    const exchangeSymbol = String(row.pair ?? pair).toUpperCase();
    return {
      id: row.order_id ? String(row.order_id) : null,
      symbol: toInternalSymbol(exchangeSymbol),
      exchangeSymbol,
      side: String(row.side ?? "buy").toLowerCase() === "sell" ? "sell" : "buy",
      price: num(row.price),
      quantity: Math.abs(num(row.quantity)),
      fee: Math.abs(num(row.fee_amount)),
      // CoinDCX reports realised P&L per order/position transaction, not per
      // fill; the analytics layer computes round-trip P&L from fills exactly
      // as it did for Delta.
      realizedPnl: null,
      isMaker: row.is_maker === undefined ? null : row.is_maker === true,
      ts: Math.round(num(row.timestamp, Date.now())),
    } satisfies ExchangeFill;
  });
}

/**
 * Per-position transaction stream. This is where CoinDCX books realised P&L:
 * `amount` is the P&L of the trade that created the transaction, and `stage`
 * separates normal trades (default), quick exits, TPSL exits and funding.
 */
export async function positionTransactions(
  client: CoinDcxClient,
  options: { stage?: "all" | "default" | "funding"; page?: number; size?: number } = {}
): Promise<{ stage: string; amount: number; feeAmount: number; pair: string; createdAt: number; source: string }[]> {
  const rows = await client.read<
    { pair?: string; stage?: string; amount?: number | string; fee_amount?: number | string; created_at?: number | string; source?: string }[]
  >("/exchange/v1/derivatives/futures/positions/transactions", {
    stage: options.stage ?? "all",
    page: options.page ?? 1,
    size: options.size ?? 200,
    margin_currency_short_name: [...MARGIN],
  });

  return expectArray<(typeof rows)[number]>(rows, "/exchange/v1/derivatives/futures/positions/transactions").map((row) => ({
    stage: String(row.stage ?? "default"),
    amount: num(row.amount),
    feeAmount: num(row.fee_amount),
    pair: String(row.pair ?? "").toUpperCase(),
    createdAt: num(row.created_at, Date.now()),
    source: String(row.source ?? "user"),
  }));
}
