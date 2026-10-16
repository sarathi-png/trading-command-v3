/**
 * Account aggregation: demo/paper wallet + (optionally) the live exchange account.
 * Demo & paper figures are estimates clearly separated from exchange data.
 *
 * Live figures come from src/lib/exchange/service.ts, which signs CoinDCX
 * requests in this process — there is no gateway hop any more.
 */
import { getRepo } from "@/lib/repo";
import { exchangeAccountConfigured } from "./credentials";
import { liveBalances, livePositions } from "./exchange/service";
import { getTickers } from "./market/service";
import { getPaperState } from "./paper/engine";
import { getSettings } from "./settings";
import type { AccountState } from "./types";

const DEMO_LEVERAGE = 10;

export async function getAccountState(): Promise<AccountState> {
  const settings = await getSettings();
  if (settings.mode === "live") {
    if (!(await exchangeAccountConfigured())) throw new Error("Live account unavailable: configure CoinDCX credentials. No paper balances are shown.");
    const [balances, positions] = await Promise.all([liveBalances(), livePositions()]);
    const wallet = balances.find(b => ["USDT", "USD", "USDC"].includes(b.asset));
    if (!wallet) throw new Error("Live USD account balance unavailable. No simulated balance is substituted.");
    const openPnl = positions.reduce((sum, p) => sum + p.upl, 0);
    // Use only the live wallet's reported available balance; never paper margin.
    const repo = await getRepo();
    const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
    return {
      equity: wallet.balance + openPnl, availableMargin: wallet.available, marginUsed: Math.max(0, wallet.balance - wallet.available),
      openPnl, todayPnl: await repo.sumJournalPnl({ mode: "live", closedSince: dayStart }),
      realizedTotal: await repo.sumJournalPnl({ mode: "live" }), startingBalance: 0,
      source: "live", positions: positions.map(p => ({ ...p, source: "live" as const })),
    };
  }
  const symbolsInUse = new Set<string>();
  const paperPre = await getPaperState(new Map());
  for (const p of paperPre.positions) symbolsInUse.add(p.symbol);

  let tickers: Awaited<ReturnType<typeof getTickers>> = [];
  try {
    tickers = await getTickers([...symbolsInUse]);
  } catch {
    tickers = [];
  }
  const prices = new Map(tickers.map((t) => [t.symbol, t.price]));
  const paper = await getPaperState(prices);

  const openPnl = paper.positions.reduce((a, p) => a + p.upl, 0);
  const marginUsed = paper.positions.reduce((a, p) => a + p.notional / DEMO_LEVERAGE, 0);

  // Demo rows are synthetic, so they must not count towards real P&L.
  const repo = await getRepo();
  const realizedTotal = await repo.sumJournalPnl({ mode: "paper" });
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const todayPnl = await repo.sumJournalPnl({ mode: "paper", closedSince: dayStart });

  const equity = settings.startingBalance + realizedTotal + openPnl;

  const positions: AccountState["positions"] = paper.positions.map((p) => ({
    symbol: p.symbol,
    side: p.side as "long" | "short",
    qty: p.qty,
    entry: p.entry,
    upl: p.upl,
    mark: p.mark,
    source: "paper" as const,
  }));


  return {
    equity,
    availableMargin: Math.max(0, equity - marginUsed),
    marginUsed,
    openPnl,
    todayPnl,
    realizedTotal,
    startingBalance: settings.startingBalance,
    source: "demo",
    positions,
  };
}
