"use client";
import { useEffect } from "react";
import { api } from "@/lib/api";
/** Collect history only; never submits an order or changes execution settings. */
export default function JournalMonitor({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false, busy = false;
    async function tick() {
      if (cancelled || busy || document.visibilityState === "hidden") return;
      busy = true;
      try { await api.post("/api/journal/sync", {}); } catch { /* status shown in journal */ }
      finally { busy = false; }
    }
    void tick();
    const timer = setInterval(() => void tick(), 15_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [enabled]);
  return null;
}
