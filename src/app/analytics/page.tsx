"use client";
import { useDisplayCurrency } from "@/lib/useDisplayCurrency";
import { useMemo, useState } from "react";
import { BarChart3 } from "lucide-react";
import { Btn, EmptyState, Input, MetricCard, PageHeader, Panel, Select, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { cx, fmtDateTime, fmtDuration, fmtUsd } from "@/lib/format";
import { usePoll } from "@/lib/hooks";
import type { AnalyticsMetrics } from "@/lib/analytics/metrics";

interface Row {
  id: string;
  mode: "demo" | "paper" | "live";
  symbol: string;
  direction: "long" | "short";
  strategy: string;
  entry: number;
  exit: number | null;
  pnl: number;
  openedAt: string;
  closedAt: string | null;
}

interface AnalyticsResponse {
  mode: "demo" | "paper" | "live";
  metrics: AnalyticsMetrics;
  entries: Row[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  notice: string;
}

const PAGE_SIZE = 25;

export default function AnalyticsPage() {
  useDisplayCurrency();
  const [symbol, setSymbol] = useState("");
  const [direction, setDirection] = useState<"" | "long" | "short">("");
  const [strategy, setStrategy] = useState("");
  const [page, setPage] = useState(1);

  const query = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (symbol.trim()) params.set("symbol", symbol.trim());
    if (direction) params.set("direction", direction);
    if (strategy.trim()) params.set("strategy", strategy.trim());
    return params.toString();
  }, [symbol, direction, strategy, page]);

  const { data, loading } = usePoll(
    () => api.get<AnalyticsResponse>(`/api/analytics?${query}`),
    60_000,
    { deps: [query] }
  );
  const metrics = data?.metrics;
  const filtered = Boolean(symbol.trim() || direction || strategy.trim());

  const reset = () => {
    setSymbol("");
    setDirection("");
    setStrategy("");
    setPage(1);
  };

  if (loading && !data) {
    return (
      <div className="p-4 lg:p-6 space-y-4 page-shell">
        <PageHeader crumb="INSIGHTS / ANALYTICS" title="Performance analytics"
          description="Outcome distribution across your recorded trades. Descriptive statistics only, not a forecast." />

        <div className="auto-cells">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="p-3 space-y-3 page-shell">
      <PageHeader crumb="INSIGHTS / ANALYTICS" title="Performance analytics"
        description="Descriptive statistics computed on the server from closed records in the current workspace." />

      <Panel title="FILTERS">
        <div className="p-3 space-y-2">
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="text-[10px] text-dim space-y-1">
              <span className="microlabel block">SYMBOL</span>
              <Input value={symbol} onChange={(e) => { setSymbol(e.target.value); setPage(1); }} placeholder="All symbols (e.g. BTCUSD)" />
            </label>
            <label className="text-[10px] text-dim space-y-1">
              <span className="microlabel block">DIRECTION</span>
              <Select value={direction} onChange={(e) => { setDirection(e.target.value as "" | "long" | "short"); setPage(1); }} className="w-full">
                <option value="">All directions</option>
                <option value="long">Long</option>
                <option value="short">Short</option>
              </Select>
            </label>
            <label className="text-[10px] text-dim space-y-1">
              <span className="microlabel block">STRATEGY</span>
              <Input value={strategy} onChange={(e) => { setStrategy(e.target.value); setPage(1); }} placeholder="All strategies" />
            </label>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10px] text-dim">
              {data?.notice ?? "Workspace mode is applied before aggregation."}
              {filtered ? " Filters are applied before metrics are computed." : ""}
            </p>
            <Btn variant="ghost" onClick={reset} disabled={!filtered}>RESET FILTERS</Btn>
          </div>
        </div>
      </Panel>

      {!metrics || metrics.totalTrades === 0 ? (
        <Panel title="ANALYTICS">
          <EmptyState
            icon={<BarChart3 size={20} />}
            title="No closed trades to analyse yet"
            hint={filtered
              ? "No closed records match these filters. Widen or reset them — analytics are never fabricated."
              : "Close paper positions or add journal entries — analytics are computed from your real records, never fabricated."}
          />
        </Panel>
      ) : (
        <>
          <div className="auto-cells">
            <MetricCard label="TOTAL TRADES" value={String(metrics.totalTrades)} sub={`${metrics.wins}W / ${metrics.losses}L`} />
            <MetricCard label="WIN RATE" value={`${metrics.winRate.toFixed(1)}%`}
              tone={metrics.winRate >= 50 ? "up" : "dn"} />
            <MetricCard label="TOTAL P&L" value={fmtUsd(metrics.net, { sign: true })} tone={metrics.net >= 0 ? "up" : "dn"} />
            <MetricCard label="PROFIT FACTOR" value={metrics.profitFactor === null ? "∞" : metrics.profitFactor.toFixed(2)} />
            <MetricCard label="AVG DURATION" value={fmtDuration(metrics.avgDurationMs)} />
            <MetricCard label="AVG WIN" value={fmtUsd(metrics.avgWin)} tone="up" />
            <MetricCard label="AVG LOSS" value={fmtUsd(metrics.avgLoss)} tone="dn" />
            <MetricCard label="LARGEST WIN" value={fmtUsd(Math.max(0, metrics.largestWin))} tone="up" />
            <MetricCard label="LARGEST LOSS" value={fmtUsd(Math.min(0, metrics.largestLoss))} tone="dn" />
            <MetricCard label="EXPECTANCY / TRADE" value={fmtUsd(metrics.expectancy, { sign: true })}
              tone={metrics.expectancy >= 0 ? "up" : "dn"} />
          </div>

          <div className="auto-panels">
            <Panel title="EQUITY CURVE (CUMULATIVE P&L)">
              <div className="p-3">
                <SvgLine data={metrics.equity} />
              </div>
            </Panel>
            <Panel title="DAILY P&L (LAST 21 SESSIONS)">
              <div className="p-3">
                <SvgBars data={metrics.daily.map((d) => d.pnl)} labels={metrics.daily.map((d) => d.day.slice(5))} />
              </div>
            </Panel>
          </div>

          <Panel title={`CLOSED TRADES (PAGE ${data?.page ?? 1} / ${data?.pageCount ?? 1})`}>
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-left microlabel border-b border-edge">
                    <th className="px-3 py-1.5 font-medium">CLOSED</th>
                    <th className="px-2 py-1.5 font-medium">SYMBOL</th>
                    <th className="px-2 py-1.5 font-medium">SIDE</th>
                    <th className="px-2 py-1.5 font-medium">STRATEGY</th>
                    <th className="px-2 py-1.5 font-medium text-right">P&L</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.entries ?? []).map((entry) => (
                    <tr key={entry.id} className="border-b border-edge/50">
                      <td className="px-3 py-2 text-mut">{entry.closedAt ? fmtDateTime(Date.parse(entry.closedAt)) : "—"}</td>
                      <td className="px-2 py-2">{entry.symbol}</td>
                      <td className="px-2 py-2 uppercase text-dim">{entry.direction}</td>
                      <td className="px-2 py-2 text-mut">{entry.strategy || "untagged"}</td>
                      <td className={cx("px-2 py-2 num text-right", entry.pnl >= 0 ? "text-up" : "text-dn")}>
                        {fmtUsd(entry.pnl, { sign: true })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-edge px-3 py-2">
              <p className="text-[10px] text-dim">
                {data ? `${(data.page - 1) * data.pageSize + 1}–${Math.min(data.page * data.pageSize, data.total)} of ${data.total}` : ""}
              </p>
              <div className="flex gap-1">
                <Btn variant="ghost" disabled={(data?.page ?? 1) <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>PREV</Btn>
                <Btn variant="ghost" disabled={(data?.page ?? 1) >= (data?.pageCount ?? 1)} onClick={() => setPage((p) => p + 1)}>NEXT</Btn>
              </div>
            </div>
          </Panel>

          <Panel title="STRATEGY PERFORMANCE">
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="text-left microlabel border-b border-edge">
                    <th className="px-3 py-1.5 font-medium">STRATEGY</th>
                    <th className="px-2 py-1.5 font-medium text-right">TRADES</th>
                    <th className="px-2 py-1.5 font-medium text-right">WIN RATE</th>
                    <th className="px-2 py-1.5 font-medium text-right">NET P&L</th>
                    <th className="px-2 py-1.5 font-medium">DISTRIBUTION</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.byStrategy.map((s) => {
                    const rate = s.trades ? (s.wins / s.trades) * 100 : 0;
                    return (
                      <tr key={s.strategy} className="border-b border-edge/50">
                        <td className="px-3 py-2 text-mut">{s.strategy}</td>
                        <td className="px-2 py-2 num text-right">{s.trades}</td>
                        <td className="px-2 py-2 num text-right">{rate.toFixed(0)}%</td>
                        <td className={cx("px-2 py-2 num text-right", s.pnl >= 0 ? "text-up" : "text-dn")}>{fmtUsd(s.pnl, { sign: true })}</td>
                        <td className="px-2 py-2">
                          <div className="flex h-2 w-40 rounded overflow-hidden bg-bg2">
                            <span className="bg-up/70" style={{ width: `${rate}%` }} />
                            <span className="bg-dn/60 flex-1" />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}

function SvgLine({ data }: { data: number[] }) {
  useDisplayCurrency();
  const w = 560; const h = 180;
  if (data.length < 2) return <p className="text-[11px] text-dim py-8 text-center">Need at least two closed trades.</p>;
  const min = Math.min(0, ...data);
  const max = Math.max(0, ...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / span) * (h - 16) - 8}`);
  const zeroY = h - ((0 - min) / span) * (h - 16) - 8;
  const last = data[data.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label="Equity curve">
      <line x1="0" y1={zeroY} x2={w} y2={zeroY} stroke="rgba(148,163,184,0.2)" strokeDasharray="3 4" strokeWidth="1" />
      <polyline points={pts.join(" ")} fill="none" stroke={last >= 0 ? "var(--up)" : "var(--dn)"} strokeWidth="1.6" strokeLinejoin="round" />
      <text x={w - 4} y={12} textAnchor="end" fill="var(--mut)" fontSize="10" fontFamily="JetBrains Mono, monospace">
        {fmtUsd(last, { sign: true, decimals: 0 })}
      </text>
    </svg>
  );
}

function SvgBars({ data, labels }: { data: number[]; labels: string[] }) {
  const w = 560; const h = 180;
  if (data.length === 0) return <p className="text-[11px] text-dim py-8 text-center">No sessions recorded.</p>;
  const max = Math.max(...data.map(Math.abs), 1);
  const bw = Math.min(24, (w - 20) / data.length - 4);
  const zeroY = h / 2;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label="Daily P&L bars">
      <line x1="0" y1={zeroY} x2={w} y2={zeroY} stroke="rgba(148,163,184,0.2)" strokeWidth="1" />
      {data.map((v, i) => {
        const bh = (Math.abs(v) / max) * (h / 2 - 18);
        const x = 10 + i * ((w - 20) / data.length);
        return (
          <g key={i}>
            <rect x={x} y={v >= 0 ? zeroY - bh : zeroY} width={bw} height={Math.max(bh, 1)}
              fill={v >= 0 ? "rgba(47,211,136,0.75)" : "rgba(240,82,79,0.75)"} rx="1.5" />
            {i % Math.ceil(data.length / 7) === 0 && (
              <text x={x + bw / 2} y={h - 4} textAnchor="middle" fill="var(--dim)" fontSize="8" fontFamily="JetBrains Mono, monospace">
                {labels[i]}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
