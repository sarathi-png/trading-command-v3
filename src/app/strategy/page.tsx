"use client";
import { useState } from "react";
import { Zap } from "lucide-react";
import { Chip, EmptyState, Input, PageHeader, Panel, Skeleton, Toggle } from "@/components/ui";
import { api } from "@/lib/api";
import { cx, fmtDateTime, fmtPrice } from "@/lib/format";
import { usePoll } from "@/lib/hooks";
import { useApp } from "@/stores";
import type { Analysis } from "@/lib/types";
import { ChandelierDonchianPanel } from "@/components/strategy/ChandelierDonchianPanel";
import { SignalAccountability } from "@/components/strategy/SignalAccountability";

interface QuantView {
  confluence: {
    score: number; direction: "LONG" | "SHORT" | "NEUTRAL";
    components: { trend: number; zone: number; momentum: number; volume: number };
    reasons: string[]; atr: number | null;
  };
  htfSource: string;
  regime: "trend" | "range";
  metaProba: number | null;
  metaGate: { passed: boolean; reason: string };
  features: number[] | null;
  featureColumns: string[] | null;
}

function ComponentBar({ label, value }: { label: string; value: number }) {
  const pct = Math.min(50, Math.abs(value) * 50);
  return (
    <div className="flex items-center gap-2 text-[10px]">
      <span className="w-16 text-mut">{label}</span>
      <div className="relative flex-1 h-1.5 rounded bg-white/10 overflow-hidden">
        <div
          className={cx("absolute top-0 h-full", value >= 0 ? "bg-up" : "bg-dn")}
          style={value >= 0 ? { left: "50%", width: `${pct}%` } : { right: "50%", width: `${pct}%` }}
        />
      </div>
      <span className={cx("num w-12 text-right", value >= 0 ? "text-up" : "text-dn")}>
        {value >= 0 ? "+" : ""}{value.toFixed(2)}
      </span>
    </div>
  );
}

const STRATEGY_META: Record<string, { name: string; desc: string }> = {
  trend: { name: "Trend Pullback", desc: "EMA-aligned continuation after a pullback to the fast EMA." },
  breakout: { name: "Level Breakout", desc: "Closed candles beyond the strongest detected S/R clusters." },
  sr: { name: "Support / Resistance Reaction", desc: "Reactions at strong levels filtered by trend." },
};

export default function StrategyPage() {
  const { activeSymbol, timeframe, settings, patchSettings } = useApp();
  const { data } = usePoll(
    () => api.get<{ analysis: Analysis; quant: QuantView | null }>(`/api/strategy/evaluate?symbol=${activeSymbol}&timeframe=${timeframe}`),
    20000, { deps: [activeSymbol, timeframe] }
  );
  const analysis = data?.analysis ?? null;
  const quant = data?.quant ?? null;

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-[1500px] mx-auto">
      <PageHeader crumb="RESEARCH / STRATEGY" title="Strategy engine"
        description={`Evaluating ${activeSymbol} · ${timeframe} on closed candles only. Signals are setups with a published entry, stop and target — never predictions.`}
        actions={<Chip tone="accent"><Zap size={11} /> ENGINE {analysis ? "ONLINE" : "WARMING UP"}</Chip>} />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {(["trend", "breakout", "sr"] as const).map((id) => {
          const sig = analysis?.signals.find((s) => s.strategy === id) ?? null;
          const meta = STRATEGY_META[id];
          const enabled = settings.strategiesEnabled[id] !== false;
          return (
            <Panel key={id} title={meta.name.toUpperCase()} right={
              <Toggle checked={enabled} label={`Enable ${meta.name}`}
                onChange={(v) => void patchSettings({ strategiesEnabled: { ...settings.strategiesEnabled, [id]: v } })} />
            }>
              <div className="p-3 space-y-2 min-h-44">
                <p className="text-[10px] text-dim leading-snug">{meta.desc}</p>
                {!enabled ? (
                  <p className="text-[11px] text-dim">Strategy disabled.</p>
                ) : !sig ? (
                  <Skeleton className="h-16" />
                ) : (
                  <>
                    <Chip tone={sig.status === "LONG_SETUP" ? "up" : sig.status === "SHORT_SETUP" ? "dn" : sig.status === "WATCH" ? "warn" : "default"}>
                      {sig.status.replace("_", " ")}
                    </Chip>
                    <ul className="space-y-1">
                      {sig.reasons.map((r, i) => (
                        <li key={i} className="text-[10.5px] text-mut leading-snug flex gap-1.5">
                          <span className="num text-dim">{i + 1}.</span>{r}
                        </li>
                      ))}
                    </ul>
                    {sig.entry !== null && (
                      <div className="grid grid-cols-3 gap-1 text-[10px] num border-t border-edge pt-2">
                        <span>E <span className="text-accent">{fmtPrice(sig.entry)}</span></span>
                        <span>S <span className="text-dn">{fmtPrice(sig.stop)}</span></span>
                        <span>T <span className="text-up">{fmtPrice(sig.target)}</span></span>
                      </div>
                    )}
                  </>
                )}
              </div>
            </Panel>
          );
        })}
      </div>

      {quant && (
        <Panel title="QUANT CONFLUENCE · PYTHON PORT" right={
          <Chip tone={quant.metaGate.passed ? "up" : "dn"}>
            META {quant.metaProba === null ? "n/a" : quant.metaProba.toFixed(3)}
          </Chip>
        }>
          <div className="p-3 space-y-2.5">
            <div className="flex items-center gap-2 flex-wrap">
              <Chip tone={quant.confluence.direction === "LONG" ? "up" : quant.confluence.direction === "SHORT" ? "dn" : "default"}>
                {quant.confluence.direction} · {quant.confluence.score.toFixed(1)}
              </Chip>
              <Chip tone={quant.regime === "trend" ? "accent" : "default"}>REGIME {quant.regime.toUpperCase()}</Chip>
              <span className="text-[9.5px] text-dim">HTF source: {quant.htfSource}</span>
            </div>
            <div className="space-y-1.5">
              <ComponentBar label="trend" value={quant.confluence.components.trend} />
              <ComponentBar label="zone" value={quant.confluence.components.zone} />
              <ComponentBar label="momentum" value={quant.confluence.components.momentum} />
              <ComponentBar label="volume" value={quant.confluence.components.volume} />
            </div>
            <ul className="space-y-0.5 border-t border-edge pt-2">
              {quant.confluence.reasons.map((r, i) => (
                <li key={i} className="text-[10px] text-mut leading-snug">{r}</li>
              ))}
            </ul>
            <p className="text-[9.5px] text-dim">{quant.metaGate.reason}</p>
          </div>
        </Panel>
      )}

      {/* Chandelier Exit + Donchian Ribbon strategy */}
      <ChandelierDonchianPanel />

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_300px] gap-3">
        <SignalHistory />
        <Panel title="DETECTION SETTINGS">
          <div className="p-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-mut">Automatic S/R detection</span>
              <Toggle checked={settings.srAuto} onChange={(v) => void patchSettings({ srAuto: v })} label="Automatic support/resistance" />
            </div>
            <label className="block space-y-1">
              <span className="microlabel">LOOKBACK (CANDLES)</span>
              <Input type="number" min={60} max={300} value={settings.srLookback}
                onChange={(e) => void patchSettings({ srLookback: parseInt(e.target.value, 10) || 160 })} />
            </label>
            <label className="block space-y-1">
              <span className="microlabel">CLUSTER SENSITIVITY (PRICE FRACTION)</span>
              <Input type="number" step="0.0001" min="0.0005" max="0.01" value={settings.srSensitivity}
                onChange={(e) => void patchSettings({ srSensitivity: parseFloat(e.target.value) || 0.0018 })} />
            </label>
            <label className="block space-y-1">
              <span className="microlabel">MINIMUM TOUCHES</span>
              <Input type="number" min={1} max={5} value={settings.srMinTouches}
                onChange={(e) => void patchSettings({ srMinTouches: parseInt(e.target.value, 10) || 2 })} />
            </label>
            <p className="text-[9.5px] text-dim leading-snug">
              Levels are clustered swing reactions, shown with touch count and confidence — never as exact predictions.
            </p>
          </div>
        </Panel>
      </div>
          <SignalAccountability />
</div>
  );
}

function SignalHistory() {
  const { settings } = useApp();
  const [symbol, setSymbol] = useState("");
  const { data } = usePoll(
    () => api.get<{ signals: {
      id: string; symbol: string; timeframe: string; strategy: string; status: string;
      outcome: string; price: number; entry: number | null; stop: number | null; target: number | null;
      createdAt: string;
    }[] }>(`/api/signals?limit=200${symbol ? `&symbol=${symbol}` : ""}`),
    30000, { deps: [symbol] }
  );
  const signals = data?.signals ?? [];

  return (
    <Panel title="SIGNAL HISTORY" right={
      <Input placeholder="filter symbol…" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} className="w-32 h-6.5" />
    }>
      {!data ? (
        <div className="p-3 space-y-1.5">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-5" />)}</div>
      ) : signals.length === 0 ? (
        <EmptyState icon={<Zap size={18} />} title="No active signals stored yet"
          hint="Every non-WAIT evaluation is persisted here with its full context." />
      ) : (
        <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-panel">
              <tr className="text-left microlabel border-b border-edge">
                <th className="px-3 py-1.5 font-medium">TIME</th>
                <th className="px-2 py-1.5 font-medium">SYMBOL</th>
                <th className="px-2 py-1.5 font-medium">TF</th>
                <th className="px-2 py-1.5 font-medium">STRATEGY</th>
                <th className="px-2 py-1.5 font-medium">SIGNAL</th>
                <th className="px-2 py-1.5 font-medium">OUTCOME</th>
                <th className="px-2 py-1.5 font-medium text-right">PRICE</th>
                <th className="px-2 py-1.5 font-medium text-right">R:R</th>
              </tr>
            </thead>
            <tbody>
              {signals.map((s) => {
                const rr = s.entry && s.stop && s.target && Math.abs(s.entry - s.stop) > 0
                  ? (Math.abs(s.target - s.entry) / Math.abs(s.entry - s.stop)).toFixed(1) : null;
                return (
                  <tr key={s.id} className="border-b border-edge/50">
                    <td className="px-3 py-1.5 num text-dim">{fmtDateTime(new Date(s.createdAt).getTime(), settings.timezone)}</td>
                    <td className="px-2 py-1.5 num">{s.symbol}</td>
                    <td className="px-2 py-1.5 num text-mut">{s.timeframe}</td>
                    <td className="px-2 py-1.5 text-mut">{s.strategy}</td>
                    <td className="px-2 py-1.5">
                      <Chip tone={s.status === "LONG_SETUP" ? "up" : s.status === "SHORT_SETUP" ? "dn" : s.status === "WATCH" ? "warn" : "default"}>
                        {s.status.replace("_", " ")}
                      </Chip>
                    </td>
                    <td className={cx("px-2 py-1.5 text-[10px]", s.outcome === "ACTIVE" ? "text-accent" : "text-dim")}>{s.outcome}</td>
                    <td className="px-2 py-1.5 num text-right">{fmtPrice(s.price)}</td>
                    <td className="px-2 py-1.5 num text-right">{rr ? `1:${rr}` : "—"}</td>
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
