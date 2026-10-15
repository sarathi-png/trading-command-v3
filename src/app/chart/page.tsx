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
import { useMemo } from "react";

export default function ChartPage() {
  useDisplayCurrency();
  const { activeSymbol, setSymbol, timeframe, settings } = useApp();
  const viewport = useViewport();
  // The AI panels and the charts must agree on what is being predicted, so both
  // panes are pinned: one candlestick chart, one Heikin-Ashi chart.
  const predictionKey = `${activeSymbol}:${timeframe}:${settings.dataSource}:${JSON.stringify({ chandelier: settings.chandelierDonchian?.chandelier, donchian: settings.chandelierDonchian?.donchian })}`;
  const paneHeight = chartHeightFor(viewport);
  const ticker = useMarket((s) => s.tickers[activeSymbol]);
  const tickers = useMarket((s) => s.tickers);
  const watchlist = useMemo(() => {
    const set = new Set([...settings.watchlist, activeSymbol]);
    return [...set];
  }, [settings.watchlist, activeSymbol]);

  const { data } = usePoll(
    () => api.get<{ analysis: Analysis }>(`/api/strategy/evaluate?symbol=${activeSymbol}&timeframe=${timeframe}`),
    20000, { deps: [activeSymbol, timeframe, settings.dataSource] }
  );
  const analysis = data?.analysis ?? null;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* symbol stat strip */}
      <div className="flex items-center gap-4 px-3 h-9 border-b border-edge bg-panel2/60 flex-none overflow-x-auto whitespace-nowrap">
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

      {/* workspace: normal chart AND a separate Heikin-Ashi chart, each with its
          own AI prediction. Side by side when the screen is wide and landscape,
          stacked when it is tall, narrow or portrait. */}
      <div className="flex flex-1 min-h-0">
        <div className="flex-1 min-w-0 min-h-[300px] lg:min-h-[420px] overflow-y-auto">
          <div className="chart-duo">
            <section className="panel rounded-none border-x-0 border-t-0 overflow-hidden" aria-label="Candlestick chart">
              <div className="px-3 py-1.5 border-b border-edge flex items-center justify-between">
                <span className="microlabel">CANDLESTICK · {timeframe}</span>
                <span className="text-[9.5px] text-dim">raw traded prices</span>
              </div>
              <div style={{ height: paneHeight }}>
                <ChartPanel
                  symbol={activeSymbol}
                  timeframe={timeframe}
                  analysis={analysis}
                  interactive
                  showObjectTree
                  chartType="candlestick"
                  lockChartType
                />
              </div>
              <AiPredictionPanel key={`${predictionKey}:candles`} symbol={activeSymbol} timeframe={timeframe} chartType="candles" className="border-t border-edge" />
            </section>

            <section className="panel rounded-none border-x-0 border-t-0 overflow-hidden" aria-label="Heikin-Ashi chart">
              <div className="px-3 py-1.5 border-b border-edge flex items-center justify-between">
                <span className="microlabel">HEIKIN-ASHI · {timeframe}</span>
                <span className="text-[9.5px] text-dim">smoothed — reads direction, not price</span>
              </div>
              <div style={{ height: paneHeight }}>
                <ChartPanel
                  symbol={activeSymbol}
                  timeframe={timeframe}
                  analysis={analysis}
                  interactive
                  showObjectTree
                  chartType="heikin-ashi"
                  lockChartType
                />
              </div>
              <AiPredictionPanel key={`${predictionKey}:heikin-ashi`} symbol={activeSymbol} timeframe={timeframe} chartType="heikin-ashi" className="border-t border-edge" />
            </section>
          </div>
        </div>
        <div className="ratio-rail flex-col w-76 border-l border-edge gap-0 overflow-y-auto flex-none">
          <WatchlistRail symbols={watchlist} tickers={tickers} active={activeSymbol} onPick={setSymbol} />
          {settings.modules.strategyScore && (
            <SignalPanel analysis={analysis} className="border-0 rounded-none border-b border-edge" />
          )}
          {settings.modules.orderbook && (
            <OrderBookPanel symbol={activeSymbol} className="border-0 rounded-none border-b border-edge" />
          )}
          {analysis && settings.modules.marketStructure && (
            <Panel title="MARKET STRUCTURE" className="border-0 rounded-none">
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
        </div>
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
    <Panel title="WATCHLIST" className="border-0 rounded-none border-b border-edge">
      <div className="divide-y divide-edge/60">
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
