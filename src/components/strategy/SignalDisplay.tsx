"use client";
import { useDisplayCurrency } from "@/lib/useDisplayCurrency";
import { TrendingUp, TrendingDown, Minus, Activity } from "lucide-react";
import { Chip, KV, PremiumPanel, Skeleton } from "@/components/ui";
import { fmtPrice } from "@/lib/format";
import type { SignalState } from "@/lib/strategy/v2/types";
import type { StrategySignal } from "@/lib/types";

const STATUS_TONE: Record<StrategySignal["status"], "default" | "up" | "dn" | "warn" | "accent"> = {
  WAIT: "default",
  WATCH: "warn",
  LONG_SETUP: "up",
  SHORT_SETUP: "dn",
  INVALIDATED: "default",
};

export function SignalDisplay({ state, className }: { state: SignalState | null; className?: string }) {
  useDisplayCurrency();
  if (!state || !state.signal) {
    return (
      <PremiumPanel title="CHANDELIER + DONCHIAN" className={className} elevation={2}>
        <div className="p-3 space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </PremiumPanel>
    );
  }

  const signal = state.signal;
  const haColor = state.haColor;
  const donchianTrend = state.donchianState.trend;
  const chandelierTrend = state.chandelierState.trend;

  return (
    <PremiumPanel
      title="CHANDELIER + DONCHIAN"
      className={className}
      badge={<Chip tone={STATUS_TONE[signal.status]}>{signal.status.replace("_", " ")}</Chip>}
      elevation={2}
    >
      <div className="p-3 space-y-3">
        {/* Main signal verdict */}
        {signal.status === "LONG_SETUP" ? (
          <div className="flex items-center justify-between rounded border border-up/40 bg-up/10 px-3 py-2.5">
            <span className="flex items-center gap-2 text-[13px] font-bold tracking-[0.14em] text-up">
              <TrendingUp size={16} /> BULLISH
            </span>
            <span className="text-[13px] num font-semibold text-up">
              {signal.entry ? `BUY ${fmtPrice(signal.entry)}` : "BUY on trigger"}
            </span>
          </div>
        ) : signal.status === "SHORT_SETUP" ? (
          <div className="flex items-center justify-between rounded border border-dn/40 bg-dn/10 px-3 py-2.5">
            <span className="flex items-center gap-2 text-[13px] font-bold tracking-[0.14em] text-dn">
              <TrendingDown size={16} /> BEARISH
            </span>
            <span className="text-[13px] num font-semibold text-dn">
              {signal.entry ? `SELL ${fmtPrice(signal.entry)}` : "SELL on trigger"}
            </span>
          </div>
        ) : (
          <div className="flex items-center justify-between rounded border border-edge bg-panel2/60 px-3 py-2.5">
            <span className="flex items-center gap-2 text-[13px] font-bold tracking-[0.14em] text-warn">
              <Minus size={16} /> NEUTRAL
            </span>
            <span className="text-[11px] text-dim">WAIT — no entry level</span>
          </div>
        )}

        {/* Indicator state grid */}
        <div className="grid grid-cols-3 gap-2">
          <IndicatorCard
            label="HEIKIN ASHI"
            value={haColor ? haColor.toUpperCase() : "—"}
            tone={haColor === "green" ? "up" : haColor === "red" ? "dn" : "flat"}
            icon={<Activity size={12} />}
          />
          <IndicatorCard
            label="DONCHIAN RIBBON"
            value={donchianTrend === "neutral" ? "MIXED" : donchianTrend.toUpperCase()}
            tone={donchianTrend === "green" ? "up" : donchianTrend === "red" ? "dn" : "flat"}
            icon={<Activity size={12} />}
          />
          <IndicatorCard
            label="CHANDELIER EXIT"
            value={chandelierTrend ? chandelierTrend.toUpperCase() : "—"}
            tone={chandelierTrend === "long" ? "up" : chandelierTrend === "short" ? "dn" : "flat"}
            icon={<Activity size={12} />}
          />
        </div>

        {/* Donchian periods detail */}
        {state.donchianState.periods && Object.keys(state.donchianState.periods).length > 0 && (
          <div className="border-t border-edge pt-2 space-y-1">
            <p className="microlabel">DONCHIAN PERIODS</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              {Object.entries(state.donchianState.periods).map(([period, data]) => (
                <div key={period} className="flex items-center justify-between text-[10px] num">
                  <span className="text-dim">{period}p</span>
                  <span className="text-mut">
                    {Number.isFinite(data.upper) ? fmtPrice(data.upper) : "—"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Chandelier levels */}
        {(state.chandelierState.longStop !== null || state.chandelierState.shortStop !== null) && (
          <div className="border-t border-edge pt-2 space-y-1">
            <p className="microlabel">CHANDELIER TRAILING STOP</p>
            {state.chandelierState.longStop !== null && (
              <KV k="LONG STOP" v={<span className="text-up">{fmtPrice(state.chandelierState.longStop)}</span>} />
            )}
            {state.chandelierState.shortStop !== null && (
              <KV k="SHORT STOP" v={<span className="text-dn">{fmtPrice(state.chandelierState.shortStop)}</span>} />
            )}
          </div>
        )}

        {/* Entry / Stop / Target */}
        <div className="border-t border-edge pt-2 grid grid-cols-3 gap-2 text-[10px] num">
          <div className="text-center">
            <p className="microlabel">ENTRY</p>
            <p className="text-accent text-[12px] mt-0.5">{signal.entry ? fmtPrice(signal.entry) : "—"}</p>
          </div>
          <div className="text-center">
            <p className="microlabel">STOP</p>
            <p className="text-dn text-[12px] mt-0.5">{signal.stop ? fmtPrice(signal.stop) : "—"}</p>
          </div>
          <div className="text-center">
            <p className="microlabel">TARGET</p>
            <p className="text-up text-[12px] mt-0.5">{signal.target ? fmtPrice(signal.target) : "—"}</p>
          </div>
        </div>

        {/* R:R */}
        {signal.rr !== null && (
          <div className="flex items-center justify-between border-t border-edge pt-2">
            <span className="microlabel">RISK : REWARD</span>
            <span className="num text-[12px] text-ink">1 : {signal.rr.toFixed(2)}</span>
          </div>
        )}

        {/* Reasons */}
        <div className="border-t border-edge pt-2">
          <p className="microlabel mb-1.5">WHY?</p>
          <ol className="space-y-1">
            {signal.reasons.map((r, i) => (
              <li key={i} className="text-[11px] text-mut leading-snug flex gap-1.5">
                <span className="num text-dim">{i + 1}.</span>{r}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </PremiumPanel>
  );
}

function IndicatorCard({ label, value, tone, icon }: {
  label: string;
  value: string;
  tone: "up" | "dn" | "flat";
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded border border-edge bg-panel2/60 px-2 py-2">
      <div className="flex items-center gap-1 text-dim mb-1">
        {icon}
        <span className="text-[9px] tracking-wide uppercase">{label}</span>
      </div>
      <p className={`num text-[12px] font-semibold ${
        tone === "up" ? "text-up" : tone === "dn" ? "text-dn" : "text-ink"
      }`}>
        {value}
      </p>
    </div>
  );
}