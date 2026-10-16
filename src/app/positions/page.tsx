"use client";
import { useDisplayCurrency } from "@/lib/useDisplayCurrency";
import { PositionsTable, RiskCard } from "@/components/panels";
import { KV, MetricCard, PageHeader, PremiumPanel } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtPct, fmtUsd, pnlTone } from "@/lib/format";
import { usePoll } from "@/lib/hooks";
import { useApp } from "@/stores";
import type { AccountState } from "@/lib/types";

export default function PositionsPage() {
  useDisplayCurrency();
  const { settings, activeSymbol, notify } = useApp();
  const { data, refresh, error } = usePoll(() => api.get<{ account: AccountState }>("/api/account"), 5000);
  const account = data?.account ?? null;

  const close = async (symbol: string) => {
    try {
      await api.post("/api/paper", { action: "close", symbol });
      notify({ title: "Position closed", body: `${symbol} paper position closed at market.`, tone: "info" });
      refresh();
    } catch (e) {
      notify({ title: "Close failed", body: e instanceof Error ? e.message : "Unknown error", tone: "danger" });
    }
  };

  const rl = settings.riskLimits;

  return (
    <div className="p-4 lg:p-6 space-y-4 page-shell">
      <PageHeader crumb="TRADING / POSITIONS" title="Positions & exposure"
        description="Positions from your selected workspace only, marked against the latest prices." />

      {error && <p role="alert" className="panel p-4 text-warn text-sm">Account unavailable. {error}</p>}
      <div className="auto-cells">
        <MetricCard label="EQUITY" help="equity" value={fmtUsd(account?.equity)} sub={account?.source === "demo" ? "DEMO / PAPER" : "COINDCX"} />
        <MetricCard label="OPEN P&L" help="openPnl" value={fmtUsd(account?.openPnl, { sign: true })}
          tone={pnlTone(account?.openPnl ?? 0) === "pos" ? "up" : pnlTone(account?.openPnl ?? 0) === "neg" ? "dn" : "flat"} />
        <MetricCard label="MARGIN USED" value={fmtUsd(account?.marginUsed)}
          sub={account && account.equity > 0 ? fmtPct((account.marginUsed / account.equity) * 100, { sign: false }) : undefined} />
        <MetricCard label="OPEN POSITIONS" value={String(account?.positions.length ?? 0)}
          sub={`LIMIT ${rl.maxOpenPositions}`} tone={(account?.positions.length ?? 0) >= rl.maxOpenPositions ? "dn" : "flat"} />
      </div>

      <div className="auto-split with-aside">
        <div className="space-y-3">
          <PositionsTable
            account={account}
            source={settings.mode === "live" ? "live" : "paper"}
            onClose={settings.mode === "paper" ? (symbol) => void close(symbol) : undefined}
          />

        </div>

        <div className="space-y-3">
          <PremiumPanel title="RISK LIMITS" elevation={1}>
            <div className="p-3">
              <KV k="MAX DAILY LOSS" v={fmtUsd(rl.maxDailyLoss)} />
              <KV k="MAX ORDER VALUE" v={fmtUsd(rl.maxOrderValue)} />
              <KV k="MAX LEVERAGE" v={`${rl.maxLeverage}×`} />
              <KV k="MAX OPEN POSITIONS" v={String(rl.maxOpenPositions)} />
              <p className="text-[9.5px] text-dim mt-2 leading-snug">
                Orders breaching these limits are blocked before submission. Adjust in Settings → Risk.
              </p>
            </div>
          </PremiumPanel>
          <RiskCard account={account} symbol={activeSymbol} />
        </div>
      </div>
    </div>
  );
}
