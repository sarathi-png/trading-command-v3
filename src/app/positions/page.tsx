"use client";
import { PositionsTable, RiskCard } from "@/components/panels";
import { Chip, KV, MetricCard, Panel } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtPct, fmtUsd, pnlTone } from "@/lib/format";
import { usePoll } from "@/lib/hooks";
import { useApp } from "@/stores";
import type { AccountState } from "@/lib/types";

export default function PositionsPage() {
  const { settings, activeSymbol, notify } = useApp();
  const { data, refresh } = usePoll(() => api.get<{ account: AccountState }>("/api/account"), 5000);
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
    <div className="p-3 space-y-3 max-w-[1400px] mx-auto">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <MetricCard label="EQUITY" value={fmtUsd(account?.equity)} sub={account?.source === "demo" ? "DEMO / PAPER" : "COINDCX"} />
        <MetricCard label="OPEN P&L" value={fmtUsd(account?.openPnl, { sign: true })}
          tone={pnlTone(account?.openPnl ?? 0) === "pos" ? "up" : pnlTone(account?.openPnl ?? 0) === "neg" ? "dn" : "flat"} />
        <MetricCard label="MARGIN USED" value={fmtUsd(account?.marginUsed)}
          sub={account && account.equity > 0 ? fmtPct((account.marginUsed / account.equity) * 100, { sign: false }) : undefined} />
        <MetricCard label="OPEN POSITIONS" value={String(account?.positions.length ?? 0)}
          sub={`LIMIT ${rl.maxOpenPositions}`} tone={(account?.positions.length ?? 0) >= rl.maxOpenPositions ? "dn" : "flat"} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-3">
        <div className="space-y-3">
          <PositionsTable
            account={account}
            source="all"
            onClose={(symbol) => void close(symbol)}
          />
          <Panel title="LIVE EXCHANGE POSITIONS">
            <div className="p-4 text-[11px] text-dim leading-relaxed">
              {settings.dataSource === "live" ? (
                <p className="flex items-center gap-2">
                  <Chip tone="up">LIVE</Chip> Live positions merge into the table above when CoinDCX account data is connected.
                </p>
              ) : (
                <p>
                  The data source is currently <span className="text-warn">demo</span>. Configure CoinDCX in
                  Settings → Market Data to overlay real exchange positions. Live positions are always
                  labelled <Chip>LIVE</Chip>, paper positions <Chip>PAPER</Chip> — they are never mixed.
                </p>
              )}
            </div>
          </Panel>
        </div>

        <div className="space-y-3">
          <Panel title="RISK LIMITS">
            <div className="p-3">
              <KV k="MAX DAILY LOSS" v={fmtUsd(rl.maxDailyLoss)} />
              <KV k="MAX ORDER VALUE" v={fmtUsd(rl.maxOrderValue)} />
              <KV k="MAX LEVERAGE" v={`${rl.maxLeverage}×`} />
              <KV k="MAX OPEN POSITIONS" v={String(rl.maxOpenPositions)} />
              <p className="text-[9.5px] text-dim mt-2 leading-snug">
                Orders breaching these limits are blocked before submission. Adjust in Settings → Risk.
              </p>
            </div>
          </Panel>
          <RiskCard account={account} symbol={activeSymbol} />
        </div>
      </div>
    </div>
  );
}
