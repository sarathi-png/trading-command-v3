"use client";
import { useDisplayCurrency } from "@/lib/useDisplayCurrency";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { Chip, SectionHeader, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { cx, fmtPrice } from "@/lib/format";
import { useApp } from "@/stores";
import { AI_PROVIDER_CATALOG, type AiChartType, type AiPrediction } from "@/lib/ai/types";
import { decisionSummary } from "@/lib/ai/decision";
import { ruleVerdict, ruleEvidence } from "@/lib/ai/rules";
import { TechnicalReasoning } from "./TechnicalReasoning";
import type { AiPerformance } from "@/lib/ai/service";
import ConnectionStatus from "../ConnectionStatus";

interface PredictResponse { prediction: AiPrediction | null; cached: boolean; warning: string | null; error?: string }
const decisionLabel = (direction: string) => direction === "LONG" ? "LONG" : direction === "SHORT" ? "SHORT" : "WAIT / NEUTRAL";

interface PanelProps { symbol: string; timeframe: string; chartType: AiChartType; className?: string }
export default function AiPredictionPanel(props: PanelProps) {
  const settings = useApp(s => s.settings);
  const key = `${props.symbol}:${props.timeframe}:${props.chartType}:${settings.aiPrediction?.provider}:${settings.dataSource}:${JSON.stringify(settings.chandelierDonchian)}`;
  return <DecisionPanel key={key} {...props} />;
}
function DecisionPanel({ symbol, timeframe, chartType, className }: PanelProps) {
  useDisplayCurrency();
  const settings = useApp(s => s.settings);
  const aiSettings = settings.aiPrediction ?? { enabled: true, provider: "auto" as const, autoRun: true };
  const [response, setResponse] = useState<PredictResponse | null>(null);
  const [performance, setPerformance] = useState<AiPerformance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reasonsOpen, setReasonsOpen] = useState(false);
  const identity = `${symbol}:${timeframe}:${chartType}:${aiSettings.provider}:${settings.dataSource}`;
  const requestedIdentity = useRef<string | null>(null);
  const busy = useRef(false);
  const run = useCallback(async (force = false) => {
    if (busy.current) return;
    busy.current = true; setLoading(true); setError(null);
    try {
      const result = await api.post<PredictResponse>("/api/ai", { symbol, timeframe, chartType, provider: aiSettings.provider, force });
      setResponse(result);
      requestedIdentity.current = identity;
      if (result.error) setError(result.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI review unavailable");
    } finally { busy.current = false; setLoading(false); }
  }, [identity, symbol, timeframe, chartType, aiSettings.provider]);
  useEffect(() => {
    let alive = true;
    api.get<AiPerformance>("/api/ai?limit=8").then(result => { if (alive) setPerformance(result); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    if (aiSettings.enabled && aiSettings.autoRun && requestedIdentity.current !== identity) void run();
  }, [aiSettings.enabled, aiSettings.autoRun, identity, run]);
  if (!aiSettings.enabled) return <p className="p-3 text-xs text-mut">AI review is off. Enable it in <Link href="/ai-connection" className="text-accent">AI Connection</Link>.</p>;
  const prediction = response?.prediction;
  const summary = prediction ? decisionSummary(prediction) : null;
  const strategy = prediction ? ruleVerdict(prediction.context) : null;
  const external = prediction && prediction.provider !== "rules" ? AI_PROVIDER_CATALOG[prediction.provider] : null;
  return <section className={cx("flex flex-col", className)} data-testid={`ai-panel-${chartType}`} aria-label="Strategy and AI decision">
    <SectionHeader title="STRATEGY × AI · DECISION" right={<button type="button" onClick={() => void run(true)} disabled={loading} aria-label="Refresh AI decision" title="Refresh review (free-tier quota and request spacing apply)" className="text-accent p-1 disabled:opacity-40"><RefreshCw size={14} className={loading ? "animate-spin" : ""} /></button>} />
    <div className="p-3 space-y-3">
      <p className="text-[11px] text-mut">{symbol} · {timeframe} · {chartType === "candles" ? "Candlestick" : "Heikin-Ashi"} · Chandelier Exit + Donchian</p>
      {error && <p role="alert" className="text-xs text-warn">{error}</p>}
      {loading && !prediction && <Skeleton className="h-20 w-full" />}
      {!prediction && !loading && <p className="text-xs text-mut">No decision yet. Refresh to request a review.</p>}
      {prediction && summary && <>
        <div className="decision-summary" data-testid="decision-summary">
          <div><p className="microlabel">Strategy decision</p><p className="text-sm font-semibold mt-2">{decisionLabel(summary.strategy)}</p></div>
          <div><p className="microlabel">AI decision</p><p className="text-sm font-semibold mt-2">{summary.ai === null ? "Unavailable" : decisionLabel(summary.ai)}</p>{summary.ai === null && <p className="text-[10px] text-mut mt-1">Technical rules only · not an AI vote</p>}</div>
          <div><p className="microlabel">Final output</p><p className={cx("text-sm font-semibold mt-2", summary.result === "MATCH" ? "text-up" : summary.result === "DISAGREE" ? "text-warn" : "text-mut")}>
            {summary.result === "MATCH" ? "Strategy = AI" : summary.result === "DISAGREE" ? "Strategy ≠ AI" : "Not compared"}
          </p><p className="text-[10px] text-mut mt-1">{summary.result === "MATCH" && summary.ai === "NEUTRAL" ? "Both say wait · no trade" : summary.result === "MATCH" ? "Directional agreement · not trade approval" : summary.result === "DISAGREE" ? "Conflicting decisions · review before acting" : "No independent AI result"}</p></div>
        </div>
        {prediction.modelDecision && prediction.modelDecision.direction !== prediction.direction && <p className="text-xs text-warn">Technical safety veto · published decision: {decisionLabel(prediction.direction)}. Model proposal is shown above, not approved for execution.</p>}
        <p className="text-[10px] text-dim">{external ? `${external.label} · ${prediction.model}` : "Built-in technical strategy"} · {new Date(prediction.createdAt).toLocaleTimeString()} {response?.cached ? "· cached decision bar" : ""}</p>
        <details open={reasonsOpen} onToggle={event => setReasonsOpen(event.currentTarget.open)} className="border-t border-edge pt-2">
          <summary className="cursor-pointer text-accent text-xs">Reasons & details</summary>
          {reasonsOpen && <div className="mt-3 space-y-3 text-xs text-mut">
            <p><strong>Strategy:</strong> {strategy?.rationale}</p>
            <p><strong>{summary.ai === null ? "Technical fallback" : "AI"}:</strong> {prediction.modelDecision?.rationale ?? prediction.rationale}</p>
            {response?.warning && <p className="text-warn">{response.warning}</p>}
            <p>Decision price: {fmtPrice(prediction.entryPrice)} · Invalidation: {prediction.invalidation === null ? "None" : fmtPrice(prediction.invalidation)}</p>
            <p>Horizon: {prediction.horizonBars} × {timeframe} candles. {summary.ai !== null ? `Model-stated certainty: ${prediction.modelDecision?.confidence ?? prediction.confidence}/100, not a measured win rate.` : "No model certainty claim."}</p>
            <ul className="list-disc pl-4">{ruleEvidence(prediction.context).map(line => <li key={line}>{line}</li>)}</ul>
            <TechnicalReasoning context={prediction.context} />
            {prediction.memoryStored === false && <p role="alert" className="text-warn">This review could not be saved.</p>}
            {performance && <div className="flex flex-wrap gap-3">{performance.providers.filter(p => p.id !== "rules").map(p => <div key={p.id}><ConnectionStatus configured={p.configured} label={`${p.label} key`} /><p className="text-[10px]">{p.callsToday}/{p.dailyLimit} requests today</p></div>)}</div>}
            {response?.cached && <Chip>Cached decision bar</Chip>}
          </div>}
        </details>
      </>}
      <p className="text-[10px] text-dim">Agreement is not a probability or execution instruction. {chartType === "heikin-ashi" ? "Smoothed prices are not fill prices. " : ""}No orders are placed by this review.</p>
    </div>
  </section>;
}
