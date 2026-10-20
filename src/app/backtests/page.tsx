"use client";
import { useDisplayCurrency } from "@/lib/useDisplayCurrency";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Beaker, ChevronRight, History, ShieldCheck, TriangleAlert } from "lucide-react";
import { Btn, Chip, EmptyState, HelpTip, Input, MetricCard, PageHeader, PremiumPanel, Select, Skeleton, Tabs, Toggle } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { cx, fmtDateTime, fmtPrice, fmtUsd } from "@/lib/format";
import { usePoll } from "@/lib/hooks";
import { useApp } from "@/stores";
import { TIMEFRAMES, type Timeframe } from "@/lib/types";
import { EquityCurve } from "@/components/backtests/EquityCurve";
import { DEFAULT_CHANDELIER_DONCHIAN_CONFIG, type BacktestResult, type ChandelierDonchianConfig } from "@/lib/strategy/v2/types";
import type { BacktestJob } from "@/lib/research/types";

interface CreateResponse {
  job: BacktestJob;
  deduplicated?: boolean;
  error?: string;
}

export default function BacktestsPage() {
  useDisplayCurrency();
  const { settings, notify } = useApp();
  const search = useSearchParams();
  const researchId = search.get("research");

  // ---- form state ----
  const [symbol, setSymbol] = useState("BTCUSD");
  const [timeframe, setTimeframe] = useState<Timeframe>("15m");
  const [config, setConfig] = useState<ChandelierDonchianConfig>(
    settings.chandelierDonchian ?? DEFAULT_CHANDELIER_DONCHIAN_CONFIG
  );
  const [capital, setCapital] = useState(settings.startingBalance || 10000);
  const [feeRate, setFeeRate] = useState(0.0005);
  const [slippage, setSlippage] = useState(0.0001);
  const [candleLimit, setCandleLimit] = useState(300);
  const [walkForward, setWalkForward] = useState(false);
  const [trainWindow, setTrainWindow] = useState(300);
  const [testWindow, setTestWindow] = useState(100);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<BacktestJob | null>(null);

  // Prefill from a research run when arriving via "Send to backtest".
  useEffect(() => {
    if (!researchId) return;
    let alive = true;
    api.get<{ run: { symbol: string; timeframe: string; report: { strategyConfig: ChandelierDonchianConfig | null; recommendedBars: number } | null } }>(`/api/research/${researchId}`)
      .then((res) => {
        if (!alive) return;
        const run = res.run;
        setSymbol(run.symbol);
        setTimeframe(run.timeframe as Timeframe);
        if (run.report?.strategyConfig) setConfig(run.report.strategyConfig);
        if (run.report?.recommendedBars) setCandleLimit(Math.min(500, Math.max(50, run.report.recommendedBars)));
        notify({ title: "Loaded research configuration", body: `${run.symbol} ${run.timeframe} — review and run the backtest.`, tone: "info" });
      })
      .catch(() => { if (alive) setError("Could not load the referenced research run."); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [researchId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setRunning(true);
    setError(null);
    try {
      const res = await api.post<CreateResponse>("/api/backtests", {
        symbol, timeframe, config, capital, feeRate, slippage,
        candleLimit, walkForward,
        trainWindow: walkForward ? trainWindow : 300,
        testWindow: walkForward ? testWindow : 100,
        researchRunId: researchId,
      });
      setJob(res.job);
      if (res.error) notify({ title: "Backtest failed", body: res.error, tone: "danger" });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Backtest request failed.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="p-4 lg:p-6 space-y-4 page-shell">
      <PageHeader crumb="RESEARCH / BACKTESTING" title="Backtesting"
        description="Test a validated strategy configuration against real historical candles. Closed-bar signals, next-open fills, fees and slippage applied — no curve-fitting, no invented prices."
        actions={<Chip tone="accent"><Beaker size={11} /> ENGINE {settings.dataSource === "demo" ? "DEMO CANDLES" : "COINDCX CANDLES"}</Chip>} />

      <Tabs active={job ? "result" : "new"} onChange={(t) => { if (t === "new") setJob(null); }} tabs={[
        { id: "new", label: job ? "New backtest" : "Configure" },
        ...(job ? [{ id: "result", label: "Results" }] : []),
        { id: "history", label: "History" },
      ]} />

      {(!job) && (
        <div className="grid grid-cols-1 xl:grid-cols-[380px_1fr] gap-4 items-start">
          <form onSubmit={submit} className="panel space-y-3 p-4">
            <p className="microlabel">SYMBOL</p>
            <Select value={symbol} onChange={(e) => setSymbol(e.target.value)} aria-label="Symbol">
              {settings.watchlist.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>

            <p className="microlabel">TIMEFRAME</p>
            <Select value={timeframe} onChange={(e) => setTimeframe(e.target.value as Timeframe)} aria-label="Timeframe">
              {TIMEFRAMES.map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>

            <p className="microlabel">CANDLES (MAX 500)</p>
            <Input type="number" min={50} max={500} value={candleLimit}
              onChange={(e) => setCandleLimit(parseInt(e.target.value, 10) || 300)} aria-label="Candle count" />

            <div className="rounded border border-edge bg-panel2/40 p-3 space-y-2">
              <p className="microlabel">CHANDELIER EXIT</p>
              <div className="grid grid-cols-2 gap-2">
                <label className="block space-y-1">
                  <span className="microlabel">ATR LENGTH</span>
                  <Input type="number" min={1} max={400} value={config.chandelier.atrLength}
                    onChange={(e) => setConfig({ ...config, chandelier: { ...config.chandelier, atrLength: parseInt(e.target.value, 10) || 1 } })} />
                </label>
                <label className="block space-y-1">
                  <span className="microlabel">MULTIPLIER</span>
                  <Input type="number" step="0.1" min={0.1} max={10} value={config.chandelier.multiplier}
                    onChange={(e) => setConfig({ ...config, chandelier: { ...config.chandelier, multiplier: parseFloat(e.target.value) || 2 } })} />
                </label>
              </div>
            </div>

            <div className="rounded border border-edge bg-panel2/40 p-3 space-y-2">
              <p className="microlabel">DONCHIAN PERIODS (COMMA-SEPARATED, MAX 8)</p>
              <Input value={config.donchian.periods.join(", ")}
                onChange={(e) => {
                  const periods = e.target.value.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n) && n >= 1 && n <= 400).slice(0, 8);
                  if (periods.length) setConfig({ ...config, donchian: { periods } });
                }} />
            </div>

            <div className="flex items-center justify-between">
              <span className="text-[11px] text-mut">Heikin-Ashi smoothing</span>
              <Toggle checked={config.heikinAshi} label="Heikin-Ashi"
                onChange={(v) => setConfig({ ...config, heikinAshi: v })} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-mut">Time stop</span>
              <Toggle checked={config.timeStop.enabled} label="Time stop"
                onChange={(v) => setConfig({ ...config, timeStop: { ...config.timeStop, enabled: v } })} />
            </div>
            {config.timeStop.enabled && (
              <label className="block space-y-1">
                <span className="microlabel">TIME-STOP BARS</span>
                <Input type="number" min={1} max={10000} value={config.timeStop.bars}
                  onChange={(e) => setConfig({ ...config, timeStop: { ...config.timeStop, bars: parseInt(e.target.value, 10) || 48 } })} />
              </label>
            )}

            <div className="grid grid-cols-2 gap-2">
              <label className="block space-y-1">
                <span className="microlabel">LEVERAGE (1–50)</span>
                <Input type="number" min={1} max={50} value={config.risk.leverage}
                  onChange={(e) => setConfig({ ...config, risk: { ...config.risk, leverage: parseFloat(e.target.value) || 10 } })} />
              </label>
              <label className="block space-y-1">
                <span className="microlabel">RISK % / TRADE</span>
                <Input type="number" step="0.1" min={0.01} max={100} value={config.risk.riskPct}
                  onChange={(e) => setConfig({ ...config, risk: { ...config.risk, riskPct: parseFloat(e.target.value) || 1 } })} />
              </label>
            </div>

            <div className="rounded border border-edge bg-panel2/40 p-3 space-y-2">
              <p className="microlabel">ASSUMPTIONS</p>
              <div className="grid grid-cols-3 gap-2">
                <label className="block space-y-1">
                  <span className="microlabel">CAPITAL</span>
                  <Input type="number" min={1} value={capital}
                    onChange={(e) => setCapital(parseFloat(e.target.value) || 10000)} />
                </label>
                <label className="block space-y-1">
                  <span className="microlabel">FEE RATE</span>
                  <Input type="number" step="0.0001" min={0} max={0.05} value={feeRate}
                    onChange={(e) => setFeeRate(parseFloat(e.target.value) || 0)} />
                </label>
                <label className="block space-y-1">
                  <span className="microlabel">SLIPPAGE</span>
                  <Input type="number" step="0.0001" min={0} max={0.05} value={slippage}
                    onChange={(e) => setSlippage(parseFloat(e.target.value) || 0)} />
                </label>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-[11px] text-mut">Walk-forward (out-of-sample)</span>
              <Toggle checked={walkForward} label="Walk-forward"
                onChange={(v) => setWalkForward(v)} />
            </div>
            {walkForward && (
              <div className="grid grid-cols-2 gap-2">
                <label className="block space-y-1">
                  <span className="microlabel">TRAIN BARS</span>
                  <Input type="number" min={50} max={500} value={trainWindow}
                    onChange={(e) => setTrainWindow(parseInt(e.target.value, 10) || 300)} />
                </label>
                <label className="block space-y-1">
                  <span className="microlabel">TEST BARS</span>
                  <Input type="number" min={20} max={500} value={testWindow}
                    onChange={(e) => setTestWindow(parseInt(e.target.value, 10) || 100)} />
                </label>
              </div>
            )}

            <Btn type="submit" variant="primary" disabled={running} className="w-full">
              {running ? "RUNNING…" : walkForward ? "START WALK-FORWARD" : "RUN BACKTEST"}
            </Btn>
            {error && <p className="text-[11px] text-dn">{error}</p>}
          </form>

          <AssumptionsPanel />
        </div>
      )}

      {job && <BacktestResultView job={job} onNew={() => setJob(null)} />}

      {(!job) && <HistoryPanel />}
    </div>
  );
}

/* ================= assumptions ================= */

function AssumptionsPanel() {
  return (
    <PremiumPanel title="FILL MODEL & ASSUMPTIONS" elevation={1}>
      <div className="p-3 space-y-2 text-[11px] text-mut leading-snug">
        <p><strong className="text-ink">Fill model:</strong> signals are evaluated on closed candles only; an order fills at the NEXT real candle's open. Trailing stops are checked against the prior bar, and a gap through a stop fills at the worse opening price. No synthetic fills, no intra-bar price invention.</p>
        <p><strong className="text-ink">Costs:</strong> fees and slippage are charged on both entry and exit at the rates above.</p>
        <p><strong className="text-ink">Look-ahead:</strong> a bar's own high/low/close can never influence a decision made at that bar.</p>
        <p><strong className="text-ink">Walk-forward:</strong> fixed-parameter rolling validation — parameters are NOT refit per fold, so this is validation, not optimisation.</p>
        <p className="text-warn flex items-start gap-1.5">
          <TriangleAlert size={11} className="flex-none mt-0.5" />
          A profitable backtest is historical evidence, not a promise. It does not guarantee future profit and does not by itself promote a strategy to paper trading.
        </p>
      </div>
    </PremiumPanel>
  );
}

/* ================= result ================= */

function BacktestResultView({ job, onNew }: { job: BacktestJob; onNew: () => void }) {
  useDisplayCurrency();
  const { notify } = useApp();
  const [live, setLive] = useState(job);
  const [stepping, setStepping] = useState(false);

  // Poll while the job is queued/running.
  usePoll(
    async () => {
      if (live.status === "completed" || live.status === "failed") return live;
      const res = await api.get<{ job: BacktestJob }>(`/api/backtests/${live.id}`);
      setLive(res.job);
      return res.job;
    },
    live.status === "running" || live.status === "queued" ? 2000 : 60000,
    { enabled: live.status === "running" || live.status === "queued" }
  );

  async function step() {
    setStepping(true);
    try {
      const res = await api.post<CreateResponse>(`/api/backtests/${live.id}/step`, {});
      setLive(res.job);
      if (res.job.status === "completed") {
        notify({ title: "Walk-forward complete", body: "All folds evaluated.", tone: "success" });
      }
    } catch (e) {
      notify({ title: "Step failed", body: e instanceof ApiError ? e.message : "Could not advance the backtest.", tone: "danger" });
    } finally {
      setStepping(false);
    }
  }

  const isRunning = live.status === "running" || live.status === "queued";
  const r = live.result;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={live.status === "completed" ? "up" : live.status === "failed" ? "dn" : "warn"}>
          {live.status.toUpperCase()}
        </Chip>
        <Chip tone="default">{live.symbol} · {live.timeframe}</Chip>
        <Chip tone="default">{live.candleLimit} bars</Chip>
        {live.walkForward && <Chip tone="accent">WALK-FORWARD {live.segmentsDone}/{live.segmentsTotal}</Chip>}
        <span className="text-[10px] text-dim num">{fmtDateTime(new Date(live.createdAt).getTime())}</span>
        <div className="ml-auto flex gap-2">
          {isRunning && live.walkForward && (
            <Btn size="sm" variant="primary" disabled={stepping} onClick={() => void step()}>
              RUN NEXT FOLD <ChevronRight size={12} />
            </Btn>
          )}
          <Btn size="sm" variant="outline" onClick={onNew}>NEW BACKTEST</Btn>
        </div>
      </div>

      {live.status === "failed" ? (
        <PremiumPanel title="BACKTEST FAILED" elevation={1} badge={<Chip tone="danger">FAILED</Chip>}>
          <p className="p-3 text-[12px] text-dn">{live.error ?? "The backtest could not be completed."}</p>
          {live.dataWarnings.length > 0 && (
            <ul className="px-3 pb-3 space-y-1">
              {live.dataWarnings.map((w, i) => <li key={i} className="text-[11px] text-warn">• {w}</li>)}
            </ul>
          )}
        </PremiumPanel>
      ) : isRunning ? (
        <PremiumPanel title="RUNNING" elevation={1}>
          <div className="p-4 space-y-2">
            <div className="h-2 rounded bg-panel2 overflow-hidden">
              <div className="h-full bg-accent transition-all"
                style={{ width: `${live.segmentsTotal ? (live.segmentsDone / live.segmentsTotal) * 100 : 0}%` }} />
            </div>
            <p className="text-[11px] text-dim">
              Segment {live.segmentsDone} of {live.segmentsTotal}
              {live.walkForward ? " (walk-forward fold)" : ""}…
            </p>
          </div>
        </PremiumPanel>
      ) : r ? (
        <>
          <MetricsGrid result={r} />
          <PremiumPanel title="EQUITY CURVE" elevation={1}>
            <EquityCurve data={r.equityCurve} />
          </PremiumPanel>
          {live.walkForward && live.segmentResults && live.segmentResults.length > 1 && (
            <OutofSampleTable folds={live.segmentResults} />
          )}
          <TradeHistory result={r} />
          <DetailsPanel job={live} />
        </>
      ) : null}
    </div>
  );
}

function MetricsGrid({ result }: { result: BacktestResult }) {
  const cards: { label: string; value: string; tone?: "up" | "dn" | "accent"; help?: string }[] = [
    { label: "NET PROFIT", value: fmtUsd(result.netProfit, { sign: true }), tone: result.netProfit >= 0 ? "up" : "dn" },
    { label: "NET RETURN", value: `${result.netReturnPct >= 0 ? "+" : ""}${result.netReturnPct.toFixed(2)}%`, tone: result.netReturnPct >= 0 ? "up" : "dn" },
    { label: "ENDING EQUITY", value: fmtUsd(result.endingEquity) },
    { label: "TOTAL TRADES", value: String(result.totalTrades) },
    { label: "WIN RATE", value: `${result.winRate.toFixed(1)}%` },
    { label: "PROFIT FACTOR", value: result.profitFactor?.toFixed(2) ?? "n/a", help: "profitFactor" },
    { label: "MAX DRAWDOWN", value: `${result.maxDrawdownPct.toFixed(1)}%`, tone: "dn" },
    { label: "EXPECTANCY", value: fmtUsd(result.expectancy, { sign: true, decimals: 2 }), tone: result.expectancy >= 0 ? "up" : "dn" },
    { label: "AVG WIN", value: fmtUsd(result.avgWin), tone: "up" },
    { label: "AVG LOSS", value: fmtUsd(-result.avgLoss), tone: "dn" },
    { label: "FEES", value: fmtUsd(result.fees) },
    { label: "SLIPPAGE", value: fmtUsd(result.slippageCost) },
    { label: "WIN / LOSS", value: `${result.winningTrades} / ${result.losingTrades}` },
    { label: "AVG HOLD", value: `${result.avgHoldBars.toFixed(0)} bars` },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
      {cards.map((c) => (
        <MetricCard key={c.label} label={c.label} value={c.value} tone={c.tone} help={c.help} />
      ))}
    </div>
  );
}

function OutofSampleTable({ folds }: { folds: BacktestResult[] }) {
  return (
    <PremiumPanel title="OUT-OF-SAMPLE FOLDS" elevation={1}
      right={<Chip tone="accent"><ShieldCheck size={11} /> OOS</Chip>}>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead className="border-b border-edge">
            <tr className="text-left microlabel">
              <th className="px-3 py-1.5 font-medium">FOLD</th>
              <th className="px-2 py-1.5 font-medium text-right">TRADES</th>
              <th className="px-2 py-1.5 font-medium text-right">WIN %</th>
              <th className="px-2 py-1.5 font-medium text-right">NET P&L</th>
              <th className="px-2 py-1.5 font-medium text-right">MAX DD</th>
            </tr>
          </thead>
          <tbody>
            {folds.map((f, i) => (
              <tr key={i} className="border-b border-edge/50">
                <td className="px-3 py-1.5 num text-dim">#{i + 1}</td>
                <td className="px-2 py-1.5 num text-right">{f.totalTrades}</td>
                <td className="px-2 py-1.5 num text-right">{f.winRate.toFixed(0)}%</td>
                <td className={cx("px-2 py-1.5 num text-right", f.netProfit >= 0 ? "text-up" : "text-dn")}>
                  {fmtUsd(f.netProfit, { sign: true })}
                </td>
                <td className="px-2 py-1.5 num text-right text-dn">{f.maxDrawdownPct.toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-3 pb-3 text-[10px] text-dim">
        Each fold is evaluated on data its parameters were never fitted to (fixed parameters throughout).
        The combined view above aggregates these out-of-sample trades.
      </p>
    </PremiumPanel>
  );
}

function TradeHistory({ result }: { result: BacktestResult }) {
  const { settings } = useApp();
  const trades = [...result.trades].reverse();
  return (
    <PremiumPanel title={`TRADE HISTORY (${result.trades.length})`} elevation={1}>
      {trades.length === 0 ? (
        <EmptyState icon={<History size={18} />} title="No trades"
          hint="The configuration produced no signals in this period, or every signal was filtered by the stop geometry." />
      ) : (
        <div className="overflow-x-auto max-h-[360px] overflow-y-auto">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-panel">
              <tr className="text-left microlabel border-b border-edge">
                <th className="px-3 py-1.5 font-medium">ENTRY</th>
                <th className="px-2 py-1.5 font-medium">SIDE</th>
                <th className="px-2 py-1.5 font-medium text-right">ENTRY $</th>
                <th className="px-2 py-1.5 font-medium text-right">EXIT $</th>
                <th className="px-2 py-1.5 font-medium text-right">QTY</th>
                <th className="px-2 py-1.5 font-medium text-right">P&L</th>
                <th className="px-2 py-1.5 font-medium">EXIT REASON</th>
                <th className="px-2 py-1.5 font-medium text-right">BARS</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t, i) => (
                <tr key={i} className="border-b border-edge/50">
                  <td className="px-3 py-1.5 num text-dim whitespace-nowrap">{fmtDateTime(new Date(t.entryTime * 1000).getTime(), settings.timezone)}</td>
                  <td className="px-2 py-1.5">
                    <Chip tone={t.side === "long" ? "up" : "dn"}>{t.side.toUpperCase()}</Chip>
                  </td>
                  <td className="px-2 py-1.5 num text-right">{fmtPrice(t.entryPrice)}</td>
                  <td className="px-2 py-1.5 num text-right">{fmtPrice(t.exitPrice)}</td>
                  <td className="px-2 py-1.5 num text-right">{t.qty.toFixed(4)}</td>
                  <td className={cx("px-2 py-1.5 num text-right", t.pnl >= 0 ? "text-up" : "text-dn")}>
                    {fmtUsd(t.pnl, { sign: true })}
                  </td>
                  <td className="px-2 py-1.5 text-mut">{t.exitReason.replace(/_/g, " ")}</td>
                  <td className="px-2 py-1.5 num text-right text-dim">{t.barsHeld}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PremiumPanel>
  );
}

function DetailsPanel({ job }: { job: BacktestJob }) {
  return (
    <PremiumPanel title="CONFIGURATION & ASSUMPTIONS" elevation={1}
      right={<Chip tone="default"><HelpTip topic="backtestConfig" /> v{job.result?.configVersion ?? "?"}</Chip>}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 p-3 text-[11px]">
        <Detail k="Symbol" v={`${job.symbol} · ${job.timeframe}`} />
        <Detail k="Capital" v={fmtUsd(job.capital)} />
        <Detail k="Leverage" v={`${job.config.risk.leverage}×`} />
        <Detail k="Risk / trade" v={`${job.config.risk.riskPct}%`} />
        <Detail k="ATR length × multiplier" v={`${job.config.chandelier.atrLength} × ${job.config.chandelier.multiplier}`} />
        <Detail k="Donchian periods" v={job.config.donchian.periods.join(" / ")} />
        <Detail k="Heikin-Ashi" v={job.config.heikinAshi ? "on" : "off"} />
        <Detail k="Time stop" v={job.config.timeStop.enabled ? `${job.config.timeStop.bars} bars` : "off"} />
        <Detail k="Fee rate" v={`${(job.feeRate * 100).toFixed(3)}% per side`} />
        <Detail k="Slippage" v={`${(job.slippage * 100).toFixed(3)}% per side`} />
        <Detail k="Walk-forward" v={job.walkForward ? `${job.trainWindow} train / ${job.testWindow} test` : "off"} />
        <Detail k="Engine version" v={job.result?.configVersion ?? "—"} />
      </div>
      <div className="px-3 pb-3">
        <p className="microlabel mb-1">FILL MODEL</p>
        <p className="text-[10.5px] text-mut leading-snug">{job.fillModel}</p>
      </div>
      {job.dataWarnings.length > 0 && (
        <div className="px-3 pb-3">
          <p className="microlabel mb-1 text-warn">DATA-QUALITY WARNINGS</p>
          <ul className="space-y-0.5">
            {job.dataWarnings.map((w, i) => (
              <li key={i} className="text-[10.5px] text-warn leading-snug">• {w}</li>
            ))}
          </ul>
        </div>
      )}
    </PremiumPanel>
  );
}

function Detail({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-0.5 border-b border-edge/30">
      <span className="text-dim">{k}</span>
      <span className="num text-ink">{v}</span>
    </div>
  );
}

/* ================= history ================= */

function HistoryPanel() {
  useDisplayCurrency();
  const [filter, setFilter] = useState("");
  const { data, error, loading, refresh } = usePoll(
    () => api.get<{ jobs: BacktestJob[] }>("/api/backtests?limit=100"),
    30000
  );
  const jobs = (data?.jobs ?? []).filter((j) =>
    !filter || j.symbol.includes(filter.toUpperCase()) || j.id.includes(filter)
  );

  return (
    <PremiumPanel title="BACKTEST HISTORY" elevation={1} right={
      <div className="flex items-center gap-2">
        <Input placeholder="filter symbol or id…" value={filter}
          onChange={(e) => setFilter(e.target.value)} className="w-40 h-6.5" aria-label="Filter backtests" />
        <Btn size="sm" variant="ghost" onClick={() => void refresh()} aria-label="Refresh backtests"><History size={12} /></Btn>
      </div>
    }>
      {loading ? (
        <div className="p-3 space-y-1.5">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8" />)}</div>
      ) : error ? (
        <p className="p-3 text-[11px] text-dn">{error}</p>
      ) : jobs.length === 0 ? (
        <EmptyState icon={<Beaker size={18} />} title="No backtests yet"
          hint="Every run is persisted with its full configuration so it can be reproduced and compared." />
      ) : (
        <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-panel">
              <tr className="text-left microlabel border-b border-edge">
                <th className="px-3 py-1.5 font-medium">WHEN</th>
                <th className="px-2 py-1.5 font-medium">SYMBOL</th>
                <th className="px-2 py-1.5 font-medium">TF</th>
                <th className="px-2 py-1.5 font-medium">TYPE</th>
                <th className="px-2 py-1.5 font-medium">TRADES</th>
                <th className="px-2 py-1.5 font-medium text-right">NET P&L</th>
                <th className="px-2 py-1.5 font-medium">STATUS</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} className="border-b border-edge/50">
                  <td className="px-3 py-1.5 num text-dim whitespace-nowrap">{fmtDateTime(new Date(j.createdAt).getTime())}</td>
                  <td className="px-2 py-1.5 num">{j.symbol}</td>
                  <td className="px-2 py-1.5 num text-mut">{j.timeframe}</td>
                  <td className="px-2 py-1.5 text-mut">{j.walkForward ? "walk-forward" : "full"}</td>
                  <td className="px-2 py-1.5 num">{j.result?.totalTrades ?? "—"}</td>
                  <td className={cx("px-2 py-1.5 num text-right", (j.result?.netProfit ?? 0) >= 0 ? "text-up" : "text-dn")}>
                    {j.result ? fmtUsd(j.result.netProfit, { sign: true }) : "—"}
                  </td>
                  <td className="px-2 py-1.5">
                    <Chip tone={j.status === "completed" ? "up" : j.status === "failed" ? "dn" : "warn"}>
                      {j.status.toUpperCase()}
                    </Chip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PremiumPanel>
  );
}
