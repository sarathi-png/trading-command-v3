"use client";
import { useDisplayCurrency } from "@/lib/useDisplayCurrency";
import { History } from "lucide-react";
import { Chip, EmptyState, HelpTip, PremiumPanel, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { cx, fmtDateTime, fmtPrice } from "@/lib/format";
import { usePoll } from "@/lib/hooks";
import type { SetupOutcome } from "@/lib/strategy/v2/outcomes";

interface EvaluatedSetup {
  id: string;
  symbol: string;
  timeframe: string;
  strategy: string;
  status: string;
  entry: number | null;
  stop: number | null;
  target: number | null;
  createdAt: string;
  outcome: SetupOutcome;
}

interface Response {
  setups: EvaluatedSetup[];
  summary: {
    recorded: number; evaluated: number; unresolved: number;
    targetHits: number; stopHits: number; open: number;
    hitRate: number | null; avgResolvedR: number | null;
    avgMfeR: number | null; avgMaeR: number | null;
  } | null;
  error?: string;
}

const RESOLUTION_TONE: Record<SetupOutcome["resolution"], "up" | "dn" | "accent" | "default"> = {
  target: "up",
  stop: "dn",
  open: "accent",
  unknown: "default",
};

const RESOLUTION_LABEL: Record<SetupOutcome["resolution"], string> = {
  target: "TARGET HIT",
  stop: "STOP HIT",
  open: "STILL OPEN",
  unknown: "NOT EVALUATED",
};

/**
 * Signal accountability ledger.
 *
 * The unique part of this workspace: every recorded setup is re-evaluated
 * against candle history, so the strategy is measured by what its published
 * plan actually did — not by the last screenshot that looked convincing.
 */
export function SignalAccountability({ className, limit = 25 }: { className?: string; limit?: number }) {
  useDisplayCurrency();
  const { data, error, loading } = usePoll<Response>(
    () => api.get<Response>(`/api/signals/outcomes?limit=${limit}`),
    60000
  );

  const summary = data?.summary ?? null;
  const setups = data?.setups ?? [];

  return (
    <PremiumPanel
      title="SIGNAL ACCOUNTABILITY"
      className={className}
      badge={<Chip tone="accent"><History size={11} /> WHAT HAPPENED NEXT</Chip>}
      right={<HelpTip topic="mfe" align="right" />}
    >
      {error ? (
        <p className="p-4 text-[11px] text-warn">{error}</p>
      ) : !data && loading ? (
        <div className="p-4 space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-5" />)}</div>
      ) : setups.length === 0 ? (
        <EmptyState
          icon={<History size={18} />}
          title="No directional setups recorded yet"
          hint="When the engine records a LONG or SHORT setup, this ledger shows whether the published stop or target was reached, and how far price travelled in R."
        />
      ) : (
        <div className="divide-y divide-edge/60">
          <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-edge/60">
            <Stat label="RESOLVED" value={summary ? `${summary.targetHits + summary.stopHits}/${summary.evaluated}` : "—"}
              sub="targets + stops" help="rMultiple" />
            <Stat label="TARGET HITS" value={summary ? String(summary.targetHits) : "—"} sub="reached the plan" />
            <Stat label="STOP HITS" value={summary ? String(summary.stopHits) : "—"} sub="failed the plan" />
            <Stat label="AVG RESULT" value={summary?.avgResolvedR !== null && summary?.avgResolvedR !== undefined ? `${summary.avgResolvedR > 0 ? "+" : ""}${summary.avgResolvedR}R` : "—"}
              sub="per resolved setup" help="expectancy" />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-edge/60">
            <Stat label="AVG MAX FAVOURABLE" value={summary?.avgMfeR !== null && summary?.avgMfeR !== undefined ? `${summary.avgMfeR}R` : "—"} sub="how far it ran for you" help="mfe" />
            <Stat label="AVG MAX ADVERSE" value={summary?.avgMaeR !== null && summary?.avgMaeR !== undefined ? `${summary.avgMaeR}R` : "—"} sub="how far it went against you" help="mae" />
            <Stat label="STILL OPEN" value={summary ? String(summary.open) : "—"} sub="neither level reached" />
            <Stat label="NOT EVALUATED" value={summary ? String(summary.unresolved) : "—"} sub="no candle history yet" />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-[11px] table-row-hover">
              <thead>
                <tr className="text-left microlabel border-b border-edge">
                  <th className="px-3 py-1.5 font-medium">RECORDED</th>
                  <th className="px-2 py-1.5 font-medium">SETUP</th>
                  <th className="px-2 py-1.5 font-medium">ENTRY / STOP</th>
                  <th className="px-2 py-1.5 font-medium">OUTCOME</th>
                  <th className="px-2 py-1.5 font-medium text-right">R NOW</th>
                  <th className="px-2 py-1.5 font-medium text-right">MFE / MAE</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-edge/40">
                {setups.map((s) => {
                  const o = s.outcome;
                  return (
                    <tr key={s.id}>
                      <td className="px-3 py-1.5 text-dim num whitespace-nowrap">{fmtDateTime(new Date(s.createdAt).getTime())}</td>
                      <td className="px-2 py-1.5">
                        <span className="num">{s.symbol}</span>
                        <span className="text-dim"> · {s.timeframe} · </span>
                        <span className={s.status === "LONG_SETUP" ? "text-up" : "text-dn"}>{s.status === "LONG_SETUP" ? "LONG" : "SHORT"}</span>
                      </td>
                      <td className="px-2 py-1.5 num whitespace-nowrap">
                        {fmtPrice(s.entry)} <span className="text-dim">/</span> <span className="text-dn">{fmtPrice(s.stop)}</span>
                      </td>
                      <td className="px-2 py-1.5">
                        <Chip tone={RESOLUTION_TONE[o.resolution]}>{RESOLUTION_LABEL[o.resolution]}</Chip>
                        {o.resolution === "unknown" && o.reason && (
                          <span className="block text-[10px] text-dim mt-0.5">{o.reason}</span>
                        )}
                        {o.barsToResolution !== null && (
                          <span className="block text-[10px] text-dim mt-0.5">after {o.barsToResolution} candles</span>
                        )}
                      </td>
                      <td className={cx("px-2 py-1.5 text-right num",
                        o.currentR === null ? "text-dim" : o.currentR > 0 ? "text-up" : o.currentR < 0 ? "text-dn" : "text-mut")}>
                        {o.currentR === null ? "—" : `${o.currentR > 0 ? "+" : ""}${o.currentR.toFixed(2)}R`}
                      </td>
                      <td className="px-2 py-1.5 text-right num text-mut whitespace-nowrap">
                        {o.mfeR === null ? "—" : `${o.mfeR.toFixed(2)}R`} <span className="text-dim">/</span> {o.maeR === null ? "—" : `${o.maeR.toFixed(2)}R`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="px-3 py-2 text-[10px] text-dim leading-snug">
            Outcomes are recomputed from candle history for the published plan. They measure the signal, not your executed trades,
            and old setups may predate the candle history the data source keeps.
          </p>
        </div>
      )}
    </PremiumPanel>
  );
}

function Stat({ label, value, sub, help }: { label: string; value: string; sub: string; help?: string }) {
  return (
    <div className="px-4 py-3 min-w-0">
      <p className="microlabel inline-flex items-center gap-1.5 mb-1">{label}{help && <HelpTip topic={help} />}</p>
      <p className="num text-[15px] text-ink">{value}</p>
      <p className="text-[10px] text-dim num truncate">{sub}</p>
    </div>
  );
}
