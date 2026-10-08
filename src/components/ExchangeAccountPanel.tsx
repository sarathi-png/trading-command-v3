"use client";
/**
 * Exchange account panel — live CoinDCX balances and realized trading record.
 *
 * Reads /api/exchange/summary, which derives figures from the private CoinDCX
 * endpoints (futures wallet, wallet transactions, per-pair trades, position
 * transactions). Realized P&L is reported from the venue's own position
 * transactions when available (`realizedPnlUsd`, `null` when it could not be
 * read — never zero-by-default); the per-trade table is FIFO-matched from fills
 * and supplies the best/worst trade detail.
 */
import { Wallet, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { Chip, EmptyState, MetricCard, Panel, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { cx, fmtDateTime, fmtUsd, pnlTone } from "@/lib/format";
import { usePoll } from "@/lib/hooks";
import { useApp } from "@/stores";

interface Trade {
  symbol: string;
  side: "long" | "short";
  qty: number;
  entry: number;
  exit: number;
  pnlUsd: number;
  at: string;
}

interface ExchangeSummary {
  available: boolean;
  error?: string;
  balanceUsd: number;
  balanceInr: number;
  usdInrRate: number;
  depositsUsd: number;
  withdrawalsUsd: number;
  realizedPnlUsd: number;
  realizedPnlInr: number;
  derivedPnlUsd: number;
  commissionUsd: number;
  fundingUsd: number;
  liquidationFeesUsd: number;
  balanceAfterFlowsUsd: number;
  tradeCount: number;
  winRate: number | null;
  bestTradeUsd: number | null;
  worstTradeUsd: number | null;
  avgTradeUsd: number | null;
  fillCount: number;
  recentTrades: Trade[];
  topSymbols: { symbol: string; pnlUsd: number; trades: number }[];
}

export default function ExchangeAccountPanel() {
  const { settings } = useApp();
  const { data, loading } = usePoll(
    () => api.get<ExchangeSummary>("/api/exchange/summary"),
    30000
  );

  const s = data;
  const tone = (v: number) =>
    pnlTone(v) === "pos" ? "up" : pnlTone(v) === "neg" ? "dn" : "flat";

  return (
    <Panel
      title="EXCHANGE ACCOUNT · COINDCX"
      right={
        s ? (
          <Chip tone={s.available ? "up" : "warn"}>
            {s.available ? `LIVE · RATE ${s.usdInrRate}` : "NOT CONNECTED"}
          </Chip>
        ) : undefined
      }
    >
      {loading && !s ? (
        <div className="p-3 space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-8" />
          ))}
        </div>
      ) : !s || !s.available ? (
        <EmptyState
          icon={<Wallet size={18} />}
          title="Exchange account unavailable"
          hint={s?.error ?? "Set COINDCX_API_KEY and COINDCX_API_SECRET in the deployment environment to see live balances and history."}
        />
      ) : (
        <div className="p-3 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2">
            <MetricCard label="BALANCE (USD)" value={fmtUsd(s.balanceUsd)} sub="SPOT WALLET" />
            <MetricCard
              label="BALANCE (INR)"
              value={`₹${s.balanceInr.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`}
              sub={`@ ₹${s.usdInrRate}/USD`}
            />
            <MetricCard
              label="TOTAL DEPOSITED"
              value={fmtUsd(s.depositsUsd)}
              sub={`WITHDRAWN ${fmtUsd(s.withdrawalsUsd)}`}
            />
            <MetricCard
              label="REALIZED P&L"
              value={fmtUsd(s.realizedPnlUsd, { sign: true })}
              tone={tone(s.realizedPnlUsd)}
              sub={`₹${s.realizedPnlInr.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`}
            />
            <MetricCard
              label="BEST TRADE"
              value={s.bestTradeUsd === null ? "—" : fmtUsd(s.bestTradeUsd, { sign: true })}
              tone={s.bestTradeUsd === null ? "flat" : tone(s.bestTradeUsd)}
              sub={s.avgTradeUsd === null ? "—" : `AVG ${fmtUsd(s.avgTradeUsd, { sign: true })}`}
            />
            <MetricCard
              label="WORST TRADE"
              value={s.worstTradeUsd === null ? "—" : fmtUsd(s.worstTradeUsd, { sign: true })}
              tone={s.worstTradeUsd === null ? "flat" : tone(s.worstTradeUsd)}
              sub={s.winRate === null ? "—" : `WIN ${s.winRate}%`}
            />
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-dim border-t border-edge pt-2">
            <span>{s.tradeCount} round trips · {s.fillCount} fills</span>
            <span>Commission {fmtUsd(s.commissionUsd)}</span>
            <span>Funding {fmtUsd(s.fundingUsd)}</span>
            <span>Liquidation fees {fmtUsd(s.liquidationFeesUsd)}</span>
            <span
              className={cx(
                "num",
                Math.abs(s.balanceAfterFlowsUsd - s.balanceUsd) < 0.01 ? "text-up" : "text-warn"
              )}
            >
              reconcile: deposits + P&amp;L − fees = {fmtUsd(s.balanceAfterFlowsUsd, { sign: true })}
            </span>
          </div>
          {s.topSymbols.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {s.topSymbols.slice(0, 6).map((t) => (
                <Chip
                  key={t.symbol}
                  tone={pnlTone(t.pnlUsd) === "pos" ? "up" : pnlTone(t.pnlUsd) === "neg" ? "dn" : "default"}
                >
                  {t.symbol} {fmtUsd(t.pnlUsd, { sign: true })} · {t.trades}
                </Chip>
              ))}
            </div>
          )}

          <div>
            <p className="microlabel mb-1.5">RECENT ROUND TRIPS</p>
            {s.recentTrades.length === 0 ? (
              <p className="text-[11px] text-dim py-2">No closed round trips yet.</p>
            ) : (
              <div className="overflow-x-auto max-h-[240px] overflow-y-auto">
                <table className="w-full text-[11px]">
                  <thead className="sticky top-0 bg-panel">
                    <tr className="text-left microlabel border-b border-edge">
                      <th className="px-2 py-1.5 font-medium">TIME</th>
                      <th className="px-2 py-1.5 font-medium">SYMBOL</th>
                      <th className="px-2 py-1.5 font-medium">SIDE</th>
                      <th className="px-2 py-1.5 font-medium text-right">QTY</th>
                      <th className="px-2 py-1.5 font-medium text-right">ENTRY → EXIT</th>
                      <th className="px-2 py-1.5 font-medium text-right">P&L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.recentTrades.map((t, i) => (
                      <tr key={`${t.symbol}-${t.at}-${i}`} className="border-b border-edge/50">
                        <td className="px-2 py-1.5 num text-dim">
                          {fmtDateTime(Date.parse(t.at), settings.timezone)}
                        </td>
                        <td className="px-2 py-1.5 num">{t.symbol}</td>
                        <td className="px-2 py-1.5">
                          <span className={cx("flex items-center gap-1", t.side === "long" ? "text-up" : "text-dn")}>
                            {t.side === "long" ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
                            {t.side.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 num text-right">{t.qty}</td>
                        <td className="px-2 py-1.5 num text-right text-mut">{t.entry} → {t.exit}</td>
                        <td
                          className={cx(
                            "px-2 py-1.5 num text-right",
                            tone(t.pnlUsd) === "up" ? "text-up" : tone(t.pnlUsd) === "dn" ? "text-dn" : "text-mut"
                          )}
                        >
                          {fmtUsd(t.pnlUsd, { sign: true })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}