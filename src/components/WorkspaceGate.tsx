"use client";
import { useState } from "react";
import { selectWorkspace, type Workspace } from "@/lib/workspaceClient";

export default function WorkspaceGate({ onSelected }: { onSelected: () => void | Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function choose(workspace: Workspace) {
    setBusy(true); setError(""); selectWorkspace(workspace);
    try { await onSelected(); }
    catch { selectWorkspace(null); setError("Workspace settings could not be loaded. Please retry."); }
    finally { setBusy(false); }
  }
  return <main className="min-h-dvh bg-bg flex items-center justify-center p-6">
    <section className="w-full max-w-2xl space-y-6">
      <p className="microlabel text-accent">TRADING COMMAND · PROFILE</p>
      <h1 className="text-2xl font-semibold">Choose your trading workspace</h1>
      <p className="text-mut text-sm">Live and Paper use separate account views, trade histories, analytics and workspace preferences. Market prices can be live in either workspace.</p>
      {error && <p role="alert" className="text-warn text-sm">{error}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <button disabled={busy} onClick={() => void choose("paper")} className="panel text-left p-6 space-y-3 hover:border-accent">
          <h2 className="font-semibold text-lg">Paper trading</h2><p className="text-sm text-mut">Practice with simulated funds and simulated orders. No real account balance.</p>
        </button>
        <button disabled={busy} onClick={() => void choose("live")} className="panel text-left p-6 space-y-3 hover:border-accent">
          <h2 className="font-semibold text-lg">Live trading</h2><p className="text-sm text-mut">CoinDCX account only. Requires exchange credentials. Order execution remains protected by the existing safety switches.</p>
        </button>
      </div>
    </section>
  </main>;
}
