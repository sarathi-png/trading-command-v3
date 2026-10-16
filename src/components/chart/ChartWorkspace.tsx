"use client";
import { useDisplayCurrency } from "@/lib/useDisplayCurrency";
import ChartPanel from "@/components/chart/ChartPanel";
import AiPredictionPanel from "@/components/chart/AiPredictionPanel";
import { chartHeightFor, useViewport } from "@/lib/useResponsive";
import { OrderBookPanel, SignalPanel } from "@/components/panels";
import { Chip, DirGlyph, HelpTip, KV, Panel, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtCompactUsd, fmtPct, fmtPrice, fmtUsd } from "@/lib/format";
import { usePoll } from "@/lib/hooks";
import { useMarket, useApp } from "@/stores";
import type { Ticker } from "@/lib/types";
import type { Analysis } from "@/lib/types";
import { cx } from "@/lib/format";
import { useMemo, useState } from "react";

export default function ChartPage({ chartView = "candles" }: { chartView?: "candles" | "heikin-ashi" }) {
  useDisplayCurrency();
  const { activeSymbol, setSymbol, timeframe, settings } = useApp();
  const viewport = useViewport();
  // Each navigation page pins its chart type and matching prediction context.
  const predictionKey = `${activeSymbol}:${timeframe}:${settings.dataSource}:${JSON.stringify({ chandelier: settings.chandelierDonchian?.chandelier, donchian: settings.chandelierDonchian?.donchian })}`;
  const paneHeight = Math.max(chartHeightFor(viewport), Math.min(580, Math.round(viewport.height * 0.62)));
  const view = chartView;
  const [showReview, setShowReview] = useState(true);
  const ticker = useMarket((s) => s.tickers[activeSymbol]);
  const tickers = useMarket((s) => s.tickers);
  const watchlist = useMemo(() => {
    const set = new Set([...settings.watchlist, activeSymbol]);
    return [...set];
  }, [settings.watchlist, activeSymbol]);

  const { data } = usePoll(
    () => api.get<{ analysis: Analysis }>(`/api/strategy/evaluate?symbol=${activeSymbol}&timeframe=${timeframe}&chartType=${chartView}`),
    20000, { deps: [activeSymbol, timeframe, settings.dataSource, chartView] }
  );
  const candidate = data?.analysis;
  const analysis = candidate?.symbol === activeSymbol && candidate.timeframe === timeframe && candidate.chartType === chartView ? candidate : null;

  return (
    <div className="chart-page">
      {/* symbol stat strip */}
      <div className="chart-stat-strip flex items-center gap-4 px-4 min-h-11 border-b border-edge bg-panel2/60 overflow-x-auto whitespace-nowrap">
        <span className="num text-[12px] font-semibold">{activeSymbol}</span>
        {ticker ? (
          <>
            <span className="num text-[13px]">{fmtPrice(ticker.price)}</span>
            <span className={cx("num text-[11px] inline-flex items-center gap-1", ticker.change24hPct >= 0 ? "text-up" : "text-dn")}>
              <DirGlyph value={ticker.change24hPct} />
              {fmtPct(ticker.change24hPct)}
            </span>
            <Stat label="24H HIGH" value={ticker.high24h !== null ? fmtPrice(ticker.high24h) : "N/A"} />
            <Stat label="24H LOW" value={ticker.low24h !== null ? fmtPrice(ticker.low24h) : "N/A"} />
            <Stat label="MARK" value={ticker.markPrice !== null ? fmtPrice(ticker.markPrice) : "N/A"} help="markPrice" />
            {settings.modules.funding && (
              <Stat label="FUNDING / 8H" value={ticker.fundingRate !== null ? fmtPct(ticker.fundingRate, { decimals: 4 }) : "N/A"} help="fundingRate" />
            )}
            {settings.modules.funding && (
              <Stat label="OPEN INTEREST" value={ticker.openInterest !== null ? fmtCompactUsd(ticker.openInterest) : "N/A"} />
            )}
            {settings.modules.volume && (
              <Stat label="24H VOLUME" value={fmtUsd(ticker.volume24hUsd, { decimals: 0 })} />
            )}
            {ticker.source === "demo" && <Chip tone="warn">DEMO DATA</Chip>}
          </>
        ) : (
          <Skeleton className="h-4 w-64" />
        )}
      </div>

      <div className="chart-workspace">
        <div className="chart-stage">
          <div className="chart-view-controls">
            <h1 className="font-semibold text-sm">{view === "candles" ? "Candlestick workspace" : "Heikin-Ashi workspace"}</h1>
            <button type="button" className="chart-review-toggle" aria-pressed={showReview} onClick={() => setShowReview(value => !value)}>
              {showReview ? "Hide AI review" : "Show AI review"}
            </button>
          </div>
          <p className="chart-layout-hint">{view === "candles" ? "Raw candle prices and a dedicated candlestick prediction." : "Smoothed candles and a separate Heikin-Ashi prediction. Smoothed prices are not executable fill prices."}</p>
          <div className="chart-reading-grid">
            {view !== "heikin-ashi" && <section className="panel chart-card" aria-label="Candlestick chart">
              <header className="chart-card-heading">
                <h2>Normal candlesticks <span>· {timeframe}</span></h2>
                <span>Raw candle OHLC</span>
              </header>
              <ChartPanel symbol={activeSymbol} timeframe={timeframe} analysis={analysis}
                interactive showObjectTree chartType="candlestick" surfaceHeight={paneHeight} />
              {showReview && <div className="chart-ai-review">
                <AiPredictionPanel key={`${predictionKey}:candles`} symbol={activeSymbol} timeframe={timeframe} chartType="candles" />
              </div>}
            </section>}
            {view !== "candles" && <section className="panel chart-card" aria-label="Heikin-Ashi chart">
              <header className="chart-card-heading">
                <h2>Heikin-Ashi <span>· {timeframe}</span></h2>
                <span>Smoothed direction · not fill prices</span>
              </header>
              <ChartPanel symbol={activeSymbol} timeframe={timeframe} analysis={analysis}
                interactive showObjectTree chartType="heikin-ashi" surfaceHeight={paneHeight} />
              {showReview && <div className="chart-ai-review">
                <AiPredictionPanel key={`${predictionKey}:heikin-ashi`} symbol={activeSymbol} timeframe={timeframe} chartType="heikin-ashi" />
              </div>}
            </section>}
          </div>
        </div>
        <aside className="chart-context" aria-label="Market context">
          <WatchlistRail symbols={watchlist} tickers={tickers} active={activeSymbol} onPick={setSymbol} />
          {settings.modules.strategyScore && (
            <SignalPanel analysis={analysis} className="chart-context-card" />
          )}
          {settings.modules.orderbook && (
            <OrderBookPanel symbol={activeSymbol} className="chart-context-card" />
          )}
          {analysis && settings.modules.marketStructure && (
            <Panel title="MARKET STRUCTURE" className="chart-context-card">
              <div className="p-3">
                <KV k="SEQUENCE" v={analysis.structureSeq.length ? analysis.structureSeq.join(" → ") : "N/A"} />
                <KV k="TREND" v={
                  <span className={analysis.trend === "BULLISH" ? "text-up" : analysis.trend === "BEARISH" ? "text-dn" : "text-warn"}>
                    {analysis.trend}
                  </span>
                } mono={false} />
                <p className="text-[9.5px] text-dim mt-2 leading-snug">
                  Structure labels are informational observations on closed candles, not certainty claims.
                </p>
              </div>
            </Panel>
          )}
        </aside>
      </div>
    </div>
  );
}

function Stat({ label, value, help }: { label: string; value: string; help?: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-[9px] text-dim tracking-wider">{label}</span>
      <span className="num text-[11px] text-mut">{value}</span>
      {help && <HelpTip topic={help} />}
    </span>
  );
}

/**
 * Watchlist rail beside the chart — the layout TradingView and Kraken Pro both
 * use so a trader can move between instruments without leaving the chart.
 */
function WatchlistRail({ symbols, tickers, active, onPick }: {
  symbols: string[]; tickers: Record<string, Ticker>; active: string; onPick: (symbol: string) => void;
}) {
  useDisplayCurrency();
  return (
    <Panel title="WATCHLIST" badge={<span className="text-[10px] text-dim num">{symbols.length} symbols</span>} className="chart-context-card chart-watchlist">
      <div className="divide-y divide-edge/60 chart-watchlist-rows">
        {symbols.map((symbol) => {
          const t = tickers[symbol];
          const change = t?.change24hPct ?? null;
          return (
            <button
              key={symbol}
              type="button"
              onClick={() => onPick(symbol)}
              aria-current={symbol === active ? "true" : undefined}
              className={cx(
                "w-full flex items-center justify-between gap-2 px-3 h-9 text-left transition-colors",
                symbol === active ? "bg-accent-dim text-accent" : "text-mut hover:text-ink hover:bg-panel2/60"
              )}
            >
              <span className="num text-[11px]">{symbol}</span>
              <span className="flex items-center gap-2 num text-[11px]">
                <span>{t ? fmtPrice(t.price) : "—"}</span>
                <span className={cx("inline-flex items-center gap-1 w-16 justify-end",
                  change === null ? "text-dim" : change >= 0 ? "text-up" : "text-dn")}>
                  {change !== null && <DirGlyph value={change} />}
                  {change === null ? "—" : fmtPct(change)}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </Panel>
  );
}
