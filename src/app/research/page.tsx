"use client";
import { useDisplayCurrency } from "@/lib/useDisplayCurrency";
import { useState } from "react";
import { BrainCircuit, FlaskConical, History, RotateCcw, Save, Send, ShieldAlert } from "lucide-react";
import { Btn, Chip, EmptyState, Input, PageHeader, Panel, PremiumPanel, Select, Skeleton, Tabs, useConfirm } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { fmtDateTime } from "@/lib/format";
import { usePoll } from "@/lib/hooks";
import { useApp } from "@/stores";
import { TIMEFRAMES, type Timeframe } from "@/lib/types";
import { ResearchReportView } from "@/components/research/ResearchReportView";
import { RESEARCH_STRATEGY_TYPES, type ResearchRun } from "@/lib/research/types";

interface ResearchResponse {
  run: ResearchRun;
  issues?: { path: string; message: string; severity: string }[];
  error?: string;
}

const STRATEGY_LABELS: Record<string, string> = {
  "chandelier-donchian": "Chandelier Exit + Donchian Ribbon (executable)",
  trend: "Trend Pullback (concept)",
  breakout: "Level Breakout (concept)",
  sr: "Support / Resistance Reaction (concept)",
  concept: "New concept (design from scratch)",
};

export default function ResearchPage() {
  useDisplayCurrency();
  const { settings, activeSymbol, timeframe, notify } = useApp();
  const [tab, setTab] = useState("new");

  // ---- form state ----
  const [symbol, setSymbol] = useState(activeSymbol);
  const [tf, setTf] = useState<Timeframe>(timeframe);
  const [strategyType, setStrategyType] = useState<string>("chandelier-donchian");
  const [objective, setObjective] = useState("");
  const [constraints, setConstraints] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<ResearchRun | null>(null);
  const [issues, setIssues] = useState<{ path: string; message: string; severity: string }[]>([]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!objective.trim()) return;
    setRunning(true);
    setError(null);
    try {
      const res = await api.post<ResearchResponse>("/api/research", {
        symbol, timeframe: tf, strategyType, objective: objective.trim(),
        constraints: constraints.trim(), provider: "auto",
      });
      setRun(res.run);
      setIssues(res.issues ?? []);
      if (res.run.status === "failed") {
        notify({ title: "Research failed", body: res.error ?? "The provider could not produce a report.", tone: "danger" });
      } else {
        notify({ title: "Research complete", body: `${res.run.symbol} ${res.run.timeframe} — report ready.`, tone: "success" });
      }
      setTab("new");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Research request failed.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="p-4 lg:p-6 space-y-4 page-shell">
      <PageHeader crumb="RESEARCH / AI STRATEGY ASSISTANT" title="AI strategy research"
        description="Describe a trading idea in plain English. The assistant proposes a structured, validated strategy hypothesis grounded in the real current market — then you test it before anything is risked."
        actions={<Chip tone="accent"><BrainCircuit size={11} /> HYPOTHESIS ENGINE</Chip>} />

      <Tabs active={tab} onChange={setTab} tabs={[
        { id: "new", label: "New research" },
        { id: "history", label: "Research history" },
      ]} />

      {tab === "new" ? (
        <div className="grid grid-cols-1 xl:grid-cols-[380px_1fr] gap-4 items-start">
          {/* -------- input form -------- */}
          <form onSubmit={submit} className="panel space-y-3 p-4">
            <p className="microlabel">SYMBOL</p>
            <Select value={symbol} onChange={(e) => setSymbol(e.target.value)} aria-label="Symbol">
              {settings.watchlist.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>

            <p className="microlabel">TIMEFRAME</p>
            <Select value={tf} onChange={(e) => setTf(e.target.value as Timeframe)} aria-label="Timeframe">
              {TIMEFRAMES.map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>

            <p className="microlabel">STRATEGY FAMILY</p>
            <Select value={strategyType} onChange={(e) => setStrategyType(e.target.value)} aria-label="Strategy type">
              {RESEARCH_STRATEGY_TYPES.map((t) => <option key={t} value={t}>{STRATEGY_LABELS[t]}</option>)}
            </Select>
            {strategyType !== "chandelier-donchian" && (
              <p className="text-[10px] text-warn leading-snug">
                Only “Chandelier Exit + Donchian Ribbon” maps onto the executable engine today. Other families are
                researched as readable hypotheses (research-only) and cannot be backtested yet.
              </p>
            )}

            <p className="microlabel">TRADING OBJECTIVE (PLAIN ENGLISH)</p>
            <textarea
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              rows={5}
              maxLength={2000}
              placeholder="e.g. Catch strong uptrends on BTC, enter on pullbacks, cut losses fast, and only trade during liquid hours."
              className="bg-bg2 border border-edge rounded px-2 py-2 text-[12px] text-ink placeholder:text-dim w-full focus:border-accent/50 outline-none resize-y"
              aria-label="Trading objective"
            />
            <p className="text-[9.5px] text-dim">{objective.length}/2000</p>

            <p className="microlabel">CONSTRAINTS (OPTIONAL)</p>
            <Input value={constraints} onChange={(e) => setConstraints(e.target.value)}
              maxLength={1000} placeholder="e.g. no more than 10× leverage, avoid high funding periods" aria-label="Constraints" />

            <Btn type="submit" variant="primary" disabled={running || objective.trim().length < 10} className="w-full">
              {running ? "RESEARCHING…" : "RUN RESEARCH"}
            </Btn>
            {error && <p className="text-[11px] text-dn">{error}</p>}
            <p className="text-[9.5px] text-dim leading-snug">
              The assistant reads the same real market data as your charts (demo or CoinDCX live) and returns a
              validated JSON report. It never sees your keys and can never place an order.
            </p>
          </form>

          {/* -------- result -------- */}
          <div className="min-w-0">
            {running ? (
              <PremiumPanel title="RESEARCHING" elevation={1}>
                <div className="p-4 space-y-2">
                  <Skeleton className="h-5 w-2/3" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-5/6" />
                  <Skeleton className="h-4 w-4/6" />
                  <p className="text-[11px] text-dim pt-2">
                    Reading market evidence and asking the configured AI provider…
                  </p>
                </div>
              </PremiumPanel>
            ) : run ? (
              <ResearchResult run={run} issues={issues} />
            ) : (
              <PremiumPanel title="RESEARCH REPORT" elevation={1}>
                <EmptyState icon={<FlaskConical size={20} />} title="No research yet"
                  hint="Describe an objective and run research. The structured report appears here." />
              </PremiumPanel>
            )}
          </div>
        </div>
      ) : (
        <ResearchHistory onOpen={(r) => { setRun(r); setTab("new"); }} />
      )}
    </div>
  );
}

/* ================= result + actions ================= */

function ResearchResult({ run, issues }: { run: ResearchRun; issues: { message: string }[] }) {
  const { notify } = useApp();
  const [promoting, setPromoting] = useState(false);
  const [confirm, confirmNode] = useConfirm();

  if (run.status === "failed") {
    return (
      <PremiumPanel title="RESEARCH FAILED" elevation={1} badge={<Chip tone="danger">FAILED</Chip>}>
        <div className="p-4 space-y-2">
          <p className="text-[12px] text-dn">{run.error ?? "The research request could not be completed."}</p>
          <p className="text-[11px] text-dim">
            Your objective and inputs are saved below and in history, so you can revise and retry. No provider quota
            was wasted on an invalid request.
          </p>
          <div className="rounded border border-edge bg-panel2/60 p-3">
            <p className="microlabel mb-1">PRESERVED INPUT</p>
            <p className="text-[11px] text-ink">{run.symbol} · {run.timeframe} · {run.strategyType}</p>
            <p className="text-[11px] text-mut mt-1">{run.objective}</p>
          </div>
        </div>
      </PremiumPanel>
    );
  }

  const report = run.report!;
  const executable = report.compatibility === "executable";

  async function promote() {
    const ok = await confirm({
      title: "Enable for paper trading?",
      body: (
        <div className="space-y-2">
          <p>This writes the validated configuration into the Paper workspace's Chandelier + Donchian settings, where the existing paper-trading engine and risk limits will use it.</p>
          <p className="text-dn">No order is placed. You will still place every paper order by hand, and live execution is never armed by this action.</p>
        </div>
      ),
      confirmLabel: "ENABLE FOR PAPER",
    });
    if (!ok) return;
    setPromoting(true);
    try {
      const res = await api.post<{ ok: boolean; message: string }>(`/api/research/${run.id}/promote`, {});
      notify({ title: "Enabled for paper trading", body: res.message, tone: "success" });
    } catch (e) {
      notify({ title: "Promotion blocked", body: e instanceof ApiError ? e.message : "Could not enable the strategy.", tone: "danger" });
    } finally {
      setPromoting(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone="accent">{run.symbol} · {run.timeframe}</Chip>
        <Chip tone={executable ? "up" : "warn"}>
          {executable ? "EXECUTABLE CONFIG" : "RESEARCH-ONLY"}
        </Chip>
        <Chip tone="default">{run.provider} · {run.model}</Chip>
        <span className="text-[10px] text-dim num">{fmtDateTime(new Date(run.createdAt).getTime())}</span>
        <div className="ml-auto flex flex-wrap gap-2">
          {executable && (
            <>
              <Btn size="sm" variant="primary" onClick={() => {
                const params = new URLSearchParams({ research: run.id });
                window.location.href = `/backtests?${params.toString()}`;
              }}>
                <Send size={12} /> SEND TO BACKTEST
              </Btn>
              <Btn size="sm" variant="outline" disabled={promoting} onClick={() => void promote()}>
                <Save size={12} /> ENABLE FOR PAPER
              </Btn>
            </>
          )}
          <Btn size="sm" variant="outline" onClick={() => {
            const params = new URLSearchParams({ revise: run.id, objective: run.objective });
            window.location.href = `/research?${params.toString()}`;
          }}>
            <RotateCcw size={12} /> REVISE
          </Btn>
        </div>
      </div>

      {issues.length > 0 && (
        <Panel title="VALIDATION" right={<Chip tone="warn">{issues.length}</Chip>}>
          <ul className="space-y-1 p-3">
            {issues.map((i, n) => (
              <li key={n} className="text-[10.5px] text-warn leading-snug">• {i.message}</li>
            ))}
          </ul>
        </Panel>
      )}

      <ResearchReportView report={report} />

      <Panel title="EXECUTABLE CONFIGURATION (ENGINE FORMAT)" right={
        executable ? <Chip tone="up">VALIDATED</Chip> : <Chip tone="default">NONE</Chip>
      }>
        {executable ? (
          <pre className="p-3 text-[10px] num text-mut overflow-x-auto leading-relaxed">
            {JSON.stringify(report.strategyConfig, null, 2)}
          </pre>
        ) : (
          <p className="p-3 text-[11px] text-dim">
            <ShieldAlert size={11} className="inline mr-1" />
            The hypothesis does not map onto the executable engine, so no configuration is produced. This is a
            compatibility warning, not a failure — the idea is still readable and comparable.
          </p>
        )}
      </Panel>

      {confirmNode}
    </div>
  );
}

/* ================= history ================= */

function ResearchHistory({ onOpen }: { onOpen: (r: ResearchRun) => void }) {
  useDisplayCurrency();
  const [filter, setFilter] = useState("");
  const { data, error, loading, refresh } = usePoll(
    () => api.get<{ runs: ResearchRun[] }>("/api/research?limit=100"),
    30000
  );

  const runs = (data?.runs ?? []).filter((r) =>
    !filter || r.symbol.includes(filter.toUpperCase()) || r.objective.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <PremiumPanel title="RESEARCH HISTORY" elevation={1} right={
      <div className="flex items-center gap-2">
        <Input placeholder="filter symbol or text…" value={filter}
          onChange={(e) => setFilter(e.target.value)} className="w-40 h-6.5" aria-label="Filter research" />
        <Btn size="sm" variant="ghost" onClick={() => void refresh()} aria-label="Refresh research history"><History size={12} /></Btn>
      </div>
    }>
      {loading ? (
        <div className="p-3 space-y-1.5">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8" />)}</div>
      ) : error ? (
        <p className="p-3 text-[11px] text-dn">{error}</p>
      ) : runs.length === 0 ? (
        <EmptyState icon={<History size={18} />} title="No research runs yet"
          hint="Completed and failed research runs are listed here so they can be reopened, compared and revised." />
      ) : (
        <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-panel">
              <tr className="text-left microlabel border-b border-edge">
                <th className="px-3 py-1.5 font-medium">WHEN</th>
                <th className="px-2 py-1.5 font-medium">SYMBOL</th>
                <th className="px-2 py-1.5 font-medium">TF</th>
                <th className="px-2 py-1.5 font-medium">FAMILY</th>
                <th className="px-2 py-1.5 font-medium">STATUS</th>
                <th className="px-2 py-1.5 font-medium">OBJECTIVE</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-b border-edge/50 hover:bg-panel2/40 cursor-pointer"
                  onClick={() => onOpen(r)}>
                  <td className="px-3 py-1.5 num text-dim whitespace-nowrap">{fmtDateTime(new Date(r.createdAt).getTime())}</td>
                  <td className="px-2 py-1.5 num">{r.symbol}</td>
                  <td className="px-2 py-1.5 num text-mut">{r.timeframe}</td>
                  <td className="px-2 py-1.5 text-mut">{r.strategyType}</td>
                  <td className="px-2 py-1.5">
                    <Chip tone={r.status === "completed" ? "up" : "dn"}>{r.status.toUpperCase()}</Chip>
                  </td>
                  <td className="px-2 py-1.5 text-mut max-w-[280px] truncate">{r.objective}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PremiumPanel>
  );
}
