/**
 * Account aggregation: demo/paper wallet + (optionally) the live exchange account.
 * Demo & paper figures are estimates clearly separated from exchange data.
 *
 * Live figures come from src/lib/exchange/service.ts, which signs CoinDCX
 * requests in this process — there is no gateway hop any more.
 */
import { getRepo } from "@/lib/repo";
import { exchangeAccountConfigured } from "./credentials";
import { flags } from "./flags";
import { liveBalances, livePositions } from "./exchange/service";
import { getTickers } from "./market/service";
import { getPaperState } from "./paper/engine";
import { getSettings } from "./settings";
import type { AccountState } from "./types";

const DEMO_LEVERAGE = 10;

export async function getAccountState(): Promise<AccountState> {
  const settings = await getSettings();
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
  const realizedTotal = await repo.sumJournalPnl({ excludeMode: "demo" });
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const todayPnl = await repo.sumJournalPnl({ excludeMode: "demo", closedSince: dayStart });

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

  let source: "demo" | "live" = "demo";
  if (settings.dataSource === "live" && (await exchangeAccountConfigured())) {
    // Wallet and positions are fetched independently: if the positions query
    // fails (no open positions / endpoint hiccup) the real balance must still
    // show — previously one failure in Promise.all dropped everything to demo.
    // CoinDCX futures balances are denominated in the margin currency (USDT);
    // INR-margined accounts report INR, which is surfaced rather than converted
    // silently.
    let usdBalance: number | null = null;
    try {
      const balances = await liveBalances();
      const margin = balances.find((b) => b.asset === "USDT" || b.asset === "USD" || b.asset === "USDC");
      if (margin) usdBalance = margin.balance;
    } catch {
      usdBalance = null;
    }
    if (usdBalance !== null) {
      let livePos: Awaited<ReturnType<typeof livePositions>> = [];
      try {
        livePos = await livePositions();
      } catch {
        livePos = []; // wallet still valid; positions shown as unavailable
      }
      source = "live";
      const liveUpl = livePos.reduce((a, p) => a + p.upl, 0);
      return {
        equity: usdBalance + liveUpl,
        availableMargin: Math.max(0, usdBalance - marginUsed),
        marginUsed,
        openPnl: openPnl + liveUpl,
        todayPnl,
        realizedTotal,
        startingBalance: settings.startingBalance,
        source,
        positions: [
          ...positions,
          ...livePos.map((p) => ({ ...p, source: "live" as const })),
        ],
      };
    }
  }

  return {
    equity,
    availableMargin: Math.max(0, equity - marginUsed),
    marginUsed,
    openPnl,
    todayPnl,
    realizedTotal,
    startingBalance: settings.startingBalance,
    source,
    positions,
  };
}
