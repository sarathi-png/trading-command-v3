"use client";
import { useMemo, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Activity } from "lucide-react";
import ChartPanel from "@/components/chart/ChartPanel";
import ExchangeAccountPanel from "@/components/ExchangeAccountPanel";
import { PositionsTable, RiskCard, SignalPanel } from "@/components/panels";
import { Chip, EmptyState, MetricCard, Panel, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtDateTime, fmtPct, fmtUsd, pnlTone } from "@/lib/format";
import { usePoll } from "@/lib/hooks";
import { useApp, useAlerts } from "@/stores";
import type { AccountState, Analysis } from "@/lib/types";

interface AccountRes {
  account: AccountState;
  mode: string;
  exchangeAccountConfigured: boolean;
}

export default function OverviewPage() {
  const { activeSymbol, timeframe, settings, patchSettings } = useApp();
  const router = useRouter();

  const { data: accountRes, loading: accLoading } = usePoll(
    () => api.get<AccountRes>("/api/account"), 5000
  );
  const { data: analysisRes } = usePoll(
    () => api.get<{ analysis: Analysis }>(`/api/strategy/evaluate?symbol=${activeSymbol}&timeframe=${timeframe}`),
    20000, { deps: [activeSymbol, timeframe] }
  );
  const { data: signalsRes } = usePoll(
    () => api.get<{ signals: { id: string; symbol: string; timeframe: string; strategy: string; status: string; price: number; entry: number | null; stop: number | null; target: number | null; rr: number | null; createdAt: string }[] }>("/api/signals?limit=10"),
    25000
  );

  const account = accountRes?.account ?? null;
  const analysis = analysisRes?.analysis ?? null;
  const m = settings.modules;
  const { rules: alertRules } = useAlerts();
  const notify = useApp((s) => s.notify);

  // Track previous signals to detect new LONG/SHORT setups
  const prevSignalsRef = useRef<Record<string, string>>({});
  
  useEffect(() => {
    if (!signalsRes || !alertRules.length) return;
    
    const strategySignalRules = alertRules.filter((r) => r.kind === "strategy_signal" && r.enabled && !r.triggeredAt);
    if (strategySignalRules.length === 0) return;
    
    for (const signal of signalsRes.signals) {
      const key = `${signal.symbol}-${signal.timeframe}-${signal.strategy}-${signal.status}`;
      const wasSeen = prevSignalsRef.current[key];
      
      if (!wasSeen && (signal.status === "LONG_SETUP" || signal.status === "SHORT_SETUP")) {
        // Check if this signal matches any alert rule
        for (const rule of strategySignalRules) {
          if (rule.symbol === "ANY" || rule.symbol === signal.symbol) {
            const side = signal.status === "LONG_SETUP" ? "LONG" : "SHORT";
            const entry = signal.entry ? `Entry: ${signal.entry.toLocaleString()}` : "Entry: market";
            const stop = signal.stop ? `SL: ${signal.stop.toLocaleString()}` : "SL: —";
            const target = signal.target ? `TP: ${signal.target.toLocaleString()}` : "TP: —";
            const rr = signal.rr ? `RR: 1:${signal.rr.toFixed(1)}` : "RR: —";
            
            notify({
              title: `Strategy Signal: ${side} ${signal.symbol}`,
              body: `${signal.strategy} | ${entry} | ${stop} | ${target} | ${rr} | ${signal.timeframe}`,
              tone: side === "LONG" ? "success" : "warn",
            });
          }
        }
        prevSignalsRef.current[key] = "seen";
      }
    }
    
    // Clean up old entries (keep last 50)
    const keys = Object.keys(prevSignalsRef.current);
    if (keys.length > 50) {
      const toDelete = keys.slice(0, keys.length - 50);
      for (const k of toDelete) delete prevSignalsRef.current[k];
    }
  }, [signalsRes, alertRules, notify]);
  const marginUsedPct = useMemo(() => {
    if (!account || account.equity <= 0) return 0;
    return (account.marginUsed / account.equity) * 100;
  }, [account]);

  const hide = (key: string) => () => void patchSettings({ modules: { [key]: false } });
  const primary = analysis?.signals.find((s) => s.entry !== null) ?? null;

  return (
    <div className="p-3 space-y-3 max-w-[1700px] mx-auto">
      {/* metric strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
        {m.balance && (
          <MetricCard label="ACCOUNT EQUITY" tooltip="Starting balance + realized + unrealized P&L"
            value={accLoading ? <Skeleton className="h-6 w-24" /> : fmtUsd(account?.equity)}
            sub="COINDCX FUTURES"
            onHide={hide("balance")} />
        )}
        {m.margin && (
          <MetricCard label="AVAILABLE MARGIN"
            value={accLoading ? <Skeleton className="h-6 w-24" /> : fmtUsd(account?.availableMargin)}
            sub={`USED ${fmtUsd(account?.marginUsed ?? 0)}`}
            onHide={hide("margin")} />
        )}
        {m.pnl && (
          <MetricCard label="TODAY P&L"
            value={accLoading ? <Skeleton className="h-6 w-20" /> : fmtUsd(account?.todayPnl, { sign: true })}
            tone={pnlTone(account?.todayPnl ?? 0) === "pos" ? "up" : pnlTone(account?.todayPnl ?? 0) === "neg" ? "dn" : "flat"}
            sub="REALIZED TODAY" onHide={hide("pnl")} />
        )}
        {m.pnl && (
          <MetricCard label="OPEN P&L"
            value={accLoading ? <Skeleton className="h-6 w-20" /> : fmtUsd(account?.openPnl, { sign: true })}
            tone={pnlTone(account?.openPnl ?? 0) === "pos" ? "up" : pnlTone(account?.openPnl ?? 0) === "neg" ? "dn" : "flat"}
            sub="UNREALIZED" onHide={hide("pnl")} />
        )}
        {m.margin && (
          <MetricCard label="MARGIN USED"
            value={accLoading ? <Skeleton className="h-6 w-16" /> : fmtPct(marginUsedPct, { sign: false })}
            tone={marginUsedPct > 70 ? "dn" : marginUsedPct > 40 ? "accent" : "flat"}
            sub="OF EQUITY" onHide={hide("margin")} />
        )}
      </div>

      <ExchangeAccountPanel />

      {/* chart + strategy intelligence */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_310px] gap-3">
        <Panel title={`${activeSymbol} · ${timeframe}`} right={
          <div className="flex items-center gap-1.5">
            <button onClick={() => router.push("/chart")} className="text-[10px] text-accent hover:underline tracking-wide">
              FULL CHART →
            </button>
          </div>
        }>
          <div className="h-[380px]">
            <ChartPanel symbol={activeSymbol} timeframe={timeframe} analysis={analysis} interactive />
          </div>
        </Panel>
        {m.strategyScore && <SignalPanel analysis={analysis} />}
      </div>

      {/* bottom row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {m.positions && (
          <PositionsTable
            account={account}
            source="all"
            className="lg:col-span-1"
            onClose={(symbol) => {
              void api.post("/api/paper", { action: "close", symbol }).then(() => {
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
          <Panel title="RECENT ACTIVITY">
            {!signalsRes ? (
              <div className="p-3 space-y-1.5">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-4" />)}</div>
            ) : signalsRes.signals.length === 0 ? (
              <EmptyState icon={<Activity size={18} />} title="No signals recorded yet"
                hint="Signals are stored every time the strategy engine detects a setup on any watched timeframe." />
            ) : (
              <div className="divide-y divide-edge/60 overflow-y-auto max-h-72">
                {signalsRes.signals.map((s) => (
                  <div key={s.id} className="px-3 py-1.5 flex items-center gap-2 text-[11px]">
                    <Chip tone={s.status === "LONG_SETUP" ? "up" : s.status === "SHORT_SETUP" ? "dn" : s.status === "WATCH" ? "warn" : "default"}>
                      {s.status.replace("_", " ")}
                    </Chip>
                    <span className="num">{s.symbol}</span>
                    <span className="text-dim">{s.strategy}</span>
                    <span className="ml-auto num text-dim text-[10px]">{fmtDateTime(new Date(s.createdAt).getTime(), settings.timezone)}</span>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        )}
      </div>
    </div>
  );
}
