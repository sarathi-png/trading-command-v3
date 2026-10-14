"use client";
import { useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import DecisionReadiness from "@/components/DecisionReadiness";
import { Activity, ArrowUpRight } from "lucide-react";
import ChartPanel from "@/components/chart/ChartPanel";
import ExchangeAccountPanel from "@/components/ExchangeAccountPanel";
import { PositionsTable, RiskCard, SignalPanel } from "@/components/panels";
import { Chip, EmptyState, MetricCard, PremiumPanel, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtDateTime, fmtPct, fmtUsd, pnlTone } from "@/lib/format";
import { usePoll } from "@/lib/hooks";
import { useApp } from "@/stores";
import { chartHeightFor, useViewport } from "@/lib/useResponsive";
import type { AccountState, Analysis } from "@/lib/types";

interface AccountRes {
  account: AccountState;
  mode: string;
  exchangeAccountConfigured: boolean;
}

export default function OverviewPage() {
  const { activeSymbol, timeframe, settings, patchSettings } = useApp();
  const router = useRouter();
  const viewport = useViewport();

  const { data: accountRes, loading: accLoading, error: accountError, refresh: refreshAccount } = usePoll(
    () => api.get<AccountRes>("/api/account"), 5000
  );
  const { data: analysisRes, error: analysisError } = usePoll(
    () => api.get<{ analysis: Analysis }>(`/api/strategy/evaluate?symbol=${activeSymbol}&timeframe=${timeframe}`),
    20000, { deps: [activeSymbol, timeframe] }
  );
  const { data: signalsRes } = usePoll(
    () => api.get<{ signals: { id: string; symbol: string; timeframe: string; strategy: string; status: string; price: number; entry: number | null; stop: number | null; target: number | null; rr: number | null; createdAt: string }[] }>("/api/signals?limit=10"),
    25000
  );

  const account = accountRes?.account ?? null;
  const recentSignals = useMemo(() => {
    const seen = new Set<string>();
    return (signalsRes?.signals ?? []).filter((s) => {
      const key = `${s.symbol}|${s.timeframe}|${s.strategy}|${s.status}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [signalsRes]);
  const analysis = analysisRes?.analysis ?? null;
  const m = settings.modules;
  const marginUsedPct = useMemo(() => {
    if (!account || account.equity <= 0) return 0;
    return (account.marginUsed / account.equity) * 100;
  }, [account]);

  const hide = (key: string) => () => void patchSettings({ modules: { [key]: false } });
  const primary = analysis?.signals.find((s) => s.entry !== null) ?? null;

  return (
    <div className="p-4 lg:p-6 space-y-5 page-shell">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="microlabel mb-2">WORKSPACE / OVERVIEW</p>
          <h1 className="text-2xl font-semibold tracking-tight">Your market. In focus.</h1>
          <p className="text-mut text-xs mt-2">Monitor the market, evaluate the evidence, then manage your risk.</p>
        </div>
        <Link href="/chart" className="inline-flex items-center gap-2 bg-accent text-[#071713] rounded-md px-4 py-2.5 text-xs font-semibold">Open workspace <ArrowUpRight size={15} /></Link>
      </header>
      <DecisionReadiness analysis={analysis} error={analysisError} />
      {accountError && <div role="alert" className="panel p-3 text-warn text-xs flex flex-wrap gap-3">Account refresh failed; previous figures may be stale. {accountError}<button onClick={refreshAccount} className="underline">Retry</button></div>}
      {/* metric strip */}
      <div className="auto-cells">
        {m.balance && (
          <MetricCard label="ACCOUNT EQUITY" help="equity"
            value={accLoading ? <Skeleton className="h-6 w-24" /> : fmtUsd(account?.equity)}
            sub={account?.source === "live" ? "EXCHANGE WALLET · SEE DETAILS BELOW" : "SIMULATED ACCOUNT · NOT REAL FUNDS"}
            onHide={hide("balance")} />
        )}
        {m.margin && (
          <MetricCard label="AVAILABLE MARGIN" help="availableMargin"
            value={accLoading ? <Skeleton className="h-6 w-24" /> : fmtUsd(account?.availableMargin)}
            sub={`USED ${fmtUsd(account?.marginUsed ?? 0)}`}
            onHide={hide("margin")} />
        )}
        {m.pnl && (
          <MetricCard label="TODAY P&L" help="todayPnl"
            value={accLoading ? <Skeleton className="h-6 w-20" /> : fmtUsd(account?.todayPnl, { sign: true })}
            tone={pnlTone(account?.todayPnl ?? 0) === "pos" ? "up" : pnlTone(account?.todayPnl ?? 0) === "neg" ? "dn" : "flat"}
            sub="REALIZED TODAY" onHide={hide("pnl")} />
        )}
        {m.pnl && (
          <MetricCard label="OPEN P&L" help="openPnl"
            value={accLoading ? <Skeleton className="h-6 w-20" /> : fmtUsd(account?.openPnl, { sign: true })}
            tone={pnlTone(account?.openPnl ?? 0) === "pos" ? "up" : pnlTone(account?.openPnl ?? 0) === "neg" ? "dn" : "flat"}
            sub="UNREALIZED" onHide={hide("pnl")} />
        )}
        {m.margin && (
          <MetricCard label="MARGIN USED" help="marginUsedPct"
            value={accLoading ? <Skeleton className="h-6 w-16" /> : fmtPct(marginUsedPct, { sign: false })}
            tone={marginUsedPct > 70 ? "dn" : marginUsedPct > 40 ? "accent" : "flat"}
            sub="OF EQUITY" onHide={hide("margin")} />
        )}
      </div>

      {/* chart + strategy intelligence */}
      <div className={`auto-split ${m.strategyScore ? "with-aside" : ""}`}>
        <PremiumPanel title={`${activeSymbol} · ${timeframe}`} right={
          <div className="flex items-center gap-1.5">
            <button onClick={() => router.push("/chart")} className="text-[10px] text-accent hover:underline tracking-wide inline-flex items-center min-h-6">
              FULL CHART →
            </button>
          </div>
        } elevation={1}>
          <div style={{ height: chartHeightFor(viewport) }}>
            <ChartPanel symbol={activeSymbol} timeframe={timeframe} analysis={analysis} interactive />
          </div>
        </PremiumPanel>
        {m.strategyScore && <SignalPanel analysis={analysis} />}
      </div>

      {/* bottom row */}
      <div className="auto-panels">
        {m.positions && (
          <PositionsTable
            account={account}
            source="paper"
            className="lg:col-span-1"
            onClose={(symbol) => {
              void api.post("/api/paper", { action: "close", symbol }).then(() => {
                refreshAccount();
                useApp.getState().notify({ title: "Position closed", body: `${symbol} paper position closed`, tone: "info" });
              }).catch((e: Error) => {
                useApp.getState().notify({ title: "Close failed", body: e.message, tone: "danger" });
              });
            }}
          />
        )}
        {m.risk && (
          <RiskCard
            account={account}
            symbol={activeSymbol}
            defaultLevels={{ entry: primary?.entry, stop: primary?.stop, target: primary?.target }}
          />
        )}
{m.tradeHistory && (
            <PremiumPanel title="RECENT ACTIVITY" elevation={1}>
            {!signalsRes ? (
              <div className="p-3 space-y-1.5">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-4" />)}</div>
            ) : signalsRes.signals.length === 0 ? (
              <EmptyState icon={<Activity size={18} />} title="No signals recorded yet"
                hint="Signals are recorded whenever the engine detects a setup. Repeated rows show one entry per condition." />
            ) : (
              <div className="divide-y divide-edge/60 overflow-y-auto max-h-72">
                {recentSignals.map((s) => (
                  <div key={s.id} className="px-3 py-1.5 flex items-center gap-2 text-[11px]">
                    <Chip tone={s.status === "LONG_SETUP" ? "up" : s.status === "SHORT_SETUP" ? "dn" : s.status === "WATCH" ? "warn" : "default"}>
                      {s.status.replace("_", " ")}
                    </Chip>
                    <span className="num">{s.symbol}</span>
                    <span className="text-dim">{s.strategy}</span>
                    {s.timeframe && <span className="text-dim">{s.timeframe}</span>}
                    <span className="ml-auto num text-dim text-[10px]">{fmtDateTime(new Date(s.createdAt).getTime(), settings.timezone)}</span>
                  </div>
                ))}
              </div>
            )}
          </PremiumPanel>
        )}
      </div>
      <ExchangeAccountPanel />
      <p className="text-[11px] text-dim pb-2">Signals are research candidates, not recommendations. Simulated results do not establish a trading edge.</p>
    </div>
  );
}
