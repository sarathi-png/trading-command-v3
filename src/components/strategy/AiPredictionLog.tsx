"use client";
import { useDisplayCurrency } from "@/lib/useDisplayCurrency";
/**
 * AI prediction log.
 *
 * The counterpart to the signal ledger: every model (or rule-engine) call is
 * recorded with the evidence it was given, and once the horizon has printed it
 * is scored against what price actually did. Nothing is hidden or retried until
 * it looks good — a call that hit its own invalidation level stays on the list.
 *
 * The panel is explicit about the two things that make this honest:
 *   - which engine made each call (a rule-engine fallback is labelled, always)
 *   - how small the sample is, while it is still small
 */
import { useState } from "react";
import { Bot } from "lucide-react";
import { Chip, EmptyState, HelpTip, PremiumPanel, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { fmtDateTime, fmtPrice } from "@/lib/format";
import { usePoll } from "@/lib/hooks";
import { AI_PROVIDER_CATALOG, type AiPrediction, type AiProviderId } from "@/lib/ai/types";
import type { AiPerformance } from "@/lib/ai/service";

const RULES_LABEL = "Rule engine";

function providerName(provider: AiProviderId, model: string): string {
  if (provider === "rules") return RULES_LABEL;
  return AI_PROVIDER_CATALOG[provider]?.label ?? `${provider} · ${model}`;
}

const OUTCOME_TONE: Record<string, "up" | "dn" | "accent" | "default"> = {
  "direction-correct": "up",
  "direction-wrong": "dn",
  "no-call": "default",
  pending: "accent",
};

const OUTCOME_LABEL: Record<string, string> = {
  "direction-correct": "AS CALLED",
  "direction-wrong": "AGAINST",
  "no-call": "NO MOVE",
  pending: "PENDING",
};

export function AiPredictionLog({ className, limit = 20 }: { className?: string; limit?: number }) {
  useDisplayCurrency();
  const { data, loading, error } = usePoll<AiPerformance>(() => api.get<AiPerformance>(`/api/ai?limit=${limit}`), 60_000);
  const [open, setOpen] = useState<string | null>(null);

  const card = data?.scorecard ?? null;
  const recent: AiPrediction[] = data?.recent ?? [];

  return (
    <PremiumPanel
      title="AI PREDICTION LOG"
      right={card ? <span className="text-[9.5px] num text-dim">{card.total} RECORDED</span> : undefined}
      elevation={1}
      className={className}
    >
      <div className="p-3 space-y-3">
        <p className="text-[10.5px] text-dim leading-snug flex items-start gap-1.5">
          <Bot size={12} className="mt-px flex-none" />
          <span>
            Each line is one call made for a 5-minute bar (Chandelier Exit + Donchian trend), scored against the
            candles that followed. Estimates for study — never advice, never executed.{" "}
            <HelpTip topic="chandelierStops" /> <HelpTip topic="donchianBounds" />
          </span>
        </p>

        {error && <p className="text-[11px] text-warn">{error}</p>}
        {loading && !data && <Skeleton className="h-24 w-full" />}

        {card && (
          <div className="auto-cells gap-x-4 gap-y-1 border border-edge rounded p-2 text-[10px]">
            <div>
              <div className="text-dim">CALLS SCORED</div>
              <div className="num text-ink text-[13px]">{card.scored}</div>
            </div>
            <div>
              <div className="text-dim">MOVED AS CALLED</div>
              <div className="num text-up text-[13px]">{card.correct}</div>
            </div>
            <div>
              <div className="text-dim">MOVED AGAINST</div>
              <div className="num text-dn text-[13px]">{card.wrong}</div>
            </div>
            <div>
              <div className="text-dim">HIT OWN INVALIDATION</div>
              <div className="num text-mut text-[13px]">
                {card.invalidationRate === null ? "—" : `${Math.round(card.invalidationRate * 100)}%`}
              </div>
            </div>
            <div>
              <div className="text-dim">ABSTAINED</div>
              <div className="num text-mut text-[13px]">{card.abstentions}</div>
            </div>
            <div>
              <div className="text-dim">PENDING</div>
              <div className="num text-mut text-[13px]">{card.pending}</div>
            </div>
          </div>
        )}

        {card && (
          <p className="text-[9.5px] text-dim leading-snug">{card.note}</p>
        )}

        {card && card.byProvider.length > 0 && (
          <div className="text-[10px] space-y-0.5">
            {card.byProvider.map((p) => (
              <div key={p.provider} className="flex items-center justify-between">
                <span className="text-mut">{providerName(p.provider as AiProviderId, "")}</span>
                <span className="num text-dim">
                  {p.total} calls · {p.scored} scored ·{" "}
                  {p.hitRate === null ? "no score yet" : `${Math.round(p.hitRate * 100)}% as called`}
                </span>
              </div>
            ))}
          </div>
        )}

        {recent.length === 0 && !loading ? (
          <EmptyState
            title="No predictions recorded yet"
            hint="Open the chart workspace and let the predictor run once per 5-minute bar — calls appear here as soon as they are scored by the candles that follow."
          />
        ) : (
          <div className="divide-y divide-edge/60 border border-edge rounded overflow-hidden">
            {recent.map((p) => {
              const resolution = p.outcome?.resolution ?? "pending";
              return (
                <div key={p.id} className="text-[10.5px]">
                  <button
                    type="button"
                    onClick={() => setOpen(open === p.id ? null : p.id)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-panel2/60"
                    aria-expanded={open === p.id}
                  >
                    <Chip tone={p.direction === "LONG" ? "up" : p.direction === "SHORT" ? "dn" : "default"}>
                      {p.direction}
                    </Chip>
                    <span className="num text-mut">{p.symbol}</span>
                    <span className="text-dim">{p.chartType === "heikin-ashi" ? "HA" : "CANDLE"}</span>
                    <span className="text-dim truncate hidden sm:inline">{providerName(p.provider, p.model)}</span>
                    <span className="ml-auto flex items-center gap-2 flex-none">
                      <span className="num text-dim">{p.confidence}/100</span>
                      <Chip tone={OUTCOME_TONE[resolution]}>{OUTCOME_LABEL[resolution]}</Chip>
                    </span>
                  </button>
                  {open === p.id && (
                    <div className="px-2 pb-2 space-y-1">
                      <p className="text-[10.5px] text-mut leading-snug">{p.rationale}</p>
                      <div className="grid grid-cols-2 gap-x-3 text-[10px] num">
                        <span className="text-dim">DECISION PRICE</span>
                        <span className="text-right text-mut">{fmtPrice(p.entryPrice)}</span>
                        <span className="text-dim">INVALID IF</span>
                        <span className="text-right text-mut">
                          {p.invalidation === null ? "no directional call" : fmtPrice(p.invalidation)}
                        </span>
                        {p.outcome && p.outcome.priceAtHorizon !== null && (
                          <>
                            <span className="text-dim">PRICE AT HORIZON</span>
                            <span className="text-right text-mut">{fmtPrice(p.outcome.priceAtHorizon)}</span>
                          </>
                        )}
                      </div>
                      {p.notice && (
                        <p className="text-[10px] text-warn bg-warn/5 border border-warn/25 rounded px-2 py-1 leading-snug">
                          {p.notice}
                        </p>
                      )}
                      <p className="text-[9.5px] text-dim">
                        {fmtDateTime(p.createdAt)} · {p.horizonBars} × {p.timeframe} horizon · model{" "}
                        <span className="num">{p.model}</span>
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {data && (
          <p className="text-[9.5px] text-dim num">
            {data.providers
              .filter((p) => p.id !== "rules")
              .map((p) =>
                p.configured
                  ? `${p.label}: ${p.callsToday}/${p.dailyLimit} calls today${p.waitSeconds > 0 ? ` · next in ${p.waitSeconds}s` : ""}`
                  : `${p.label}: no key (rule engine answers)`
              )
              .join(" · ")}
          </p>
        )}
      </div>
    </PremiumPanel>
  );
}
