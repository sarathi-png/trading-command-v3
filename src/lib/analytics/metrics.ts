/**
 * Descriptive analytics over closed journal rows.
 *
 * Pure and deterministic: the API filters by workspace/mode and this module
 * computes the numbers. Nothing here forecasts or annualises a small sample.
 */
export interface AnalyticsTrade {
  symbol: string;
  direction: "long" | "short";
  strategy: string;
  pnl: number;
  openedAt: number | string;
  closedAt: number | string | null;
  exit: number | null;
}

export interface StrategyBreakdown {
  strategy: string;
  trades: number;
  wins: number;
  pnl: number;
}

export interface AnalyticsMetrics {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  grossWin: number;
  grossLoss: number;
  net: number;
  profitFactor: number | null;
  avgWin: number;
  avgLoss: number;
  expectancy: number;
  avgDurationMs: number;
  largestWin: number;
  largestLoss: number;
  equity: number[];
  daily: { day: string; pnl: number }[];
  byStrategy: StrategyBreakdown[];
}

function millis(value: number | string | null): number | null {
  if (value === null) return null;
  const ms = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** Closed rows only; callers still pass the filtered workspace set. */
export function computeAnalytics(rows: readonly AnalyticsTrade[]): AnalyticsMetrics {
  const closed = rows
    .filter((row) => row.exit !== null && row.closedAt !== null && Number.isFinite(row.pnl))
    .sort((a, b) => (millis(a.closedAt) ?? 0) - (millis(b.closedAt) ?? 0));

  const wins = closed.filter((row) => row.pnl > 0);
  const losses = closed.filter((row) => row.pnl <= 0);
  const grossWin = wins.reduce((sum, row) => sum + row.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((sum, row) => sum + row.pnl, 0));
  const net = grossWin - grossLoss;

  let running = 0;
  const equity = closed.map((row) => {
    running += row.pnl;
    return running;
  });

  const dailyMap = new Map<string, number>();
  for (const row of closed) {
    const ms = millis(row.closedAt);
    if (ms === null) continue;
    const day = new Date(ms).toISOString().slice(0, 10);
    dailyMap.set(day, (dailyMap.get(day) ?? 0) + row.pnl);
  }

  const strategyMap = new Map<string, StrategyBreakdown>();
  for (const row of closed) {
    const strategy = row.strategy || "untagged";
    const entry = strategyMap.get(strategy) ?? { strategy, trades: 0, wins: 0, pnl: 0 };
    entry.trades += 1;
    if (row.pnl > 0) entry.wins += 1;
    entry.pnl += row.pnl;
    strategyMap.set(strategy, entry);
  }

  const durations = closed
    .map((row) => {
      const opened = millis(row.openedAt);
      const closedAt = millis(row.closedAt);
      return opened !== null && closedAt !== null ? Math.max(0, closedAt - opened) : null;
    })
    .filter((value): value is number => value !== null);

  return {
    totalTrades: closed.length,
    wins: wins.length,
    losses: losses.length,
    winRate: closed.length ? (wins.length / closed.length) * 100 : 0,
    grossWin,
    grossLoss,
    net,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
    avgWin: wins.length ? grossWin / wins.length : 0,
    avgLoss: losses.length ? -grossLoss / losses.length : 0,
    expectancy: closed.length ? net / closed.length : 0,
    avgDurationMs: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
    largestWin: closed.length ? Math.max(...closed.map((row) => row.pnl)) : 0,
    largestLoss: closed.length ? Math.min(...closed.map((row) => row.pnl)) : 0,
    equity,
    daily: [...dailyMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-21)
      .map(([day, pnl]) => ({ day, pnl })),
    byStrategy: [...strategyMap.values()].sort((a, b) => b.pnl - a.pnl),
  };
}
