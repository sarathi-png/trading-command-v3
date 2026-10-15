"use client";
import { useDisplayCurrency } from "@/lib/useDisplayCurrency";
import { useMemo } from "react";
import { BarChart3 } from "lucide-react";
import { EmptyState, MetricCard, PageHeader, Panel, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { cx, fmtDuration, fmtUsd } from "@/lib/format";
import { usePoll } from "@/lib/hooks";
import type { JournalEntry } from "@/lib/types";

interface Row extends Omit<JournalEntry, "openedAt" | "closedAt"> {
  openedAt: string;
  closedAt: string | null;
}

function cumulativePnl(entries: Row[]): number[] {
  let balance = 0;
  return entries.map((entry) => {
    balance += entry.pnl;
    return balance;
  });
}

export default function AnalyticsPage() {
  useDisplayCurrency();
  const { data, loading } = usePoll(() => api.get<{ entries: Row[] }>("/api/journal?mode=paper"), 60000);

  const closed = useMemo(
    () => (data?.entries ?? []).filter((e) => e.exit !== null && e.closedAt).sort(
      (a, b) => new Date(a.closedAt as string).getTime() - new Date(b.closedAt as string).getTime()
    ),
    [data]
  );
  const wins = closed.filter((e) => e.pnl > 0);
  const losses = closed.filter((e) => e.pnl <= 0);
  const grossWin = wins.reduce((a, e) => a + e.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((a, e) => a + e.pnl, 0));
  const net = grossWin - grossLoss;
  const avgDuration = closed.length
    ? closed.reduce((a, e) => a + (new Date(e.closedAt as string).getTime() - new Date(e.openedAt).getTime()), 0) / closed.length
    : 0;

  const equity = useMemo(() => cumulativePnl(closed), [closed]);

  const daily = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of closed) {
      const day = (e.closedAt as string).slice(0, 10);
      map.set(day, (map.get(day) ?? 0) + e.pnl);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-21);
  }, [closed]);

  const byStrategy = useMemo(() => {
    const map = new Map<string, { n: number; wins: number; pnl: number }>();
    for (const e of closed) {
      const k = e.strategy || "untagged";
      const cur = map.get(k) ?? { n: 0, wins: 0, pnl: 0 };
      cur.n += 1;
      if (e.pnl > 0) cur.wins += 1;
      cur.pnl += e.pnl;
      map.set(k, cur);
    }
    return [...map.entries()].sort((a, b) => b[1].pnl - a[1].pnl);
  }, [closed]);

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

  if (closed.length === 0) {
    return (
      <div className="p-4 lg:p-6 space-y-4 page-shell">
        <PageHeader crumb="INSIGHTS / ANALYTICS" title="Performance analytics"
          description="Outcome distribution across your recorded trades. Descriptive statistics only, not a forecast." />

        <Panel title="ANALYTICS">
          <EmptyState
            icon={<BarChart3 size={20} />}
            title="No closed trades to analyse yet"
            hint="Close paper positions or add journal entries — analytics are computed from your real records, never fabricated."
          />
        </Panel>
      </div>
    );
  }

  return (
    <div className="p-3 space-y-3 page-shell">
      <div className="auto-cells">
        <MetricCard label="TOTAL TRADES" value={String(closed.length)} sub={`${wins.length}W / ${losses.length}L`} />
        <MetricCard label="WIN RATE" value={`${((wins.length / closed.length) * 100).toFixed(1)}%`}
          tone={wins.length >= losses.length ? "up" : "dn"} />
        <MetricCard label="TOTAL P&L" value={fmtUsd(net, { sign: true })} tone={net >= 0 ? "up" : "dn"} />
        <MetricCard label="PROFIT FACTOR" value={grossLoss > 0 ? (grossWin / grossLoss).toFixed(2) : "∞"} />
        <MetricCard label="AVG DURATION" value={fmtDuration(avgDuration)} />
        <MetricCard label="AVG WIN" value={fmtUsd(wins.length ? grossWin / wins.length : 0)} tone="up" />
        <MetricCard label="AVG LOSS" value={fmtUsd(losses.length ? -grossLoss / losses.length : 0)} tone="dn" />
        <MetricCard label="LARGEST WIN" value={fmtUsd(Math.max(0, ...closed.map((e) => e.pnl)))} tone="up" />
        <MetricCard label="LARGEST LOSS" value={fmtUsd(Math.min(0, ...closed.map((e) => e.pnl)))} tone="dn" />
        <MetricCard label="EXPECTANCY / TRADE" value={fmtUsd(net / closed.length, { sign: true })}
          tone={net >= 0 ? "up" : "dn"} />
      </div>

      <div className="auto-panels">
        <Panel title="EQUITY CURVE (CUMULATIVE P&L)">
          <div className="p-3">
            <SvgLine data={equity} />
          </div>
        </Panel>
        <Panel title="DAILY P&L (LAST 21 SESSIONS)">
          <div className="p-3">
            <SvgBars data={daily.map(([, v]) => v)} labels={daily.map(([d]) => d.slice(5))} />
          </div>
        </Panel>
      </div>

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
              {byStrategy.map(([name, s]) => (
                <tr key={name} className="border-b border-edge/50">
                  <td className="px-3 py-2 text-mut">{name}</td>
                  <td className="px-2 py-2 num text-right">{s.n}</td>
                  <td className="px-2 py-2 num text-right">{((s.wins / s.n) * 100).toFixed(0)}%</td>
                  <td className={cx("px-2 py-2 num text-right", s.pnl >= 0 ? "text-up" : "text-dn")}>{fmtUsd(s.pnl, { sign: true })}</td>
                  <td className="px-2 py-2">
                    <div className="flex h-2 w-40 rounded overflow-hidden bg-bg2">
                      <span className="bg-up/70" style={{ width: `${(s.wins / s.n) * 100}%` }} />
                      <span className="bg-dn/60 flex-1" />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
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
