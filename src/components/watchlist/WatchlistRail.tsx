"use client";
import Link from "next/link";
import { Chip, Panel } from "@/components/ui";
import { cx, fmtPct, fmtPrice } from "@/lib/format";
import { useApp, useMarket } from "@/stores";

/**
 * Dashboard watchlist. Quotes come from the shared market poll (already scoped
 * to the saved watchlist); a missing quote is shown as unavailable, never as 0.
 */
export default function WatchlistRail() {
  const { settings, activeSymbol, setSymbol } = useApp();
  const tickers = useMarket((s) => s.tickers);
  const feed = useMarket((s) => s.feed);

  return (
    <Panel
      title="WATCHLIST"
      badge={<Chip tone={feed === "lost" ? "warn" : "default"}>{feed === "live" ? "LIVE FEED" : feed.toUpperCase()}</Chip>}
      right={<Link href="/markets" className="text-[10px] text-accent hover:underline">EDIT</Link>}
    >
      <div className="divide-y divide-edge/60">
        {settings.watchlist.map((symbol) => {
          const ticker = tickers[symbol];
          const active = symbol === activeSymbol;
          const change = ticker?.change24hAvailable ? ticker.change24hPct : null;
          return (
            <button
              key={symbol}
              onClick={() => setSymbol(symbol)}
              aria-current={active ? "true" : undefined}
              className={cx(
                "w-full flex items-center gap-2 px-3 py-2 text-left text-[11px] hover:bg-panel2/60",
                active && "bg-accent-dim"
              )}
            >
              <span className={cx("num font-medium", active ? "text-accent" : "text-ink")}>{symbol}</span>
              {ticker?.source === "demo" && <Chip>DEMO</Chip>}
              <span className="ml-auto num text-dim">{ticker ? fmtPrice(ticker.price) : "unavailable"}</span>
              <span className={cx("num w-14 text-right", change === null ? "text-dim" : change >= 0 ? "text-up" : "text-dn")}>
                {change === null ? "—" : fmtPct(change, { sign: true })}
              </span>
            </button>
          );
        })}
      </div>
    </Panel>
  );
}
