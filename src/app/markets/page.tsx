"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Star, X } from "lucide-react";
import { OrderBookPanel } from "@/components/panels";
import { Btn, Chip, EmptyState, Panel, Select, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { cx, fmtCompactUsd, fmtPct, fmtPrice, fmtTime } from "@/lib/format";
import { usePoll } from "@/lib/hooks";
import { useApp, useMarket } from "@/stores";
import type { RecentTrade, Ticker } from "@/lib/types";

export default function MarketsPage() {
  const { settings, patchSettings, setSymbol, activeSymbol } = useApp();
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(null);
  const { data } = usePoll(
    () => api.get<{ tickers: Ticker[]; known: string[] }>("/api/market/tickers"),
    3000
  );
  const { data: detail } = usePoll(
    () => api.get<{ trades: RecentTrade[] }>(`/api/market/orderbook?symbol=${selected}`),
    3000, { enabled: !!selected, deps: [selected] }
  );

  const tickers = data?.tickers ?? [];
  const known = data?.known ?? [];
  const addable = known.filter((s) => !settings.watchlist.includes(s));
  const rows = settings.watchlist
    .map((s) => tickers.find((t) => t.symbol === s))
    .filter((t): t is Ticker => Boolean(t));

  const openSymbol = (sym: string) => {
    setSelected(sym);
    setSymbol(sym);
  };

  return (
    <div className="p-3 grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-3 max-w-[1700px] mx-auto">
      <Panel title="WATCHLIST" right={
        <div className="flex items-center gap-1.5">
          {addable.length > 0 && (
            <Select
              aria-label="Add symbol"
              value=""
              onChange={(e) => {
                if (e.target.value) void patchSettings({ watchlist: [...settings.watchlist, e.target.value] });
              }}
            >
              <option value="">+ add symbol</option>
              {addable.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          )}
        </div>
      }>
        {tickers.length === 0 ? (
          <div className="p-3 space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8" />)}</div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<Star size={18} />} title="Your watchlist is empty" hint="Add a symbol with the selector above." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-left microlabel border-b border-edge">
                  <th className="px-3 py-2 font-medium">SYMBOL</th>
                  <th className="px-2 py-2 font-medium text-right">PRICE</th>
                  <th className="px-2 py-2 font-medium text-right">24H %</th>
                  <th className="px-2 py-2 font-medium text-right hidden sm:table-cell">24H VOLUME</th>
                  <th className="px-2 py-2 font-medium text-right hidden md:table-cell">FUNDING</th>
                  <th className="px-2 py-2 font-medium text-right hidden md:table-cell">OPEN INT</th>
                  <th className="px-2 py-2 font-medium text-right">SRC</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr
                    key={t.symbol}
                    onClick={() => openSymbol(t.symbol)}
                    className={cx(
                      "border-b border-edge/50 cursor-pointer hover:bg-panel2/70",
                      selected === t.symbol && "bg-accent-dim/40"
                    )}
                  >
                    <td className="px-3 py-2 num font-semibold">{t.symbol}</td>
                    <td className="px-2 py-2 num text-right">{fmtPrice(t.price)}</td>
                    <td className={cx("px-2 py-2 num text-right", t.change24hPct >= 0 ? "text-up" : "text-dn")}>
                      {fmtPct(t.change24hPct)}
                    </td>
                    <td className="px-2 py-2 num text-right hidden sm:table-cell text-mut">{fmtCompactUsd(t.volume24hUsd)}</td>
                    <td className="px-2 py-2 num text-right hidden md:table-cell text-mut">
                      {t.fundingRate !== null ? fmtPct(t.fundingRate, { decimals: 4 }) : "N/A"}
                    </td>
                    <td className="px-2 py-2 num text-right hidden md:table-cell text-mut">
                      {t.openInterest !== null ? fmtCompactUsd(t.openInterest) : "N/A"}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <Chip tone={t.source === "demo" ? "warn" : "up"}>{t.source === "demo" ? "DEMO" : "LIVE"}</Chip>
                    </td>
                    <td className="px-2 py-2 text-right">
                      <button
                        aria-label={`Remove ${t.symbol} from watchlist`}
                        onClick={(e) => {
                          e.stopPropagation();
                          void patchSettings({ watchlist: settings.watchlist.filter((s) => s !== t.symbol) });
                        }}
                        className="text-dim hover:text-dn"
                      >
                        <X size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* market detail */}
      <div className="space-y-3">
        {!selected ? (
          <Panel title="MARKET DETAIL">
            <EmptyState icon={<Plus size={18} />} title="Select a market" hint="Click a row to inspect stats, order book and recent trades." />
          </Panel>
        ) : (
          <>
            <MarketDetail symbol={selected} />
            <OrderBookPanel symbol={selected} />
            <Panel title="RECENT TRADES">
              {!detail ? (
                <div className="p-3 space-y-1.5">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-3.5" />)}</div>
              ) : (
                <div className="p-2 text-[10.5px] num max-h-56 overflow-y-auto">
                  {detail.trades.map((tr, i) => (
                    <div key={i} className="grid grid-cols-3 px-1 py-0.5">
                      <span className={tr.side === "buy" ? "text-up" : "text-dn"}>{fmtPrice(tr.price)}</span>
                      <span className="text-right text-mut">{tr.size}</span>
                      <span className="text-right text-dim">{fmtTime(tr.ts, settings.timezone, true)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
            <Btn variant="primary" className="w-full" onClick={() => router.push("/chart")}>
              OPEN {selected} CHART →
            </Btn>
          </>
        )}
      </div>
    </div>
  );
}

function MarketDetail({ symbol }: { symbol: string }) {
  const t = useMarket((s) => s.tickers[symbol]);
  const { activeSymbol } = useApp();
  void activeSymbol;
  return (
    <Panel title={symbol} badge={t && <Chip tone={t.source === "demo" ? "warn" : "up"}>{t.source === "demo" ? "DEMO DATA" : "COINDCX LIVE"}</Chip>}>
      <div className="p-3">
        {t ? (
          <div className="flex items-baseline gap-3 mb-2">
            <span className="num text-xl">${fmtPrice(t.price)}</span>
            <span className={cx("num text-[12px]", t.change24hPct >= 0 ? "text-up" : "text-dn")}>{fmtPct(t.change24hPct)}</span>
          </div>
        ) : (
          <Skeleton className="h-7 w-40 mb-2" />
        )}
        <div className="grid grid-cols-2 gap-x-4 text-[11px]">
          <Row k="BID" v={t?.bid !== null && t?.bid !== undefined ? fmtPrice(t.bid) : "N/A"} />
          <Row k="ASK" v={t?.ask !== null && t?.ask !== undefined ? fmtPrice(t.ask) : "N/A"} />
          <Row k="MARK PRICE" v={t?.markPrice !== null && t?.markPrice !== undefined ? fmtPrice(t.markPrice) : "N/A"} />
          <Row k="INDEX / SPOT" v="N/A" />
          <Row k="24H HIGH" v={t?.high24h !== null && t?.high24h !== undefined ? fmtPrice(t.high24h) : "N/A"} />
          <Row k="24H LOW" v={t?.low24h !== null && t?.low24h !== undefined ? fmtPrice(t.low24h) : "N/A"} />
          <Row k="FUNDING / 8H" v={t?.fundingRate !== null && t?.fundingRate !== undefined ? fmtPct(t.fundingRate, { decimals: 4 }) : "N/A"} />
          <Row k="OPEN INTEREST" v={t?.openInterest !== null && t?.openInterest !== undefined ? fmtCompactUsd(t.openInterest) : "N/A"} />
        </div>
        <p className="text-[9.5px] text-dim mt-2">
          Fields the data source does not provide are shown as N/A — never fabricated.
        </p>
      </div>
    </Panel>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between py-0.5 border-b border-edge/40">
      <span className="text-dim text-[10px] tracking-wide">{k}</span>
      <span className="num">{v}</span>
    </div>
  );
}
