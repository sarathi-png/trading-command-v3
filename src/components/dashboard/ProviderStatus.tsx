"use client";
import { Chip, Panel } from "@/components/ui";
import { useApp, useMarket } from "@/stores";

/** Verified provider/readiness facts; unknown is displayed as unknown. */
export default function ProviderStatus() {
  const system = useApp((s) => s.system);
  const feed = useMarket((s) => s.feed);
  const latency = useMarket((s) => s.latencyMs);
  const market = system?.market;

  const rows: { label: string; value: string; tone?: "up" | "dn" | "warn" }[] = [
    { label: "MARKET FEED", value: feed === "live" ? `LIVE${latency !== null ? ` · ${latency} ms` : ""}` : feed.toUpperCase(), tone: feed === "live" ? "up" : feed === "lost" ? "dn" : "warn" },
    { label: "PROVIDER", value: market ? `${market.provider} · ${market.dataSource}` : "not reported" },
    { label: "PUBLIC VENUE", value: system?.exchangeMarket ?? "not checked", tone: system?.exchangeMarket === "online" ? "up" : system?.exchangeMarket === "offline" ? "dn" : undefined },
    { label: "DATABASE", value: system ? (system.db ? "ready" : "unreachable") : "not checked", tone: system?.db ? "up" : system ? "dn" : undefined },
    { label: "TIMEFRAMES", value: market ? `${market.timeframes.length} published` : "unknown" },
    { label: "ORDERBOOK", value: market ? (market.orderbook ? "available" : "disabled") : "unknown" },
    { label: "EXECUTION", value: system?.execution ?? "not reported" },
  ];

  return (
    <Panel title="PROVIDER STATUS" badge={<Chip>{market?.label ?? "PUBLIC DATA"}</Chip>}>
      <div className="divide-y divide-edge/60">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-2 px-3 py-2 text-[11px]">
            <span className="microlabel">{row.label}</span>
            <span className={row.tone === "up" ? "text-up" : row.tone === "dn" ? "text-dn" : row.tone === "warn" ? "text-warn" : "text-mut"}>
              {row.value}
            </span>
          </div>
        ))}
      </div>
    </Panel>
  );
}
