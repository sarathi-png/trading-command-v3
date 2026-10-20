"use client";
import { Chip, Panel, PremiumPanel } from "@/components/ui";
import type { ResearchReport } from "@/lib/research/types";

/**
 * Renders a validated research report. Everything here is
 * plain text/HTML-escaped by React — the model's words are
 * displayed, never executed.
 */
export function ResearchReportView({ report }: { report: ResearchReport }) {
  return (
    <div className="space-y-3">
      {report.compatibility === "research-only" && (
        <div className="rounded border border-warn/40 bg-warn/10 px-3 py-2 text-[11px] text-warn">
          This hypothesis does not map onto the executable Chandelier Exit + Donchian
          Ribbon engine, so it is <strong>research-only</strong>: it can be read and
          compared, but it cannot be backtested or enabled for paper trading until it is
          expressed as a compatible configuration.
        </div>
      )}

      {report.warnings.length > 0 && (
        <Panel title="VALIDATION NOTES" right={<Chip tone="warn">{report.warnings.length}</Chip>}>
          <ul className="space-y-1 p-3">
            {report.warnings.map((w, i) => (
              <li key={i} className="text-[11px] text-warn leading-snug">• {w}</li>
            ))}
          </ul>
        </Panel>
      )}

      <PremiumPanel title="RESEARCH SUMMARY" elevation={1}>
        <p className="p-3 text-[12px] leading-relaxed text-ink">{report.summary}</p>
      </PremiumPanel>

      <PremiumPanel title="STRATEGY HYPOTHESIS" elevation={1}>
        <p className="p-3 text-[12px] leading-relaxed text-mut">{report.hypothesis}</p>
      </PremiumPanel>

      <PremiumPanel title="MARKET & TIMEFRAME ASSUMPTIONS" elevation={1}>
        <p className="p-3 text-[12px] leading-relaxed text-mut">{report.marketAssumptions}</p>
      </PremiumPanel>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <PremiumPanel title="ENTRY RULES" elevation={1}>
          <ol className="space-y-1 p-3">
            {report.entryRules.map((r, i) => (
              <li key={i} className="text-[11px] text-ink leading-snug flex gap-2">
                <span className="num text-dim flex-none">{i + 1}.</span>
                <span>{r}</span>
              </li>
            ))}
          </ol>
        </PremiumPanel>
        <PremiumPanel title="EXIT RULES" elevation={1}>
          <ol className="space-y-1 p-3">
            {report.exitRules.map((r, i) => (
              <li key={i} className="text-[11px] text-ink leading-snug flex gap-2">
                <span className="num text-dim flex-none">{i + 1}.</span>
                <span>{r}</span>
              </li>
            ))}
          </ol>
        </PremiumPanel>
      </div>

      <PremiumPanel title="INDICATOR PARAMETERS" elevation={1} badge={
        report.indicators.length === 0 ? <Chip tone="default">none proposed</Chip> : undefined
      }>
        {report.indicators.length === 0 ? (
          <p className="p-3 text-[11px] text-dim">No indicators were proposed alongside the hypothesis.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead className="border-b border-edge">
                <tr className="text-left microlabel">
                  <th className="px-3 py-1.5 font-medium">INDICATOR</th>
                  <th className="px-3 py-1.5 font-medium">PERIOD</th>
                  <th className="px-3 py-1.5 font-medium">PARAMS</th>
                  <th className="px-3 py-1.5 font-medium">ROLE</th>
                </tr>
              </thead>
              <tbody>
                {report.indicators.map((ind, i) => (
                  <tr key={i} className="border-b border-edge/50">
                    <td className="px-3 py-1.5 num text-accent uppercase">{ind.type}</td>
                    <td className="px-3 py-1.5 num">{ind.period ?? "—"}</td>
                    <td className="px-3 py-1.5 num text-dim">
                      {ind.params ? JSON.stringify(ind.params) : "—"}
                    </td>
                    <td className="px-3 py-1.5 text-mut">{ind.role}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PremiumPanel>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <PremiumPanel title="STOP-LOSS LOGIC" elevation={1}>
          <p className="p-3 text-[11px] leading-snug text-mut">{report.stopLossLogic}</p>
        </PremiumPanel>
        <PremiumPanel title="TAKE-PROFIT LOGIC" elevation={1}>
          <p className="p-3 text-[11px] leading-snug text-mut">{report.takeProfitLogic}</p>
        </PremiumPanel>
        <PremiumPanel title="POSITION-SIZING ASSUMPTIONS" elevation={1}>
          <p className="p-3 text-[11px] leading-snug text-mut">{report.positionSizing}</p>
        </PremiumPanel>
        <PremiumPanel title="RECOMMENDED BACKTEST PERIOD" elevation={1}>
          <div className="p-3">
            <p className="num text-[13px] text-ink">{report.recommendedBars} closed candles</p>
            <p className="text-[11px] text-dim mt-1 leading-snug">{report.recommendedPeriodRationale}</p>
          </div>
        </PremiumPanel>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <PremiumPanel title="RISK FACTORS & KNOWN WEAKNESSES" elevation={1}>
          <ul className="space-y-1 p-3">
            {report.riskFactors.map((r, i) => (
              <li key={i} className="text-[11px] text-dn leading-snug">• {r}</li>
            ))}
          </ul>
        </PremiumPanel>
        <PremiumPanel title="POTENTIAL OVERFITTING CONCERNS" elevation={1}>
          <ul className="space-y-1 p-3">
            {report.overfittingConcerns.map((r, i) => (
              <li key={i} className="text-[11px] text-warn leading-snug">• {r}</li>
            ))}
          </ul>
        </PremiumPanel>
      </div>

      <PremiumPanel title="SUGGESTED VALIDATION STEPS" elevation={1}>
        <ol className="space-y-1 p-3">
          {report.validationSteps.map((s, i) => (
            <li key={i} className="text-[11px] text-mut leading-snug flex gap-2">
              <span className="num text-dim flex-none">{i + 1}.</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
      </PremiumPanel>

      <p className="text-[10px] text-dim leading-snug px-1">
        This is an AI-generated hypothesis, not a verified result. Historical backtest
        performance does not guarantee future profits.
      </p>
    </div>
  );
}
