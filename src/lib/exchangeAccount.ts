/**
 * Exchange account analytics for the dashboard.
 *
 * CoinDCX Futures is the connected venue. The private endpoints are called
 * directly from this process (src/lib/exchange) — there is no gateway hop any
 * more — and this module derives the numbers the UI needs:
 *   - futures wallet balance in USD and in INR
 *   - cumulative deposits and withdrawals
 *   - realized P&L (venue-booked where the venue reports it, FIFO-matched for
 *     the per-trade detail)
 *   - commissions and funding actually paid
 *
 * Nothing here throws into a request path: every failure degrades to an
 * `available: false` summary so the dashboard still renders.
 *
 * Endpoint notes (verified against docs.coindcx.com):
 *   POST /exchange/v1/derivatives/futures/wallets
 *   POST /exchange/v1/derivatives/futures/wallets/transactions
 *   POST /exchange/v1/derivatives/futures/trades            (per pair, dated)
 *   POST /exchange/v1/derivatives/futures/positions/transactions  (venue P&L)
 *
 * CoinDCX reports fills in BASE units (unlike Delta, whose `size` was in
 * contracts), so the FIFO matcher here is a straight quantity match: the
 * contract-notional correction the Delta version needed does not apply.
 */
import { getSettings } from "./settings";
import {
  liveBalances,
  liveFills,
  livePositionTransactions,
  liveWalletTransactions,
} from "./exchange/service";
import { ExchangeError } from "./exchange/service";

const DEFAULT_USD_INR = 88;
/** How far back the analytics window reaches by default. */
const DEFAULT_WINDOW_DAYS = 90;

export interface ClosedTrade {
  symbol: string;
  side: "long" | "short";
  qty: number;
  entry: number;
  exit: number;
  pnlUsd: number;
  at: string;
}

export interface ExchangeSummary {
  available: boolean;
  error?: string;
  exchange: string;
  balanceUsd: number;
  balanceInr: number;
  usdInrRate: number;
  balances: { asset: string; balance: number; available: number }[];
  depositsUsd: number;
  withdrawalsUsd: number;
  /** Wallet-transaction rows whose type this build does not classify. */
  unclassifiedTxCount: number;
  commissionUsd: number;
  /** Realized P&L reconstructed from the fill stream (per-trade detail). */
  derivedPnlUsd: number;
  liquidationFeesUsd: number;
  /** deposits + realized - fees == balance; a self-check of the ledger. */
  balanceAfterFlowsUsd: number;
  fundingUsd: number;
  /**
   * Realized P&L as booked by the venue (positions/transactions `amount`).
   * `null` when the venue could not be read — never coerced to zero, because a
   * zero here would understate a loss.
   */
  realizedPnlUsd: number | null;
  realizedPnlInr: number | null;
  tradeCount: number;
  winRate: number | null;
  bestTradeUsd: number | null;
  worstTradeUsd: number | null;
  avgTradeUsd: number | null;
  fillCount: number;
  windowDays: number;
  recentTrades: ClosedTrade[];
  topSymbols: { symbol: string; pnlUsd: number; trades: number }[];
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * FIFO-match fills per symbol into round-trip trades so we can report a real
 * realized P&L, best trade and worst trade per closed position.
 */
export function matchTrades(
  fills: { symbol: string; side: "buy" | "sell"; price: number; quantity: number; fee: number; ts: number }[]
): ClosedTrade[] {
  const bySymbol = new Map<string, typeof fills>();
  for (const f of fills) {
    const sym = f.symbol;
    if (!sym) continue;
    const arr = bySymbol.get(sym) ?? [];
    arr.push(f);
    bySymbol.set(sym, arr);
  }

  const trades: ClosedTrade[] = [];
  for (const [symbol, rows] of bySymbol) {
    const sorted = [...rows].sort((a, b) => a.ts - b.ts);
    // `feePerUnit` is the fee PER UNIT OF QUANTITY of the opening fill, carried
    // onto the round trip so a trade's P&L is net of BOTH fills — the previous
    // model only charged the closing commission and flattered every result.
    const long: { price: number; qty: number; feePerUnit: number }[] = [];
    const short: { price: number; qty: number; feePerUnit: number }[] = [];

    for (const f of sorted) {
      const price = f.price;
      const qty = Math.abs(f.quantity);
      if (price <= 0 || qty <= 0) continue;
      const isBuy = f.side === "buy";
      const book = isBuy ? short : long; // opposite side is what we close against
      let remaining = qty;

      while (remaining > 1e-12 && book.length) {
        const lot = book[0]!;
        const matched = Math.min(remaining, lot.qty);
        // P&L per unit depends on the side of the fill that OPENED the lot,
        // i.e. the side opposite to this closing fill:
        //   closing a LONG (this fill is a sell): exit - entry  = price - lot.price
        //   closing a SHORT (this fill is a buy): entry - exit  = lot.price - price
        // The previous (Delta-era) expression had these two backwards, so every
        // winning long was booked as a loss. The trade's side is likewise the
        // OPPOSITE of the closing fill.
        const pnlPerUnit = isBuy ? lot.price - price : price - lot.price;
        // Fees are stored per unit of quantity, so they pro-rate with the
        // matched size across partial fills.
        const closingFee = (Math.abs(f.fee) / qty) * matched;
        const pnl = pnlPerUnit * matched - closingFee - lot.feePerUnit * matched;
        trades.push({
          symbol,
          side: isBuy ? "short" : "long",
          qty: matched,
          entry: lot.price,
          exit: price,
          pnlUsd: pnl,
          at: new Date(f.ts).toISOString(),
        });
        lot.qty -= matched;
        remaining -= matched;
        if (lot.qty <= 1e-12) book.shift();
      }

      if (remaining > 1e-12) {
        (isBuy ? long : short).push({ price, qty: remaining, feePerUnit: Math.abs(f.fee) / qty });
      }
    }
  }
  return trades.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

export async function getExchangeSummary(options: { windowDays?: number } = {}): Promise<ExchangeSummary> {
  const settings = await getSettings();
  const usdInrRate = num(settings.usdInrRate) || num(process.env.USD_INR_RATE) || DEFAULT_USD_INR;
  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;
  const base: ExchangeSummary = {
    available: false,
    exchange: "coindcx",
    balanceUsd: 0,
    balanceInr: 0,
    usdInrRate,
    balances: [],
    depositsUsd: 0,
    withdrawalsUsd: 0,
    unclassifiedTxCount: 0,
    commissionUsd: 0,
    derivedPnlUsd: 0,
    liquidationFeesUsd: 0,
    balanceAfterFlowsUsd: 0,
    fundingUsd: 0,
    realizedPnlUsd: null,
    realizedPnlInr: null,
    tradeCount: 0,
    winRate: null,
    bestTradeUsd: null,
    worstTradeUsd: null,
    avgTradeUsd: null,
    fillCount: 0,
    windowDays,
    recentTrades: [],
    topSymbols: [],
  };

  try {
    const toMs = Date.now();
    const fromMs = toMs - windowDays * 86_400_000;
    // The trades endpoint is per pair, so the window covers the symbols the
    // deployment actually watches.
    const symbols = [...new Set(settings.watchlist)].filter(Boolean);
    if (symbols.length === 0) symbols.push("BTCUSD");

    const [balances, fills, txs, posTxs] = await Promise.all([
      liveBalances(),
      liveFills({ symbols, fromMs, toMs, pageSize: 100 }),
      // The wallet ledger is optional: an unrecognised response must not blank
      // the whole panel, so failure degrades to "no ledger rows".
      liveWalletTransactions({ page: 1, size: 200 }).catch(() => []),
      // Venue-booked realized P&L per position transaction. Failure → null,
      // which the summary reports as "unavailable" rather than zero.
      livePositionTransactions({ stage: "all", page: 1, size: 200 }).catch(() => null),
    ]);

    const normalisedBalances = balances
      .map((b) => ({ asset: b.asset, balance: b.balance, available: b.available }))
      .filter((b) => b.balance !== 0 || b.available !== 0);
    const balanceUsd = normalisedBalances
      .filter((b) => b.asset === "USDT" || b.asset === "USD" || b.asset === "USDC")
      .reduce((s, b) => s + b.balance, 0);

    const sumType = (needle: string) =>
      txs
        .filter((t) => String(t.type).toLowerCase().includes(needle))
        .reduce((s, t) => s + t.amount, 0);
    const depositsUsd = Math.abs(
      txs
        .filter((t) => String(t.type).toLowerCase().includes("deposit"))
        .reduce((s, t) => s + Math.max(0, t.amount), 0)
    );
    const withdrawalsUsd = Math.abs(sumType("withdraw"));
    const commissionUsd = Math.abs(sumType("commission") || sumType("fee"));
    const fundingUsd = Math.abs(sumType("funding"));
    const liquidationFeesUsd = Math.abs(sumType("liquidation"));
    const unclassifiedTxCount = txs.filter((t) => {
      const kind = String(t.type).toLowerCase();
      return !/deposit|withdraw|commission|fee|funding|liquidation|transfer/.test(kind);
    }).length;

    const trades = matchTrades(
      fills.map((f) => ({ symbol: f.symbol, side: f.side, price: f.price, quantity: f.quantity, fee: f.fee, ts: f.ts }))
    );
    const derivedPnlUsd = trades.reduce((s, t) => s + t.pnlUsd, 0);
    const pnls = trades.map((t) => t.pnlUsd);
    const wins = pnls.filter((p) => p > 0).length;

    // Venue-booked realized P&L: sum the `amount` of every closing transaction.
    // Truncated pages are not summed (an incomplete total is worse than none).
    let realizedPnlUsd: number | null = null;
    if (Array.isArray(posTxs) && posTxs.length < 200) {
      realizedPnlUsd = posTxs
        .filter((t) => t.stage !== "funding")
        .reduce((s, t) => s + t.amount, 0);
    }

    const perSymbol = new Map<string, { pnlUsd: number; trades: number }>();
    for (const t of trades) {
      const cur = perSymbol.get(t.symbol) ?? { pnlUsd: 0, trades: 0 };
      cur.pnlUsd += t.pnlUsd;
      cur.trades += 1;
      perSymbol.set(t.symbol, cur);
    }

    return {
      ...base,
      available: true,
      balances: normalisedBalances,
      balanceUsd,
      balanceInr: Number((balanceUsd * usdInrRate).toFixed(2)),
      depositsUsd: Number(depositsUsd.toFixed(2)),
      withdrawalsUsd: Number(withdrawalsUsd.toFixed(2)),
      unclassifiedTxCount,
      commissionUsd: Number(commissionUsd.toFixed(4)),
      fundingUsd: Number(fundingUsd.toFixed(4)),
      realizedPnlUsd: realizedPnlUsd === null ? null : Number(realizedPnlUsd.toFixed(4)),
      realizedPnlInr: realizedPnlUsd === null ? null : Number((realizedPnlUsd * usdInrRate).toFixed(2)),
      derivedPnlUsd: Number(derivedPnlUsd.toFixed(4)),
      liquidationFeesUsd: Number(liquidationFeesUsd.toFixed(4)),
      balanceAfterFlowsUsd: Number(
        (depositsUsd + derivedPnlUsd - commissionUsd - fundingUsd - liquidationFeesUsd).toFixed(6)
      ),
      tradeCount: trades.length,
      winRate: trades.length ? Number(((wins / trades.length) * 100).toFixed(1)) : null,
      bestTradeUsd: pnls.length ? Number(Math.max(...pnls).toFixed(4)) : null,
      worstTradeUsd: pnls.length ? Number(Math.min(...pnls).toFixed(4)) : null,
      avgTradeUsd: trades.length ? Number((derivedPnlUsd / trades.length).toFixed(6)) : null,
      fillCount: fills.length,
      recentTrades: trades.slice(0, 25),
      topSymbols: [...perSymbol.entries()]
        .map(([symbol, v]) => ({ symbol, pnlUsd: Number(v.pnlUsd.toFixed(4)), trades: v.trades }))
        .sort((a, b) => b.pnlUsd - a.pnlUsd),
    };
  } catch (e) {
    // ExchangeError messages are already normalised and secret-free.
    const message =
      e instanceof ExchangeError ? e.message : e instanceof Error ? e.message : "CoinDCX request failed";
    return { ...base, error: message };
  }
}
