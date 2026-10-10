"use client";
import { useMemo, useState } from "react";
import { Inbox } from "lucide-react";
import { api } from "@/lib/api";
import { cx, fmtCompactUsd, fmtNum, fmtPct, fmtPrice, fmtUsd, pnlTone } from "@/lib/format";
import { usePoll } from "@/lib/hooks";
import { useMarket } from "@/stores";
import type {
  AccountState, Analysis, OrderBook, RecentTrade, StrategySignal,
} from "@/lib/types";
import { Btn, Chip, EmptyState, Input, KV, Panel, Skeleton } from "./ui";

/* ================= signal panel ================= */

const STATUS_TONE: Record<StrategySignal["status"], "default" | "up" | "dn" | "warn" | "accent"> = {
  WAIT: "default",
  WATCH: "warn",
  LONG_SETUP: "up",
  SHORT_SETUP: "dn",
  INVALIDATED: "default",
};

export function SignalPanel({ analysis, className }: { analysis: Analysis | null; className?: string }) {
  const primary = analysis?.signals.find((s) => s.entry !== null) ?? analysis?.signals[0] ?? null;
  return (
    <Panel title="STRATEGY SIGNAL" className={className} badge={analysis && (
      <span className="text-[9px] text-dim num">EVAL {new Date(analysis.evaluatedAt).toLocaleTimeString("en-GB", { hour12: false })}</span>
    )}>
      {!analysis ? (
        <div className="p-3 space-y-2">
          <Skeleton className="h-4 w-2/3" /><Skeleton className="h-4 w-1/2" /><Skeleton className="h-4 w-3/4" />
        </div>
      ) : (
        <div className="p-3 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="num text-[12px]">{analysis.symbol} · {analysis.timeframe}</span>
            {primary && <Chip tone={STATUS_TONE[primary.status]}>{primary.status.replace("_", " ")}</Chip>}
          </div>

          {/* Explicit directional verdict with the trigger price — the
              BUY/BELOW-PRICE line traders actually read first. */}
          {primary?.status === "LONG_SETUP" ? (
            <div className="flex items-center justify-between rounded border border-up/40 bg-up/10 px-2.5 py-2">
              <span className="text-[13px] font-bold tracking-[0.14em] text-up">BULLISH</span>
              <span className="text-[13px] num font-semibold text-up">
                {primary.entry ? `BUY ${fmtPrice(primary.entry)}` : "BUY on trigger"}
              </span>
            </div>
          ) : primary?.status === "SHORT_SETUP" ? (
            <div className="flex items-center justify-between rounded border border-dn/40 bg-dn/10 px-2.5 py-2">
              <span className="text-[13px] font-bold tracking-[0.14em] text-dn">BEARISH</span>
              <span className="text-[13px] num font-semibold text-dn">
                {primary.entry ? `SELL ${fmtPrice(primary.entry)}` : "SELL on trigger"}
              </span>
            </div>
          ) : (
            <div className="flex items-center justify-between rounded border border-edge bg-panel2/60 px-2.5 py-2">
              <span className="text-[13px] font-bold tracking-[0.14em] text-warn">NEUTRAL</span>
              <span className="text-[11px] text-dim">WAIT — no entry level</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-x-4">
            <KV k="TREND" v={<span className={analysis.trend === "BULLISH" ? "text-up" : analysis.trend === "BEARISH" ? "text-dn" : "text-warn"}>{analysis.trend}</span>} mono={false} />
            <KV k="STRUCTURE" v={analysis.structureSeq.length ? analysis.structureSeq.slice(-4).join(" → ") : "N/A"} />
            <KV k="EMA 20" v={fmtPrice(analysis.emaFast)} />
            <KV k="EMA 50" v={fmtPrice(analysis.emaSlow)} />
          </div>

          {analysis.levels.length > 0 && (
            <div className="border-t border-edge pt-2 space-y-1">
              {analysis.levels.slice(0, 6).map((l, i) => (
                <div key={i} className="flex items-center justify-between text-[11px]">
                  <span className={cx("tracking-wide", l.kind === "support" ? "text-up/80" : "text-dn/80")}>
                    {l.kind === "support" ? "SUPPORT" : "RESISTANCE"}
                  </span>
                  <span className="num text-ink">{fmtPrice(l.price)}</span>
                  <span className="num text-dim text-[10px]">{l.touches}t · {Math.round(l.strength * 100)}%</span>
                </div>
              ))}
            </div>
          )}

          <div className="border-t border-edge pt-2 grid grid-cols-2 gap-x-4">
            <KV k="ENTRY" v={primary?.entry ? fmtPrice(primary.entry) : "—"} />
            <KV k="R:R" v={primary?.rr ? `1 : ${primary.rr.toFixed(1)}` : "—"} />
            <KV k="STOP" v={primary?.stop ? <span className="text-dn">{fmtPrice(primary.stop)}</span> : "—"} mono />
            <KV k="TARGET" v={primary?.target ? <span className="text-up">{fmtPrice(primary.target)}</span> : "—"} mono />
          </div>

          <div className="border-t border-edge pt-2">
            <p className="microlabel mb-1.5">WHY?</p>
            <ol className="space-y-1">
              {(primary?.reasons ?? ["Strategy engine is warming up."]).map((r, i) => (
                <li key={i} className="text-[11px] text-mut leading-snug flex gap-1.5">
                  <span className="num text-dim">{i + 1}.</span>{r}
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </Panel>
  );
}

/* ================= order book ================= */

export function OrderBookPanel({ symbol, className }: { symbol: string; className?: string }) {
  const { data } = usePoll(
    () => api.get<{ orderbook: OrderBook; trades: RecentTrade[] }>(`/api/market/orderbook?symbol=${symbol}`),
    2600,
    { deps: [symbol] }
  );
  const ob = data?.orderbook;
  const maxSize = useMemo(() => {
    if (!ob) return 1;
    return Math.max(...ob.bids.map((l) => l.size), ...ob.asks.map((l) => l.size), 1e-9);
  }, [ob]);

  return (
    <Panel title="ORDER BOOK" className={className} badge={ob && <span className="text-[9px] text-dim num uppercase">{ob.source}</span>}>
      {!ob ? (
        <div className="p-3 space-y-1.5">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-3.5" />)}</div>
      ) : (
        <div className="p-2 text-[10.5px] num">
          <div className="grid grid-cols-3 text-dim text-[9px] px-1 pb-1">
            <span>PRICE</span><span className="text-right">SIZE</span><span className="text-right">DEPTH</span>
          </div>
          {ob.asks.slice(0, 7).reverse().map((l, i) => (
            <div key={i} className="relative grid grid-cols-3 px-1 py-px">
              <span className="absolute inset-y-0 right-0 bg-dn/10" style={{ width: `${(l.size / maxSize) * 100}%` }} />
              <span className="relative text-dn">{fmtPrice(l.price)}</span>
              <span className="relative text-right text-mut">{fmtNum(l.size, l.size < 10 ? 3 : 0)}</span>
              <span className="relative text-right text-dim">{fmtCompactUsd(l.size * l.price)}</span>
            </div>
          ))}
          <div className="my-1 px-1 text-center text-[10px] text-ink border-y border-edge py-0.5">
            {ob.bids[0] && ob.asks[0] ? fmtPrice((ob.bids[0].price + ob.asks[0].price) / 2) : "N/A"}
          </div>
          {ob.bids.slice(0, 7).map((l, i) => (
            <div key={i} className="relative grid grid-cols-3 px-1 py-px">
              <span className="absolute inset-y-0 right-0 bg-up/10" style={{ width: `${(l.size / maxSize) * 100}%` }} />
              <span className="relative text-up">{fmtPrice(l.price)}</span>
              <span className="relative text-right text-mut">{fmtNum(l.size, l.size < 10 ? 3 : 0)}</span>
              <span className="relative text-right text-dim">{fmtCompactUsd(l.size * l.price)}</span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

/* ================= risk calculator ================= */

export function RiskCard({ account, symbol, defaultLevels, className }: {
  account: AccountState | null;
  symbol: string;
  defaultLevels?: { entry?: number | null; stop?: number | null; target?: number | null };
  className?: string;
}) {
  const ticker = useMarket((s) => s.tickers[symbol]);
  const [entry, setEntry] = useState<string>("");
  const [stop, setStop] = useState<string>("");
  const [target, setTarget] = useState<string>("");
  const [qty, setQty] = useState<string>("0.01");
  const [touched, setTouched] = useState(false);
  // AUTO mirrors the current signal's levels; MANUAL is free-form input.
  const [calcMode, setCalcMode] = useState<"auto" | "manual">("auto");

  const e = parseFloat(entry) || (touched ? NaN : defaultLevels?.entry ?? ticker?.price ?? NaN);
  const s = parseFloat(stop) || (touched ? NaN : defaultLevels?.stop ?? NaN);
  const t = parseFloat(target) || (touched ? NaN : defaultLevels?.target ?? NaN);
  const q = parseFloat(qty) || 0;
  const balance = account?.equity ?? 0;

  const switchToManual = () => {
    if (calcMode === "manual") return;
    // Seed the fields with whatever AUTO was showing so nothing is lost.
    setEntry(Number.isFinite(e) ? String(e) : "");
    setStop(Number.isFinite(s) ? String(s) : "");
    setTarget(Number.isFinite(t) ? String(t) : "");
    setTouched(true);
    setCalcMode("manual");
  };
  const switchToAuto = () => {
    setEntry(""); setStop(""); setTarget("");
    setTouched(false);
    setCalcMode("auto");
  };

  const valid = Number.isFinite(e) && Number.isFinite(s) && Number.isFinite(t) && q > 0 && e !== s;
  const riskAmt = valid ? Math.abs(e - s) * q : NaN;
  const rewardAmt = valid ? Math.abs(t - e) * q : NaN;
  const rr = valid && Math.abs(e - s) > 0 ? Math.abs(t - e) / Math.abs(e - s) : NaN;
  const fees = valid ? (e + t) * q * 0.0005 : NaN;
  const net = valid ? rewardAmt - fees : NaN;

  return (
    <Panel title="RISK CALCULATOR" className={className}>
      <div className="p-3 space-y-2">
        <div className="flex items-center gap-2">
          <span className="microlabel">MODE</span>
          <div className="flex border border-edge overflow-hidden">
            <button
              onClick={switchToAuto}
              className={cx("px-2.5 py-0.5 text-[10px] tracking-wide",
                calcMode === "auto" ? "bg-accent text-bg font-semibold" : "text-dim hover:text-ink")}
            >AUTO</button>
            <button
              onClick={switchToManual}
              className={cx("px-2.5 py-0.5 text-[10px] tracking-wide",
                calcMode === "manual" ? "bg-accent text-bg font-semibold" : "text-dim hover:text-ink")}
            >MANUAL</button>
          </div>
          <span className="text-[9.5px] text-dim">
            {calcMode === "auto" ? "mirrors the current signal levels" : "type your own entry / stop / target"}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1"><span className="microlabel">ENTRY</span>
            <Input inputMode="decimal" placeholder={Number.isFinite(e) ? String(e) : "—"}
              value={entry || (calcMode === "auto" && Number.isFinite(e) ? String(e) : "")}
              onChange={(ev) => { setEntry(ev.target.value); setTouched(true); setCalcMode("manual"); }} /></label>
          <label className="space-y-1"><span className="microlabel">QTY</span>
            <Input inputMode="decimal" value={qty} onChange={(ev) => setQty(ev.target.value)} /></label>
          <label className="space-y-1"><span className="microlabel">STOP</span>
            <Input inputMode="decimal" placeholder={Number.isFinite(s) ? String(s) : "—"}
              value={stop || (calcMode === "auto" && Number.isFinite(s) ? String(s) : "")}
              onChange={(ev) => { setStop(ev.target.value); setTouched(true); setCalcMode("manual"); }} /></label>
          <label className="space-y-1"><span className="microlabel">TARGET</span>
            <Input inputMode="decimal" placeholder={Number.isFinite(t) ? String(t) : "—"}
              value={target || (calcMode === "auto" && Number.isFinite(t) ? String(t) : "")}
              onChange={(ev) => { setTarget(ev.target.value); setTouched(true); setCalcMode("manual"); }} /></label>
        </div>
        <div className="border-t border-edge pt-2">
          {valid ? (
            <>
              <KV k="RISK AMOUNT" v={<span className="text-dn">{fmtUsd(riskAmt)}</span>} />
              <KV k="RISK % OF EQUITY" v={balance > 0 ? fmtPct((riskAmt / balance) * 100) : "N/A"} />
              <KV k="POTENTIAL PROFIT" v={<span className="text-up">{fmtUsd(rewardAmt)}</span>} />
              <KV k="R : R" v={`1 : ${rr.toFixed(2)}`} />
              <KV k="EST. FEES (0.05% ×2)" v={fmtUsd(fees)} />
              <KV k="EST. NET RESULT" v={<span className="text-up">{fmtUsd(net)}</span>} />
              <p className="text-[9px] text-dim mt-1.5 leading-snug">
                Calculated estimate — not an exchange-confirmed value.
              </p>
            </>
          ) : (
            <p className="text-[11px] text-dim py-2">
              Enter entry, stop and target (or wait for a signal with levels) to compute risk.
            </p>
          )}
        </div>
      </div>
    </Panel>
  );
}

/* ================= positions table ================= */

export function PositionsTable({
  account, onClose, source, className,
}: {
  account: AccountState | null;
  onClose?: (symbol: string, positionId: string) => void;
  source: "paper" | "all";
  className?: string;
}) {
  const positions = account?.positions.filter((p) => source === "all" || p.source === source) ?? [];
  return (
    <Panel title={source === "paper" ? "PAPER POSITIONS" : "POSITIONS"} className={className}
      badge={<span className="text-[9px] num text-dim">{positions.length} OPEN</span>}>
      {positions.length === 0 ? (
        <EmptyState icon={<Inbox size={18} />} title="No open positions"
          hint={source === "all" ? "Connect CoinDCX or switch to PAPER mode to open simulated positions." : "Paper positions appear here when you place simulated orders."} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px] sticky-header table-row-hover">
            <thead>
              <tr className="text-left microlabel border-b border-edge">
                <th className="px-3 py-1.5 font-medium">SYMBOL</th>
                <th className="px-2 py-1.5 font-medium">SIDE</th>
                <th className="px-2 py-1.5 font-medium text-right">QTY</th>
                <th className="px-2 py-1.5 font-medium text-right">ENTRY</th>
                <th className="px-2 py-1.5 font-medium text-right">MARK</th>
                <th className="px-2 py-1.5 font-medium text-right">U. P&L</th>
                <th className="px-2 py-1.5 font-medium">SRC</th>
                {onClose && <th className="px-2 py-1.5" />}
              </tr>
            </thead>
            <tbody>
              {positions.map((p, i) => {
                const tone = pnlTone(p.upl);
                return (
                  <tr key={i} className="border-b border-edge/50 hover:bg-panel2/60">
                    <td className="px-3 py-1.5 num">{p.symbol}</td>
                    <td className={cx("px-2 py-1.5", p.side === "long" ? "text-up" : "text-dn")}>{p.side.toUpperCase()}</td>
                    <td className="px-2 py-1.5 num text-right">{fmtNum(p.qty, p.qty < 1 ? 3 : 2)}</td>
                    <td className="px-2 py-1.5 num text-right">{fmtPrice(p.entry)}</td>
                    <td className="px-2 py-1.5 num text-right">{fmtPrice(p.mark)}</td>
                    <td className={cx("px-2 py-1.5 num text-right", tone === "pos" ? "text-up" : tone === "neg" ? "text-dn" : "")}>
                      {p.upl >= 0 ? "+" : "-"}${Math.abs(p.upl).toFixed(2)}
                    </td>
                    <td className="px-2 py-1.5"><Chip>{p.source.toUpperCase()}</Chip></td>
                    {onClose && (
                      <td className="px-2 py-1.5 text-right">
                        {p.source === "paper" && (
                          <Btn variant="danger" onClick={() => onClose(p.symbol, p.symbol)}>CLOSE</Btn>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
