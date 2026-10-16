"use client";
import ChartPanel from "@/components/chart/ChartPanel";
import { ChandelierDonchianPanel } from "@/components/strategy/ChandelierDonchianPanel";
import { PremiumPanel } from "@/components/ui";
import { useApp } from "@/stores";

export default function ChandelierDonchianPage() {
  const { activeSymbol, timeframe } = useApp();
  return (
    <div className="p-4 lg:p-6 space-y-5 max-w-[1600px] mx-auto">
      <header>
        <p className="microlabel mb-2">RESEARCH / TREND FOLLOWING</p>
        <h1 className="text-2xl font-semibold tracking-tight">Strategy laboratory</h1>
        <p className="text-xs text-mut mt-2">Inspect the evidence. Challenge the assumptions. Validate before execution.</p>
      </header>
      <PremiumPanel title={`${activeSymbol} · ${timeframe} · Market prices`}>
        <div className="h-[340px]"><ChartPanel symbol={activeSymbol} timeframe={timeframe} interactive /></div>
      </PremiumPanel>
      <ChandelierDonchianPanel />
      <div className="panel p-4 text-xs text-mut leading-relaxed">
        <h2 className="font-medium text-ink mb-2">How to read this research</h2>
        Signals use closed candles. Heikin-Ashi is an indicator input, not an executable price.
        Backtests enter at the next real candle open and use prior-bar trailing stops, with estimated fees and slippage.
        The 2R target is a planning reference, not a backtest take-profit order. Return / volatility is per trade, not annualized Sharpe.
        DSR is not estimated. This short sample does not prove profitability; validate across markets and unseen periods before trading.
      </div>
    </div>
  );
}
