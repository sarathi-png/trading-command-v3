"use client";
import { useState, useCallback, useEffect, useRef } from "react";
import { Zap, CandlestickChart, Settings2, TrendingUp, TrendingDown } from "lucide-react";
import { api } from "@/lib/api";
import { usePoll } from "@/lib/hooks";
import { useApp } from "@/stores";
import { Chip, PremiumPanel, Skeleton, ToggleSwitch, MetricRow } from "@/components/ui";
import { SignalDisplay } from "@/components/strategy/SignalDisplay";
import { ChandelierDonchianConfig } from "@/components/strategy/ChandelierDonchianConfig";
import ChartPanel from "@/components/chart/ChartPanel";
import type { ChandelierDonchianConfig as Config, SignalState } from "@/lib/strategy/v2/types";
import type { BacktestResult } from "@/lib/strategy/v2/types";

const DEFAULT_CONFIG: Config = {
  chandelier: { atrLength: 20, multiplier: 3.0 },
  donchian: { periods: [20, 50, 100, 200] },
  heikinAshi: true,
  timeStop: { enabled: true, bars: 48 },
  risk: { leverage: 10, riskPct: 1.0, lotSize: null, maxPositions: 1, mode: "auto" },
};

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
  evaluatedAt: number;
}

export default function ChandelierDonchianPage() {
  const { activeSymbol, timeframe, settings, patchSettings, notify } = useApp();
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);
  const [showOverlay, setShowOverlay] = useState(true);
  const prevSignalStatusRef = useRef<string | null>(null);

  const { data, error } = usePoll<ApiResponse>(
    () => api.get<ApiResponse>(`/api/strategy/chandelier-donchian?symbol=${activeSymbol}&timeframe=5m&backtest=true`),
    5000,
    { deps: [activeSymbol] }
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

  // Alert on signal change
  useEffect(() => {
    if (!data?.signal) return;
    const status = data.signal.status;
    const prev = prevSignalStatusRef.current;
    if (prev !== null && prev !== status) {
      if (status === "LONG_SETUP") {
        notify({
          title: "Chandelier+Donchian: LONG SETUP",
          body: `${activeSymbol} 5m — BUY ${data.signal.entry ? data.signal.entry.toFixed(2) : "on trigger"}`,
          tone: "success",
        });
      } else if (status === "SHORT_SETUP") {
        notify({
          title: "Chandelier+Donchian: SHORT SETUP",
          body: `${activeSymbol} 5m — SELL ${data.signal.entry ? data.signal.entry.toFixed(2) : "on trigger"}`,
          tone: "danger",
        });
      }
    }
    prevSignalStatusRef.current = status;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.signal?.status, activeSymbol, notify]);

  const handleConfigChange = useCallback((newConfig: Config) => {
    setConfig(newConfig);
    void patchSettings({
      chandelierDonchian: newConfig,
    } as Partial<import("@/lib/types").AppSettings>);
  }, [patchSettings]);

  return (
    <div className="p-3 space-y-3 max-w-[1500px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-[15px] font-semibold">Chandelier Exit + Donchian Ribbon</h1>
          <p className="text-[11px] text-dim">
            5m Heikin Ashi · Chandelier ATR-20 ×3.0 · Donchian 20/50/100/200
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Chip tone="accent">
            <Zap size={11} /> {data ? "LIVE" : "LOADING"}
          </Chip>
          <ToggleSwitch
            checked={showOverlay}
            onChange={setShowOverlay}
          />
          <span className="text-[10px] text-dim">Chart Overlay</span>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-3">
        {/* Left: Chart + Signal */}
        <div className="space-y-3">
          {/* Chart with Heikin Ashi */}
          <PremiumPanel
            title={`${activeSymbol} · 5m Heikin Ashi`}
            right={
              <div className="flex items-center gap-1.5">
                <ToggleSwitch
                  checked={showOverlay}
                  onChange={setShowOverlay}
                />
                <span className="text-[10px] text-dim">Strategy Overlay</span>
              </div>
            }
            elevation={1}
          >
            <div className="h-[500px]">
              <ChartPanel
                symbol={activeSymbol}
                timeframe="5m"
                analysis={null}
                interactive
                showObjectTree
                className="h-full"
              />
            </div>
          </PremiumPanel>

          {/* Signal Display */}
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
                      <MetricRow label="TRADES" value={String(data.backtest.totalTrades)} />
                      <MetricRow label="WIN RATE" value={`${data.backtest.winRate.toFixed(1)}%`} />
                      <MetricRow label="EXPECTANCY" value={data.backtest.expectancy.toFixed(4)} tone={data.backtest.expectancy > 0 ? "up" : "dn"} />
                      <MetricRow label="PROFIT FACTOR" value={data.backtest.profitFactor.toFixed(2)} />
                      <MetricRow label="MAX DD" value={`${data.backtest.maxDrawdownPct.toFixed(1)}%`} tone="dn" />
                      <MetricRow label="SHARPE" value={data.backtest.sharpeRatio.toFixed(2)} />
                      <MetricRow label="DSR" value={data.backtest.dsr.toFixed(2)} tone={data.backtest.dsr > 0.5 ? "up" : "dn"} />
                      <MetricRow label="AVG HOLD" value={`${data.backtest.avgHoldBars.toFixed(0)} bars`} />
                    </div>
                  </div>
                </PremiumPanel>
              )}
            </>
          )}
        </div>

        {/* Right: Config */}
        <ChandelierDonchianConfig config={config} onChange={handleConfigChange} />
      </div>
    </div>
  );
}