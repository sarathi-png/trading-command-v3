"use client";
import { Chip, Panel, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { usePoll } from "@/lib/hooks";
import type { ResearchEnvelope } from "@/lib/research/macro";

/**
 * Macro + news research panel.
 *
 * Every value carries its provider and observation date. When a provider is
 * not configured the panel says so; it never substitutes a placeholder number
 * or an invented headline.
 */
export default function ResearchPanel() {
  const { data, error } = usePoll(() => api.get<ResearchEnvelope>("/api/research/macro"), 60_000);

  if (error) {
    return (
      <Panel title="RESEARCH">
        <p role="status" className="p-3 text-[11px] text-warn">Research unavailable: {error}.</p>
      </Panel>
    );
  }
  if (!data) {
    return (
      <Panel title="RESEARCH">
        <div className="p-3 space-y-2">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-6" />)}
        </div>
      </Panel>
    );
  }

  const macro = data.macro;
  return (
    <Panel title="RESEARCH" badge={<Chip>MACRO + NEWS</Chip>}>
      <div className="divide-y divide-edge/60">
        {Array.isArray(macro) ? (
          macro.map((series) => {
            const latest = series.points.find((p) => p.value !== null);
            const previous = series.points.find((p) => p.value !== null && p !== latest);
            const change =
              latest?.value != null && previous?.value != null ? latest.value - previous.value : null;
            return (
              <div key={series.id} className="px-3 py-2 flex items-center justify-between gap-3">
                <div>
                  <div className="text-[11px]">{series.title}</div>
                  <div className="text-[9.5px] text-dim">
                    {series.source} · {series.asOf ?? "no observation"} · {series.unit}
                  </div>
                </div>
                <div className="text-right">
                  <div className="num text-[12px]">
                    {latest?.value != null ? latest.value.toFixed(3) : "N/A"}
                  </div>
                  <div className="num text-[9.5px] text-dim">
                    {change == null ? "no prior" : `${change >= 0 ? "+" : ""}${change.toFixed(3)} vs prior`}
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <p className="px-3 py-2 text-[11px] text-warn">{macro.reason}</p>
        )}
        <div className="px-3 py-2">
          <div className="text-[11px]">News</div>
          <p className="text-[10px] text-warn">{data.news.reason}</p>
        </div>
      </div>
    </Panel>
  );
}
