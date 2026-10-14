"use client";
import { useCallback, useEffect, useRef } from "react";
import { Zap } from "lucide-react";
import { api } from "@/lib/api";
import { usePoll } from "@/lib/hooks";
import { useApp } from "@/stores";
import { Chip, PremiumPanel, Skeleton } from "@/components/ui";
import { SignalDisplay } from "./SignalDisplay";
import { ChandelierDonchianConfig } from "./ChandelierDonchianConfig";
import type { ChandelierDonchianConfig as Config, SignalState } from "@/lib/strategy/v2/types";
import type { BacktestResult } from "@/lib/strategy/v2/types";

import { DEFAULT_CHANDELIER_DONCHIAN_CONFIG as DEFAULT_CONFIG } from "@/lib/strategy/v2/types";

interface ApiResponse {
  symbol: string;
  timeframe: string;
  signal: import("@/lib/types").StrategySignal | null;
  state: {
    haColor: "green" | "red" | null;
    donchianTrend: "green" | "red" | "neutral";
    donchianPeriods: Record<number, { upper: number; lower: number; middle: number }>;
    chandelierTrend: "long" | "short" | null;
    chandelierLongStop: number | null;
    chandelierShortStop: number | null;
  } | null;
  sizing: { qty: number; riskAmount: number; riskPct: number; leverage: number; entry: number; stop: number } | null;
  backtest: BacktestResult | null;
  config: Config;
  source: string;
  sizingSource: string | null;
  evaluatedAt: number;
}

export function ChandelierDonchianPanel({ className }: { className?: string }) {
  const { activeSymbol, timeframe, settings, patchSettings, notify } = useApp();
  const config = settings.chandelierDonchian ?? DEFAULT_CONFIG;
  const prevSignalStatusRef = useRef<string | null>(null);

  const { data, error } = usePoll<ApiResponse>(
    () => api.get<ApiResponse>(`/api/strategy/chandelier-donchian?symbol=${activeSymbol}&timeframe=${timeframe}&backtest=true`),
    30000,
    { deps: [activeSymbol, timeframe, config] }
  );

  const signalState: SignalState | null = data?.state
    ? {
        signal: data.signal,
        haColor: data.state.haColor,
        donchianState: {
          trend: data.state.donchianTrend,
          periods: data.state.donchianPeriods,
        },
        chandelierState: {
          trend: data.state.chandelierTrend,
          longStop: data.state.chandelierLongStop,
          shortStop: data.state.chandelierShortStop,
        },
        entry: data.signal?.entry ?? null,
        stop: data.signal?.stop ?? null,
        target: data.signal?.target ?? null,
        rr: data.signal?.rr ?? null,
        barsSinceEntry: null,
      }
    : null;

  // Alert on signal change (using ref to avoid setState in effect)
  useEffect(() => {
    if (!data?.signal) return;
    const status = data.signal.status;
    const prev = prevSignalStatusRef.current;
    if (prev !== null && prev !== status) {
      if (status === "LONG_SETUP") {
        notify({
          title: "Chandelier+Donchian: LONG SETUP",
          body: `${activeSymbol} ${timeframe} — BUY ${data.signal.entry ? data.signal.entry.toFixed(2) : "on trigger"}`,
          tone: "success",
        });
      } else if (status === "SHORT_SETUP") {
        notify({
          title: "Chandelier+Donchian: SHORT SETUP",
          body: `${activeSymbol} ${timeframe} — SELL ${data.signal.entry ? data.signal.entry.toFixed(2) : "on trigger"}`,
          tone: "danger",
        });
      }
    }
    prevSignalStatusRef.current = status;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.signal?.status, activeSymbol, timeframe, notify]);

  const handleConfigChange = useCallback((newConfig: Config) => {
    void patchSettings({
      chandelierDonchian: newConfig,
    } as Partial<import("@/lib/types").AppSettings>);
  }, [patchSettings]);

  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-2">
        <div>
          <h2 className="text-[13px] font-semibold">Chandelier Exit + Donchian Ribbon</h2>
          <p className="text-[10px] text-dim">
            {timeframe} {config.heikinAshi ? "Heikin Ashi" : "Standard candles"} · ATR-{config.chandelier.atrLength} ×{config.chandelier.multiplier} · Donchian {config.donchian.periods.join("/")}
          </p>
        </div>
        <Chip tone="accent">
          <Zap size={11} /> {error ? "UNAVAILABLE" : data ? (data.source === "demo" ? "SIMULATED" : "MARKET DATA") : "LOADING"}
        </Chip>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-3">
        <div className="space-y-3">
          {error ? (
            <PremiumPanel title="CHANDELIER + DONCHIAN" elevation={2}>
              <div className="p-3">
                <p className="text-[11px] text-warn">{typeof error === "string" ? error : (error as Error)?.message || "Failed to load signal"}</p>
              </div>
            </PremiumPanel>
          ) : !data ? (
            <PremiumPanel title="CHANDELIER + DONCHIAN" elevation={2}>
              <div className="p-3 space-y-2">
                <Skeleton className="h-16" />
                <Skeleton className="h-20" />
              </div>
            </PremiumPanel>
          ) : (
            <>
              <SignalDisplay state={signalState} />
              {data.sizing && (
                <PremiumPanel title="POSITION SIZING" elevation={1}>
                  <div className="p-3 space-y-1.5">
                    <div className="grid grid-cols-2 gap-x-4 text-[11px]">
                      <span className="text-dim">QUANTITY</span>
                      <span className="num text-right text-ink">{data.sizing.qty.toFixed(4)}</span>
                      <span className="text-dim">RISK AMOUNT</span>
                      <span className="num text-right text-dn">${data.sizing.riskAmount.toFixed(2)}</span>
                      <span className="text-dim">RISK %</span>
                      <span className="num text-right text-ink">{data.sizing.riskPct.toFixed(1)}%</span>
                      <span className="text-dim">LEVERAGE</span>
                      <span className="num text-right text-ink">{data.sizing.leverage}×</span>
                    </div>
                  </div>
                </PremiumPanel>
              )}
              {data.backtest && data.backtest.totalTrades > 0 && (
                <PremiumPanel title="BACKTEST SUMMARY" elevation={1} badge={
                  <Chip tone={data.backtest.expectancy > 0 ? "up" : "dn"}>
                    {data.backtest.expectancy > 0 ? "PROFITABLE" : "UNPROFITABLE"}
                  </Chip>
                }>
                  <div className="p-3 space-y-1.5">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
                      <Metric label="TRADES" value={String(data.backtest.totalTrades)} />
                      <Metric label="WIN RATE" value={`${data.backtest.winRate.toFixed(1)}%`} />
                      <Metric label="EXPECTANCY" value={data.backtest.expectancy.toFixed(4)} tone={data.backtest.expectancy > 0 ? "up" : "dn"} />
                      <Metric label="PROFIT FACTOR" value={data.backtest.profitFactor?.toFixed(2) ?? "N/A (no losses)"} />
                      <Metric label="MAX DD" value={`${data.backtest.maxDrawdownPct.toFixed(1)}%`} tone="dn" />
                      <Metric label="RETURN / VOL (TRADE)" value={data.backtest.sharpeRatio.toFixed(2)} />
                      <Metric label="DSR" value="Not estimated" />
                      <Metric label="AVG HOLD" value={`${data.backtest.avgHoldBars.toFixed(0)} bars`} />
                    </div>
                  </div>
                </PremiumPanel>
              )}
            </>
          )}
        </div>

        <ChandelierDonchianConfig config={config} onChange={handleConfigChange} />
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "up" | "dn" | "flat" }) {
  return (
    <div className="rounded border border-edge bg-panel2/60 px-2 py-1.5">
      <p className="microlabel">{label}</p>
      <p className={`num text-[12px] font-semibold mt-0.5 ${
        tone === "up" ? "text-up" : tone === "dn" ? "text-dn" : "text-ink"
      }`}>
        {value}
      </p>
    </div>
  );
}