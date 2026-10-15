"use client";
import { useDisplayCurrency } from "@/lib/useDisplayCurrency";
import { useState } from "react";
import { ArrowDownRight, ArrowUpRight, RefreshCw, Send } from "lucide-react";
import { api } from "@/lib/api";
import { usePoll } from "@/lib/hooks";
import { useApp } from "@/stores";
import { useRouter } from "next/navigation";
import { fmtPct, fmtPrice } from "@/lib/format";
import type { MoverRow, MoversReport } from "@/lib/market/movers";
import { Btn, Chip, Panel, Skeleton } from "./ui";
export default function MarketMovers() {
  const { settings } = useApp();
  const { data, error, refresh, loading } = usePoll(
    () => api.get<MoversReport>("/api/market/movers"),
    60_000,
    { deps: [settings.dataSource] },
  );
  const [message, setMessage] = useState(""),
    [sharing, setSharing] = useState(false);
  async function share() {
    setSharing(true);
    try {
      const result = await api.post<{ note: string }>("/api/market/movers", {});
      setMessage(result.note);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Share failed");
    } finally {
      setSharing(false);
    }
  }
  return (
    <div className="space-y-4" data-testid="market-movers">
      <div className="market-hero">
        <div>
          <p className="microlabel">MARKET PULSE / 24 HOURS</p>
          <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight mt-2">
            Follow the move.
            <br />
            <span className="text-mut">Verify the setup.</span>
          </h2>
          <p className="text-mut text-[12px] mt-3 max-w-xl">
            Up to 10 gainers and 10 losers, ranked independently of their
            5-minute trade setup. A rise is not automatically a buy; a fall is
            not automatically a short.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 items-start">
          <Btn onClick={refresh} disabled={loading}>
            <RefreshCw size={13} /> REFRESH
          </Btn>
          <Btn
            variant="primary"
            onClick={() => void share()}
            disabled={sharing || !data || !!error}
          >
            <Send size={13} /> SHARE SNAPSHOT
          </Btn>
        </div>
      </div>
      {(error || message) && (
        <p role="status" className="text-warn text-[12px]">
          {error || message}
          {error && data ? " · Previous snapshot retained, not current." : ""}
        </p>
      )}
      {data && (
        <div className="flex flex-wrap gap-2 items-center text-[11px] text-mut">
          <Chip tone={data.source === "demo" ? "warn" : "up"}>
            {data.source === "demo" ? "DEMO / SIMULATED" : "LIVE MARKET DATA"}
          </Chip>
          <span>
            {data.scope} {data.universe} instruments received · {data.excluded}{" "}
            excluded as stale, missing change, invalid or zero-volume.
          </span>
          <span>
            Snapshot {new Date(data.asOf).toLocaleTimeString()} · refresh ~60s
          </span>
        </div>
      )}
      {!data && !error ? (
        <div className="grid md:grid-cols-2 gap-4">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      ) : (
        <div className="grid xl:grid-cols-2 gap-4">
          <MoverList rows={data?.gainers ?? []} up />
          <MoverList rows={data?.losers ?? []} up={false} />
        </div>
      )}
      <p className="text-[11px] text-dim">
        Candidate ≠ advice or an order. Setup requires raw and Heikin-Ashi
        agreement, Chandelier/Donchian context, trend strength, VWAP/RSI/EMA
        confirmation and a valid invalidation level. Costs, spread, liquidity
        and funding still need review. “Sell-side” means a futures short
        candidate, not an instruction to sell holdings. No measured win rate is
        claimed.
      </p>
    </div>
  );
}
function MoverList({ rows, up }: { rows: MoverRow[]; up: boolean }) {
  useDisplayCurrency();
  const { setSymbol, setTimeframe } = useApp();
  const router = useRouter();
  return (
    <Panel
      title={up ? "TOP 10 GAINERS" : "TOP 10 LOSERS"}
      badge={
        <Chip tone={up ? "up" : "danger"}>
          {up ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}24H
        </Chip>
      }
    >
      {!rows.length ? (
        <p className="p-4 text-mut text-[12px]">
          No qualifying {up ? "positive" : "negative"} movers in the available
          universe. The list is not padded with unrelated coins.
        </p>
      ) : (
        <ol className="divide-y divide-edge">
          {rows.map((row, i) => (
            <li key={row.ticker.symbol} className="mover-row p-4 space-y-2">
              <div className="flex gap-3 items-center">
                <span className="num text-dim text-[11px] w-4">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <button
                  className="text-left flex-1 min-w-0 hover:text-accent"
                  onClick={() => {
                    setSymbol(row.ticker.symbol);
                    setTimeframe("5m");
                    router.push("/chart");
                  }}
                >
                  <strong className="num text-[13px]">
                    {row.ticker.symbol}
                  </strong>
                  <span className="block num text-dim text-[11px]">
                    {fmtPrice(row.ticker.price)}
                  </span>
                </button>
                <strong className={`num ${up ? "text-up" : "text-dn"}`}>
                  {fmtPct(row.ticker.change24hPct)}
                </strong>
              </div>
              <div className="pl-7">
                <Chip
                  tone={
                    row.assessment.stance === "BUY-SIDE CANDIDATE"
                      ? "up"
                      : row.assessment.stance === "SELL-SIDE CANDIDATE"
                        ? "danger"
                        : "default"
                  }
                >
                  {row.assessment.stance}
                </Chip>
                <details className="mt-2 text-[11px] text-mut">
                  <summary className="cursor-pointer">Why / why not?</summary>
                  <ul className="pt-2 space-y-1">
                    {row.assessment.reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                  <p className="mt-2 num">
                    Decision close:{" "}
                    {row.assessment.entry === null
                      ? "n/a"
                      : fmtPrice(row.assessment.entry)}{" "}
                    · Invalid if:{" "}
                    {row.assessment.stop === null
                      ? "not qualified"
                      : fmtPrice(row.assessment.stop)}
                  </p>
                  {row.assessment.barTime && (
                    <p>
                      Closed bar{" "}
                      {new Date(row.assessment.barTime).toLocaleString()}
                    </p>
                  )}
                </details>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
