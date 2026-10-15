"use client";
import Link from "next/link";
import { ArrowUpRight, CheckCircle2, CircleDashed, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useApp, useMarket } from "@/stores";
import type { Analysis } from "@/lib/types";

/** Transparent evidence summary, deliberately NOT a trade approval or probability. */
export default function DecisionReadiness({ analysis, error }: { analysis: Analysis | null; error: string | null }) {
  const { settings } = useApp();
  const feed = useMarket(s => s.feed);
  const lastTickAt = useMarket(s => s.lastTickAt);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);
  const fresh = !!analysis && !error && now - analysis.evaluatedAt < 60000;
  const connected = feed === "live" && lastTickAt > 0 && now - lastTickAt < 15000;
  const setup = fresh && analysis?.signals.some(s => s.status === "LONG_SETUP" || s.status === "SHORT_SETUP");
  const items = [
    { title: "Market data", value: !connected ? "Waiting for feed" : settings.dataSource === "demo" ? "Simulated feed" : "CoinDCX connected", ready: connected },
    { title: "Analysis", value: error ? "Unavailable · retrying" : fresh ? "Closed-candle evidence" : "Awaiting fresh analysis", ready: fresh },
    { title: "Setup", value: setup ? "Candidate · review risk" : "No confirmed candidate", ready: !!setup },
    { title: "Execution", value: settings.mode === "read_only" ? "Read only · orders blocked" : settings.mode === "paper" ? "Paper · simulated orders" : settings.liveArmed ? "Live armed · risk gates apply" : "Live · not armed", ready: settings.mode !== "live" },
  ];
  return (
    <section className="panel overflow-hidden" aria-label="Decision readiness">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-edge">
        <div className="flex items-center gap-2 text-[12px] font-medium"><ShieldCheck size={16} className="text-accent" /> Decision readiness <span className="hidden sm:inline text-dim font-normal">Evidence before execution</span></div>
        <Link href={setup ? "/strategy" : "/settings"} className="text-[11px] text-accent inline-flex items-center gap-1 min-h-6">{setup ? "Review setup" : "Review controls"}<ArrowUpRight size={13} /></Link>
      </div>
      <div className="grid grid-cols-2 xl:grid-cols-4 divide-x divide-edge">
        {items.map(item => <div key={item.title} className="px-4 py-3 min-w-0">
          <p className="text-[10px] text-mut mb-1.5">{item.title}</p>
          <div className="flex items-start gap-2 text-[11px] leading-5">{item.ready ? <CheckCircle2 size={13} className="mt-1 text-accent shrink-0" /> : <CircleDashed size={13} className="mt-1 text-warn shrink-0" />}<span>{item.value}</span></div>
        </div>)}
      </div>
      {error && <p role="alert" className="px-4 pb-3 text-[11px] text-warn">{error}</p>}
    </section>
  );
}
