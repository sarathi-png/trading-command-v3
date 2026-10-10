/**
 * CoinDCX futures — private account reads.
 *
 *   GET  /exchange/v1/derivatives/futures/wallets               wallet balances
 *   GET  /exchange/v1/derivatives/futures/wallets/transactions  ledger (?page&size)
 *   POST /exchange/v1/derivatives/futures/trades                fills
 *   POST /exchange/v1/derivatives/futures/positions/transactions realised P&L per trade
 *
 * Method matters: docs.coindcx.com routes the two wallet reads as GET (with a
 * signed `{"timestamp": …}` body, exactly like the official samples) — a POST
 * reaches no route and CoinDCX answers 404. Pagination on the ledger travels
 * in the QUERY string (`?page=1&size=1000`), never in the body.
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
 * futures, INR for INR-margined). The documented row shape is
 * `{ currency_short_name, balance, locked_balance, cross_order_margin,
 * cross_user_margin }` with string numbers; the venue's own note says
 * "Total wallet balance = balance + locked_balance" (balance is the free
 * collateral — cross margin stays inside it and is tracked in the cross_*
 * fields). Other shapes CoinDCX uses for wallet payloads are accepted too;
 * anything else is reported rather than guessed at.
 */
export async function walletBalances(client: CoinDcxClient): Promise<ExchangeBalance[]> {
  // GET with a signed timestamp body — see the module header. The signer
  // stamps a fresh millisecond timestamp into the body.
  const raw = await client.read<unknown>("/exchange/v1/derivatives/futures/wallets", {}, "GET");

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
    // "Total wallet balance = balance + locked_balance" (docs.coindcx.com,
    // Wallet Transfer response definitions). An explicit total_balance, when
    // a payload carries one, wins over the derived sum.
    const free = num(row.balance ?? nested.balance);
    const locked = num(row.locked_balance ?? nested.locked_balance);
    const total = num(row.total_balance ?? nested.total_balance, free + locked);
    const available = num(row.available_balance ?? nested.available_balance ?? row.balance ?? nested.balance, total);
    balances.push({ asset, balance: total, available });
  }

  if (balances.length === 0) {
    const emptyList = Array.isArray(raw) && raw.length === 0;
    throw new ExchangeError(
      emptyList
        ? "CoinDCX returned an empty futures wallet list for this account. Refusing to report a zero balance — check that futures trading is enabled for this account and API key."
        : "CoinDCX returned a wallet payload this build does not recognise. Refusing to report a balance rather than guess one.",
      "EXCHANGE_API_ERROR",
      502,
      {
        exchange: "coindcx",
        path: "/exchange/v1/derivatives/futures/wallets",
        responseShape: Array.isArray(raw) ? (raw.length === 0 ? "empty array" : "array") : typeof raw,
      }
    );
  }
  return balances;
}

/**
 * Ledger entries (transfers, fees, funding) for the futures wallets.
 *
 * The documented rows carry `transaction_type` (credit/debit — DIRECTION
 * only) and `reason` (by_universal_wallet = spot↔futures transfer,
 * by_futures_funding = funding, by_futures_order = flows from a futures
 * order). Classification uses both, and the amount is signed by direction:
 * a bare "credit"/"debit" label must never be summed as if it were a deposit
 * or a withdrawal. Order-driven rows (fees, realised P&L) stay unclassified
 * here — the panel books those from the positions/transactions stream.
 */
export async function walletTransactions(
  client: CoinDcxClient,
  options: { page?: number; size?: number } = {}
): Promise<{ type: string; amount: number; asset: string; ts: number }[]> {
  // GET, with pagination in the QUERY string and only the timestamp signed
  // into the body — exactly the shape docs.coindcx.com documents.
  const rows = await client.read<
    {
      transaction_type?: string;
      type?: string;
      reason?: string;
      amount?: number | string;
      currency_short_name?: string;
      balance_currency_short_name?: string;
      created_at?: number | string;
    }[]
  >(
    "/exchange/v1/derivatives/futures/wallets/transactions",
    {},
    "GET",
    {
      page: options.page ?? 1,
      size: options.size ?? 100,
    }
  );

  return expectArray<(typeof rows)[number]>(rows, "/exchange/v1/derivatives/futures/wallets/transactions").map((row) => {
    const direction = String(row.transaction_type ?? "").toLowerCase();
    const reason = String(row.reason ?? "").toLowerCase();
    const isDebit = direction.startsWith("debit");
    const magnitude = Math.abs(num(row.amount));
    const type = reason.includes("universal_wallet")
      ? isDebit
        ? "withdraw"
        : "deposit"
      : reason.includes("funding")
        ? "funding"
        : // Unknown reason: keep whatever semantic label the row carries, and
          // let direction-only labels ("credit"/"debit") fall through as
          // unclassified rather than inventing a deposit.
          String(row.transaction_type ?? row.type ?? "unknown").toLowerCase();
    return {
      type,
      amount: isDebit ? -magnitude : magnitude,
      asset: String(row.currency_short_name ?? row.balance_currency_short_name ?? "USDT").toUpperCase(),
      ts: num(row.created_at, Date.now()),
    };
  });
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
