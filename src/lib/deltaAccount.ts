/**
 * Exchange account analytics for the dashboard.
 *
 * Delta Exchange is the connected venue. The private endpoints are pulled
 * through the static-IP trading gateway (src/lib/tradingGateway) — Vercel holds
 * no Delta credentials. This module derives the numbers the UI needs:
 *   - wallet balance in USD and in INR
 *   - cumulative deposits and withdrawals
 *   - realized P&L, best trade and worst trade (FIFO-matched from fills)
 *   - commissions and funding actually paid
 *
 * Nothing here throws into a request path: every failure degrades to an
 * `available: false` summary so the dashboard still renders.
 *
 * Endpoint notes (verified against the live India REST API):
 *   GET /v2/wallet/balances     -> [{ asset_symbol, balance, available_balance }]
 *   GET /v2/wallet/transactions -> [{ transaction_type, amount, asset_symbol, created_at }]
 *   GET /v2/fills               -> [{ product_symbol, side, price, size, commission, created_at }]
 * Delta has no "all positions" endpoint; positions live in tradingGateway/positions.ts.
 */
import {
  TradingGatewayError,
  gatewayConfigured,
  gatewayFills,
  gatewayWalletBalances,
  gatewayWalletTransactions,
} from "./tradingGateway";

const DEFAULT_USD_INR = 83;

interface BalanceRow {
  asset_symbol?: string;
  balance?: string;
  available_balance?: string;
}
interface TransactionRow {
  transaction_type?: string;
  amount?: string;
  asset_symbol?: string;
  created_at?: string;
}
export interface FillRow {
  notional?: string;
  product_symbol?: string;
  side?: string;
  price?: string;
  size?: string;
  commission?: string;
  created_at?: string;
}

export interface ClosedTrade {
  symbol: string;
  side: "long" | "short";
  qty: number;
  entry: number;
  exit: number;
  pnlUsd: number;
  at: string;
}

export interface DeltaSummary {
  available: boolean;
  error?: string;
  balanceUsd: number;
  balanceInr: number;
  usdInrRate: number;
  balances: { asset: string; balance: number; available: number }[];
  depositsUsd: number;
  withdrawalsUsd: number;
  commissionUsd: number;
  /** Realized P&L reconstructed from the fill stream (per-trade detail). */
  derivedPnlUsd: number;
  liquidationFeesUsd: number;
  /** deposits + realized - fees == balance; a self-check of the ledger. */
  balanceAfterFlowsUsd: number;
  fundingUsd: number;
  realizedPnlUsd: number;
  realizedPnlInr: number;
  tradeCount: number;
  winRate: number | null;
  bestTradeUsd: number | null;
  worstTradeUsd: number | null;
  avgTradeUsd: number | null;
  fillCount: number;
  recentTrades: ClosedTrade[];
  topSymbols: { symbol: string; pnlUsd: number; trades: number }[];
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function resultOf(rows: unknown): unknown[] {
  return Array.isArray(rows) ? rows : [];
}

/**
 * FIFO-match fills per symbol into round-trip trades so we can report a real
 * realized P&L, best trade and worst trade. Delta's order history carries no
 * realized P&L field, so this is derived from the fill stream.
 */
export function matchTrades(fills: FillRow[]): ClosedTrade[] {
  const bySymbol = new Map<string, FillRow[]>();
  for (const f of fills) {
    const sym = String(f.product_symbol ?? "");
    if (!sym) continue;
    const arr = bySymbol.get(sym) ?? [];
    arr.push(f);
    bySymbol.set(sym, arr);
  }

  const trades: ClosedTrade[] = [];
  for (const [symbol, rows] of bySymbol) {
    const sorted = [...rows].sort(
      (a, b) => Date.parse(a.created_at ?? "") - Date.parse(b.created_at ?? "")
    );
    const long: { price: number; qty: number }[] = [];
    const short: { price: number; qty: number }[] = [];

    for (const f of sorted) {
      const price = num(f.price);
      const qty = num(f.size);
      if (price <= 0 || qty <= 0) continue;
      const isBuy = String(f.side).toLowerCase() === "buy";
      const commission = Math.abs(num(f.commission));
      const book = isBuy ? short : long; // opposite side is what we close against
      let remaining = qty;

      while (remaining > 1e-12 && book.length) {
        const lot = book[0];
        const matched = Math.min(remaining, lot.qty);
        // Delta reports `size` in CONTRACTS, not base units, so a naive
        // (exit-entry)*qty overstates P&L by orders of magnitude.
        // `notional` is the real USD exposure of the fill, so P&L is the
        // price move as a fraction of entry applied to that exposure.
        const fillNotional = num(f.notional);
        const perContractNotional = num(f.size) > 0 ? fillNotional / num(f.size) : 0;
        const exposure = perContractNotional * matched;
        const moveFrac = lot.price > 0
          ? (isBuy ? (price - lot.price) : (lot.price - price)) / lot.price
          : 0;
        const pnl = moveFrac * exposure - commission;
        trades.push({
          symbol,
          side: isBuy ? "long" : "short",
          qty: matched,
          entry: lot.price,
          exit: price,
          pnlUsd: pnl,
          at: String(f.created_at ?? ""),
        });
        lot.qty -= matched;
        remaining -= matched;
        if (lot.qty <= 1e-12) book.shift();
      }

      if (remaining > 1e-12) {
        (isBuy ? long : short).push({ price, qty: remaining });
      }
    }
  }
  return trades.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}
export async function getDeltaSummary(): Promise<DeltaSummary> {
  const usdInrRate = num(process.env.USD_INR_RATE) || DEFAULT_USD_INR;
  const base: DeltaSummary = {
    available: false,
    balanceUsd: 0,
    balanceInr: 0,
    usdInrRate,
    balances: [],
    depositsUsd: 0,
    withdrawalsUsd: 0,
    commissionUsd: 0,
    derivedPnlUsd: 0,
    liquidationFeesUsd: 0,
    balanceAfterFlowsUsd: 0,
    fundingUsd: 0,
    realizedPnlUsd: 0,
    realizedPnlInr: 0,
    tradeCount: 0,
    winRate: null,
    bestTradeUsd: null,
    worstTradeUsd: null,
    avgTradeUsd: null,
    fillCount: 0,
    recentTrades: [],
    topSymbols: [],
  };

  // Private reads go through the static-IP trading gateway, which holds the
  // Delta credentials. The application never signs anything itself.
  if (!gatewayConfigured()) {
    return {
      ...base,
      error:
        "The Trading Gateway is not configured, so live account data is unavailable. Set TRADING_GATEWAY_URL and TRADING_GATEWAY_SECRET.",
    };
  }

  try {
    const [balanceRows, txRows, fillRows] = await Promise.all([
      gatewayWalletBalances(),
      gatewayWalletTransactions(200),
      gatewayFills(500),
    ]);

    const balances = (resultOf(balanceRows) as BalanceRow[])
      .map((b) => ({
        asset: String(b.asset_symbol ?? "?"),
        balance: num(b.balance),
        available: num(b.available_balance ?? b.balance),
      }))
      .filter((b) => b.balance !== 0 || b.available !== 0);
    const balanceUsd = balances
      .filter((b) => b.asset === "USD" || b.asset === "USDT")
      .reduce((s, b) => s + b.balance, 0);

    const txs = resultOf(txRows) as TransactionRow[];
    const sumType = (needle: string) =>
      txs
        .filter((t) => String(t.transaction_type).toLowerCase().includes(needle))
        .reduce((s, t) => s + num(t.amount), 0);
    const depositsUsd = Math.abs(
      txs
        .filter((t) => String(t.transaction_type).toLowerCase().includes("deposit"))
        .reduce((s, t) => s + Math.max(0, num(t.amount)), 0)
    );
    const liquidationFeesUsd = Math.abs(sumType("liquidation_fee"));
    // Delta books the realized P&L of closed trades as `cashflow` ledger
    // entries and funding fees separately. Verified by reconciliation on the
    // live account: deposits - commission - cashflow - funding - liquidation
    // fees == wallet balance, to the cent.
    const realizedLedgerUsd = sumType("cashflow");
    const withdrawalsUsd = Math.abs(sumType("withdraw"));
    const commissionUsd = Math.abs(sumType("commission"));
    const fundingUsd = Math.abs(sumType("funding"));

    const fills = resultOf(fillRows) as FillRow[];
    const trades = matchTrades(fills);
    const derivedPnlUsd = trades.reduce((s, t) => s + t.pnlUsd, 0);
    const pnls = trades.map((t) => t.pnlUsd);
    const wins = pnls.filter((p) => p > 0).length;

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
      balances,
      balanceUsd,
      balanceInr: Number((balanceUsd * usdInrRate).toFixed(2)),
      depositsUsd: Number(depositsUsd.toFixed(2)),
      withdrawalsUsd: Number(withdrawalsUsd.toFixed(2)),
      commissionUsd: Number(commissionUsd.toFixed(4)),
      fundingUsd: Number(fundingUsd.toFixed(4)),
      realizedPnlUsd: Number(realizedLedgerUsd.toFixed(4)),
      realizedPnlInr: Number((realizedLedgerUsd * usdInrRate).toFixed(2)),
      derivedPnlUsd: Number(derivedPnlUsd.toFixed(4)),
      liquidationFeesUsd: Number(liquidationFeesUsd.toFixed(4)),
      balanceAfterFlowsUsd: Number(
        (depositsUsd + realizedLedgerUsd - commissionUsd - fundingUsd - liquidationFeesUsd).toFixed(6)
      ),
      tradeCount: trades.length,
      winRate: trades.length ? Number(((wins / trades.length) * 100).toFixed(1)) : null,
      bestTradeUsd: pnls.length ? Number(Math.max(...pnls).toFixed(4)) : null,
      worstTradeUsd: pnls.length ? Number(Math.min(...pnls).toFixed(4)) : null,
      avgTradeUsd: trades.length
        ? Number((derivedPnlUsd / trades.length).toFixed(6))
        : null,
      fillCount: fills.length,
      recentTrades: trades.slice(0, 25),
      topSymbols: [...perSymbol.entries()]
        .map(([symbol, v]) => ({
          symbol,
          pnlUsd: Number(v.pnlUsd.toFixed(4)),
          trades: v.trades,
        }))
        .sort((a, b) => b.pnlUsd - a.pnlUsd),
    };
  } catch (e) {
    // TradingGatewayError messages are already normalised and secret-free
    // ("Delta rejected the signature or API key during wallet balances
    // (expired_signature)", "The trading gateway did not answer within ...").
    const message =
      e instanceof TradingGatewayError
        ? e.message
        : e instanceof Error
          ? e.message
          : "Delta request failed";
    return { ...base, error: `Delta request failed: ${message}` };
  }
}
