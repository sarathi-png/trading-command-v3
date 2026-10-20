"use client";
import { useDisplayCurrency } from "@/lib/useDisplayCurrency";
import MarketMovers from "@/components/MarketMovers";
import ResearchPanel from "@/components/ResearchPanel";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { OrderBookPanel } from "@/components/panels";
import { Btn, Chip, EmptyState, Input, PageHeader, Panel, Select, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { cx, fmtCompactUsd, fmtPct, fmtPrice, fmtTime } from "@/lib/format";
import { usePoll } from "@/lib/hooks";
import { useApp, useMarket } from "@/stores";
import type { RecentTrade, Ticker } from "@/lib/types";

export default function MarketsPage() {
  useDisplayCurrency();
  const { settings, setSymbol, patchSettings } = useApp();
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(null);
  const [scope, setScope] = useState<"watchlist" | "all">("watchlist");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ key: "symbol" | "price" | "change" | "volume"; dir: 1 | -1 }>({
    key: "symbol",
    dir: 1,
  });
  const [editing, setEditing] = useState(false);
  const [toAdd, setToAdd] = useState("");
  const { data, error, loading } = usePoll(
    () => api.get<{ tickers: Ticker[]; known: string[] }>("/api/market/tickers"),
    3000
  );
  const { data: detail } = usePoll(
    () => api.get<{ trades: RecentTrade[] }>(`/api/market/orderbook?symbol=${selected}`),
    3000, { enabled: !!selected, deps: [selected] }
  );

  const tickers = data?.tickers ?? [];
  const known = data?.known ?? [];
  const universe = scope === "all" && known.length ? known : settings.watchlist;
  const rows = universe
    .filter((symbol) => symbol.toLowerCase().includes(query.trim().toLowerCase()))
    .map((symbol) => ({ symbol, ticker: tickers.find((t) => t.symbol === symbol) }))
    .sort((a, b) => {
      const dir = sort.dir;
      if (sort.key === "symbol") return a.symbol.localeCompare(b.symbol) * dir;
      const av = sort.key === "price" ? a.ticker?.price
        : sort.key === "change" ? a.ticker?.change24hPct
        : a.ticker?.volume24hUsd;
      const bv = sort.key === "price" ? b.ticker?.price
        : sort.key === "change" ? b.ticker?.change24hPct
        : b.ticker?.volume24hUsd;
      // Unavailable values always sort last, whichever direction is active.
      if (av === undefined || av === null) return bv === undefined || bv === null ? 0 : 1;
      if (bv === undefined || bv === null) return -1;
      return (av - bv) * dir;
    });

  const toggleSort = (key: typeof sort.key) =>
    setSort((s) => ({ key, dir: s.key === key && s.dir === 1 ? -1 : 1 }));

  const removeSymbol = (symbol: string) => {
    if (settings.watchlist.length <= 1) return;
    void patchSettings({ watchlist: settings.watchlist.filter((s) => s !== symbol) });
  };

  const addSymbol = () => {
    if (!toAdd || settings.watchlist.includes(toAdd)) return;
    void patchSettings({ watchlist: [...settings.watchlist, toAdd] });
    setToAdd("");
  };

  const addable = known.filter((s) => !settings.watchlist.includes(s));

  const openSymbol = (sym: string) => {
    setSelected(sym);
    setSymbol(sym);
  };

  return (
    <div className="p-4 lg:p-6 space-y-4 page-shell">
      <PageHeader crumb="MARKETS / WATCHLIST" title="Markets"
        description="Your saved watchlist, or the full venue universe. Filter and sort locally; missing quotes stay unavailable and demo quotes are labelled." />
      <MarketMovers />
      <ResearchPanel />
      <div className="auto-split with-aside">
      <Panel
        title={scope === "all" ? "SCREENER · ALL AVAILABLE SYMBOLS" : "WATCHLIST"}
        badge={<Chip>{rows.length}</Chip>}
      >
        <div className="flex flex-wrap items-center gap-2 p-2 border-b border-edge">
          <div className="flex rounded border border-edge overflow-hidden">
            <button onClick={() => setScope("watchlist")}
              className={cx("px-2 h-7 text-[10px] font-semibold", scope === "watchlist" ? "bg-accent-dim text-ink" : "text-dim hover:text-mut")}>
              WATCHLIST
            </button>
            <button onClick={() => setScope("all")}
              className={cx("px-2 h-7 text-[10px] font-semibold border-l border-edge", scope === "all" ? "bg-accent-dim text-ink" : "text-dim hover:text-mut")}>
              ALL
            </button>
          </div>
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter symbol…" className="h-7 w-32 text-[11px]" />
          <Btn size="sm" variant={editing ? "primary" : "ghost"} onClick={() => setEditing((v) => !v)}>
            {editing ? "DONE" : "EDIT"}
          </Btn>
        </div>
        {error && <p role="status" className="p-3 text-[11px] text-warn">Quotes unavailable: {error}. No demo fallback.</p>}
        {loading && !data ? (
          <div className="p-3 space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8" />)}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-left microlabel border-b border-edge">
                  <th className="px-3 py-2 font-medium">
                    <button onClick={() => toggleSort("symbol")} className="hover:text-ink">SYMBOL {sort.key === "symbol" ? (sort.dir === 1 ? "↑" : "↓") : ""}</button>
                  </th>
                  <th className="px-2 py-2 font-medium text-right">
                    <button onClick={() => toggleSort("price")} className="hover:text-ink">PRICE {sort.key === "price" ? (sort.dir === 1 ? "↑" : "↓") : ""}</button>
                  </th>
                  <th className="px-2 py-2 font-medium text-right">
                    <button onClick={() => toggleSort("change")} className="hover:text-ink">24H % {sort.key === "change" ? (sort.dir === 1 ? "↑" : "↓") : ""}</button>
                  </th>
                  <th className="px-2 py-2 font-medium text-right hidden sm:table-cell">
                    <button onClick={() => toggleSort("volume")} className="hover:text-ink">24H VOLUME {sort.key === "volume" ? (sort.dir === 1 ? "↑" : "↓") : ""}</button>
                  </th>
                  <th className="px-2 py-2 font-medium text-right hidden md:table-cell">FUNDING</th>
                  <th className="px-2 py-2 font-medium text-right hidden md:table-cell">OPEN INT</th>
                  <th className="px-2 py-2 font-medium text-right">SRC</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ symbol, ticker: t }) => (
                  <tr
                    key={symbol}
                    onClick={() => openSymbol(symbol)}
                    className={cx(
                      "border-b border-edge/50 cursor-pointer hover:bg-panel2/70",
                      selected === symbol && "bg-accent-dim/40"
                    )}
                  >
                    <td className="px-3 py-2 num font-semibold">
                      {editing && scope === "watchlist" ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); removeSymbol(symbol); }}
                          className="text-dn hover:underline mr-1"
                          aria-label={`Remove ${symbol} from watchlist`}
                        >×</button>
                      ) : null}
                      {symbol}
                    </td>
                    <td className="px-2 py-2 num text-right">{fmtPrice(t?.price)}</td>
                    <td className={cx("px-2 py-2 num text-right", (t?.change24hPct ?? 0) >= 0 ? "text-up" : "text-dn")}>
                      {fmtPct(t?.change24hPct)}
                    </td>
                    <td className="px-2 py-2 num text-right hidden sm:table-cell text-mut">{fmtCompactUsd(t?.volume24hUsd)}</td>
                    <td className="px-2 py-2 num text-right hidden md:table-cell text-mut">
                      {t?.fundingRate != null ? fmtPct(t.fundingRate, { decimals: 4 }) : "N/A"}
                    </td>
                    <td className="px-2 py-2 num text-right hidden md:table-cell text-mut">
                      {t?.openInterest != null ? fmtCompactUsd(t.openInterest) : "N/A"}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <Chip tone={!t || t.source === "demo" ? "warn" : "up"}>{!t ? "NO QUOTE" : t.source === "demo" ? "DEMO" : "LIVE"}</Chip>
                    </td>

                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {editing && scope === "watchlist" && (
          <div className="flex items-center gap-2 p-2 border-t border-edge">
            <Select value={toAdd} onChange={(e) => setToAdd(e.target.value)} className="h-7 text-[11px] w-40">
              <option value="">Add symbol…</option>
              {addable.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
            <Btn size="sm" disabled={!toAdd} onClick={addSymbol}>ADD</Btn>
            <span className="text-[10px] text-dim">Saved to your settings; used by the rail and scans.</span>
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
    </div>
  );
}

function MarketDetail({ symbol }: { symbol: string }) {
  useDisplayCurrency();
  const t = useMarket((s) => s.tickers[symbol]);
  return (
    <Panel title={symbol} badge={t && <Chip tone={t.source === "demo" ? "warn" : "up"}>{t.source === "demo" ? "DEMO DATA" : "COINDCX LIVE"}</Chip>}>
      <div className="p-3">
        {t ? (
          <div className="flex items-baseline gap-3 mb-2">
            <span className="num text-xl">{fmtPrice(t?.price)}</span>
            <span className={cx("num text-[12px]", (t?.change24hPct ?? 0) >= 0 ? "text-up" : "text-dn")}>{fmtPct(t?.change24hPct)}</span>
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
