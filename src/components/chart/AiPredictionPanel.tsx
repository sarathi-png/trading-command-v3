"use client";
import { useDisplayCurrency } from "@/lib/useDisplayCurrency";
import { TechnicalReasoning } from "./TechnicalReasoning";
/**
 * AI signal prediction panel.
 *
 * One panel per chart. It is deliberately loud about three things:
 *   1. WHERE the answer came from — a model (with its name) or the built-in
 *      rule engine. A rule-engine answer can never look like a model answer.
 *   2. WHAT it is — a model estimate, not advice, not a probability, and never
 *      a profit promise.
 *   3. WHAT IT WAS BASED ON — the Chandelier Exit, Donchian bounds and
 *      Heikin-Ashi colour actually present on the chart.
 *
 * It also has to work with no API key at all: the rule engine answers, the
 * notice says so, and the user can still see the same structured call.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, RefreshCw, ShieldAlert } from "lucide-react";
import { Chip, HelpTip, SectionHeader, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { cx, fmtPrice } from "@/lib/format";
import { useApp } from "@/stores";
import { AI_PROVIDER_CATALOG, type AiChartType, type AiPrediction, type AiProviderId } from "@/lib/ai/types";
import { ruleEvidence } from "@/lib/ai/rules";
import type { AiPerformance } from "@/lib/ai/service";

interface PredictResponse {
  prediction: AiPrediction | null;
  cached: boolean;
  warning: string | null;
  evidence: string[];
  error?: string;
}

const DIRECTION_COPY: Record<AiPrediction["direction"], { label: string; tone: "up" | "dn" | "default" }> = {
  LONG: { label: "LONG BIAS", tone: "up" },
  SHORT: { label: "SHORT BIAS", tone: "dn" },
  NEUTRAL: { label: "NO CALL", tone: "default" },
};

/**
 * @param chartType which chart this panel belongs to — the Heikin-Ashi panel
 *        sends "heikin-ashi", so the two charts never share an answer.
 */
export default function AiPredictionPanel({
  symbol,
  timeframe,
  chartType,
  className,
}: {
  symbol: string;
  timeframe: string;
  chartType: AiChartType;
  className?: string;
}) {
  useDisplayCurrency();
  const settings = useApp((s) => s.settings);
  const patchSettings = useApp((s) => s.patchSettings);
  const setTimeframe = useApp((s) => s.setTimeframe);
  const aiSettings = settings.aiPrediction ?? { enabled: true, provider: "auto" as const, autoRun: true };

  const [prediction, setPrediction] = useState<AiPrediction | null>(null);
  const [performance, setPerformance] = useState<AiPerformance | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [cached, setCached] = useState(false);
  const [showEvidence, setShowEvidence] = useState(false);
  /** Guard so a re-render or a poll does not spend another free-tier call. */
  const lastRequestedBar = useRef<number | null>(null);

  const run = useCallback(
    async (force = false) => {
      setLoading(true);
      setError(null);
      try {
        const res = await api.post<PredictResponse>("/api/ai", {
          symbol,
          timeframe,
          chartType,
          provider: aiSettings.provider,
          force,
        });
        setPrediction(res.prediction);
        setWarning(res.warning);
        setCached(res.cached);
        if (res.error) setError(res.error);
        if (res.prediction) lastRequestedBar.current = res.prediction.barTime;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Prediction failed");
      } finally {
        setLoading(false);
      }
    },
    [symbol, timeframe, chartType, aiSettings.provider]
  );

  // Scoreboard + provider budget. Cheap (no provider call), so it can poll.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await api.get<AiPerformance>("/api/ai?limit=8");
        if (alive) setPerformance(res);
      } catch {
        // A missing scoreboard must never block the panel.
      }
    };
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  // Predict-on-view, once per 5-minute bar. The server caches by decision bar
  // anyway, so this cannot burn two calls for the same bar.
  useEffect(() => {
    if (!aiSettings.enabled || !aiSettings.autoRun) return;
    if (lastRequestedBar.current !== null) return;
    void run(false);
  }, [aiSettings.enabled, aiSettings.autoRun, run]);

  const evidence = useMemo(
    () => (prediction ? ruleEvidence(prediction.context) : []),
    [prediction]
  );

  const scorecard = performance?.scorecard ?? null;
  const provider = aiSettings.provider;

  if (!aiSettings.enabled) {
    return (
      <div className={cx("p-3 text-[11px] text-dim", className)}>
        <p>AI signal prediction is switched off in Settings → AI SIGNAL PREDICTION.</p>
      </div>
    );
  }

  return (
    <div className={cx("flex flex-col", className)} data-testid={`ai-panel-${chartType}`}>
      <SectionHeader
        title={chartType === "heikin-ashi" ? "AI PREDICTION · HEIKIN-ASHI" : "AI PREDICTION · CANDLES"}
        right={
          <span className="flex items-center gap-1">
            <select
              aria-label="AI provider"
              value={provider}
              onChange={(e) => void patchSettings({ aiPrediction: { ...aiSettings, provider: e.target.value as NonNullable<typeof aiSettings>["provider"] } })}
              className="bg-panel2 border border-edge rounded text-[10px] px-1 py-0.5 text-mut"
            >
              <option value="auto">AUTO</option>
              <option value="openrouter">OPENROUTER</option>
              <option value="nvidia">NVIDIA NIM</option>
              <option value="rules">RULE ENGINE</option>
            </select>
            <button
              type="button"
              onClick={() => void run(true)}
              disabled={loading}
              className="p-1 text-dim hover:text-ink disabled:opacity-40"
              title="Ask again now (uses free-tier quota if a provider is configured)"
            >
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            </button>
          </span>
        }
      />

      <div className="p-3 space-y-2.5">
        {error && (
          <div role="alert" className="text-[11px] text-warn bg-warn/10 border border-warn/30 rounded px-2 py-1.5">
            {error}
          </div>
        )}

        {loading && !prediction && (
          <div className="space-y-2">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        )}

        {prediction && (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <Chip tone={DIRECTION_COPY[prediction.direction].tone}>{DIRECTION_COPY[prediction.direction].label}</Chip>
              {prediction.direction !== "NEUTRAL" && (
                <span className="num text-[11px] text-mut">
                  stated certainty <span className="text-ink">{prediction.confidence}</span>/100
                </span>
              )}
              <span className="text-[9.5px] text-dim">
                horizon {prediction.horizonBars} × {timeframe} candles
              </span>
              {timeframe !== "5m" && (
                <button
                  type="button"
                  onClick={() => setTimeframe("5m")}
                  className="text-[9.5px] text-accent hover:underline"
                  title="The predictor is specified for the 5-minute frame; switch the workspace to 5m"
                >
                  USE 5m
                </button>
              )}
              {cached && <Chip tone="default">SAME 5M BAR</Chip>}
              {prediction.degraded && <Chip tone="warn">RULE ENGINE</Chip>}
            </div>

            <p className="text-[11px] text-mut leading-snug">{prediction.rationale}</p>

            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] num">
              <span className="text-dim">DECISION PRICE</span>
              <span className="text-right text-mut">{fmtPrice(prediction.entryPrice)}</span>
              <span className="text-dim">INVALID IF</span>
              <span className="text-right text-mut">
                {prediction.invalidation !== null ? fmtPrice(prediction.invalidation) : "no directional call"}
              </span>
              <span className="text-dim">SUPPORT · RESISTANCE</span>
              <span className="text-right text-mut">
                {prediction.keyLevels.support !== null ? fmtPrice(prediction.keyLevels.support) : "n/a"}
                {" · "}
                {prediction.keyLevels.resistance !== null ? fmtPrice(prediction.keyLevels.resistance) : "n/a"}
              </span>
            </div>

            {prediction.outcome && prediction.outcome.resolution !== "pending" && (
              <div className="text-[10px] flex items-center gap-2">
                <span className="text-dim">RESULT</span>
                <span className={cx(
                  "num",
                  prediction.outcome.resolution === "direction-correct" ? "text-up"
                    : prediction.outcome.resolution === "direction-wrong" ? "text-dn" : "text-mut"
                )}>
                  {prediction.outcome.resolution === "direction-correct" ? "MOVED AS CALLED"
                    : prediction.outcome.resolution === "direction-wrong"
                      ? prediction.outcome.invalidationHit ? "HIT ITS OWN INVALIDATION" : "MOVED AGAINST THE CALL"
                      : "NO MEANINGFUL MOVE"}
                </span>
                {prediction.outcome.movePct !== null && (
                  <span className="num text-dim">{prediction.outcome.movePct > 0 ? "+" : ""}{prediction.outcome.movePct.toFixed(3)}%</span>
                )}
              </div>
            )}

            <div className="text-[9.5px] text-dim">
              Source:{" "}
              <span className="text-mut">
                {prediction.provider === "rules"
                  ? "built-in Chandelier + Donchian rule engine"
                  : `${AI_PROVIDER_CATALOG[prediction.provider as Exclude<AiProviderId, "rules">]?.label ?? prediction.provider} · ${prediction.model}`}
              </span>
              {" · "}
              {new Date(prediction.createdAt).toLocaleTimeString()}
            </div>

            <button
              type="button"
              onClick={() => setShowEvidence((v) => !v)}
              className="text-[10px] text-accent hover:underline"
            >
              {showEvidence ? "Hide the evidence" : "Show the evidence it was given"}
            </button>
            {showEvidence && (
              <ul className="text-[10px] text-dim space-y-0.5 border-l border-edge pl-2">
                {evidence.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}

            {prediction.memoryStored === false && <p role="alert" className="text-warn text-[11px]">Memory storage failed: this call was not saved.</p>}
            <TechnicalReasoning context={prediction.context} />

            {warning && (
              <p className="text-[10px] text-warn leading-snug bg-warn/5 border border-warn/25 rounded px-2 py-1.5">
                {warning}
              </p>
            )}
          </>
        )}

        {/* Trust block — always rendered, never collapsible. */}
        <div className="border-t border-edge pt-2 space-y-1.5">
          <p className="text-[9.5px] text-dim flex items-start gap-1.5 leading-snug">
            <ShieldAlert size={12} className="mt-px flex-none" />
            <span>
              A model estimate for study, not advice and not a probability. &ldquo;Stated certainty&rdquo; is the
              model&rsquo;s own wording, not a measured win rate. Signals here are never executed automatically.
            </span>
          </p>
          <p className="text-[9.5px] text-dim flex items-start gap-1.5 leading-snug">
            <Bot size={12} className="mt-px flex-none" />
            <span>
              Free-tier keys are rate-limited: calls are spaced out and capped per day, and the rule engine answers
              when the quota is spent. Every call is recorded so its outcome can be scored later.
              {scorecard && scorecard.scored > 0 && (
                <>
                  {" "}
                  Recorded so far: <span className="num text-mut">{scorecard.correct} of {scorecard.scored}</span> directional calls
                  moved the called way.
                </>
              )}
            </span>
          </p>
          {performance && (
            <p className="text-[9.5px] text-dim num">
              {performance.providers
                .filter((p) => p.id !== "rules")
                .map((p) => `${p.label}: ${p.configured ? `${p.callsToday}/${p.dailyLimit} calls today` : "no key"}`)
                .join(" · ")}
            </p>
          )}
          <p className="text-[9.5px] text-dim">
            {chartType === "heikin-ashi"
              ? "Heikin-Ashi prices never traded — this panel reads direction on smoothed candles."
              : "Indicators: Chandelier Exit (trailing stop) + Donchian ribbon, on closed candles only."}
            <HelpTip topic="chandelierStops" />
            <HelpTip topic="donchianBounds" />
          </p>
        </div>
      </div>
    </div>
  );
}
