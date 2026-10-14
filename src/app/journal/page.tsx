"use client";
import { useMemo, useState } from "react";
import { BookOpen, Download, Pencil, Plus, Trash2 } from "lucide-react";
import { Btn, Chip, EmptyState, Input, MetricCard, PageHeader, Modal, Panel, Select, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { cx, fmtDateTime, fmtDuration, fmtPrice, fmtUsd } from "@/lib/format";
import { usePoll } from "@/lib/hooks";
import { useApp } from "@/stores";
import type { JournalEntry } from "@/lib/types";

interface Row extends Omit<JournalEntry, "openedAt" | "closedAt"> {
  id: string;
  openedAt: string;
  closedAt: string | null;
}

export default function JournalPage() {
  const { settings, notify, patchSettings } = useApp();
  const [fSymbol, setFSymbol] = useState("");
  const [fMode, setFMode] = useState("");
  const [fDir, setFDir] = useState("");
  const [editing, setEditing] = useState<Row | null>(null);
  const [adding, setAdding] = useState(false);
  const { data, refresh, loading } = usePoll(
    () => api.get<{ entries: Row[] }>(`/api/journal${fSymbol ? `?symbol=${fSymbol}` : ""}`),
    30000, { deps: [fSymbol] }
  );

  const entries = useMemo(() => {
    let rows = data?.entries ?? [];
    if (fMode) rows = rows.filter((r) => r.mode === fMode);
    if (fDir) rows = rows.filter((r) => r.direction === fDir);
    return rows;
  }, [data, fMode, fDir]);

  const closed = entries.filter((e) => e.exit !== null);
  const wins = closed.filter((e) => e.pnl > 0);
  const losses = closed.filter((e) => e.pnl <= 0);
  const net = closed.reduce((a, e) => a + e.pnl, 0);
  const grossWin = wins.reduce((a, e) => a + e.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((a, e) => a + e.pnl, 0));

  const exportCsv = () => {
    const head = "symbol,direction,mode,entry,exit,qty,fees,pnl,strategy,opened,closed,reason,tags";
    const lines = entries.map((e) =>
      [e.symbol, e.direction, e.mode, e.entry, e.exit ?? "", e.qty, e.fees, e.pnl, e.strategy,
        e.openedAt, e.closedAt ?? "", `"${(e.reason ?? "").replace(/"/g, "'")}"`, `"${(e.tags ?? []).join("|")}"`].join(",")
    );
    const blob = new Blob([[head, ...lines].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trade-journal-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const seed = async () => {
    try {
      await api.post("/api/journal", { action: "seed" });
      await patchSettings({ seededDemo: true }, false);
      notify({ title: "Sample data loaded", body: "26 annotated sample trades added to the journal.", tone: "success" });
      refresh();
    } catch (e) {
      notify({ title: "Seeding failed", body: e instanceof Error ? e.message : "", tone: "danger" });
    }
  };

  return (
    <div className="p-4 lg:p-6 space-y-4 max-w-[1500px] mx-auto">
      <PageHeader crumb="TRADING / JOURNAL" title="Trading journal"
        description="Every closed trade with its size, reason and outcome. This is the record you review, not a scoreboard to admire." />

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2">
        <MetricCard label="TRADES" value={String(closed.length)} />
        <MetricCard label="WIN RATE" value={closed.length ? `${((wins.length / closed.length) * 100).toFixed(0)}%` : "—"}
          tone={wins.length >= losses.length ? "up" : "dn"} />
        <MetricCard label="NET P&L" value={fmtUsd(net, { sign: true })} tone={net > 0 ? "up" : net < 0 ? "dn" : "flat"} />
        <MetricCard label="AVG WIN" value={wins.length ? fmtUsd(grossWin / wins.length) : "—"} tone="up" />
        <MetricCard label="AVG LOSS" value={losses.length ? fmtUsd(-grossLoss / losses.length) : "—"} tone="dn" />
        <MetricCard label="PROFIT FACTOR" value={grossLoss > 0 ? (grossWin / grossLoss).toFixed(2) : "∞"} />
      </div>

      <Panel
        title="TRADE JOURNAL"
        right={<Btn variant="primary" onClick={() => setAdding(true)}><Plus size={11} /> ADD TRADE</Btn>}
      >
        {/* Filter toolbar lives in the body, not the fixed-height panel header:
            five controls in the header wrapped and overlapped the table. */}
        <div className="flex items-center gap-1.5 flex-wrap px-3 py-2 border-b border-edge">
          <Input placeholder="symbol" value={fSymbol} onChange={(e) => setFSymbol(e.target.value.toUpperCase())} className="w-24 h-6.5" />
          <Select value={fMode} onChange={(e) => setFMode(e.target.value)} className="h-6.5">
            <option value="">all modes</option>
            <option value="demo">demo</option>
            <option value="paper">paper</option>
            <option value="live">live</option>
          </Select>
          <Select value={fDir} onChange={(e) => setFDir(e.target.value)} className="h-6.5">
            <option value="">all directions</option>
            <option value="long">long</option>
            <option value="short">short</option>
          </Select>
          <Btn onClick={exportCsv} disabled={entries.length === 0}><Download size={11} /> CSV</Btn>
        </div>
        {loading && !data ? (
          <div className="p-3 space-y-1.5">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-6" />)}</div>
        ) : entries.length === 0 ? (
          <EmptyState
            icon={<BookOpen size={18} />}
            title="No journal entries yet"
            hint="Paper trades are recorded automatically when positions close. You can also add trades manually or load annotated sample data."
            action={!settings.seededDemo ? <Btn onClick={() => void seed()}>LOAD SAMPLE DATA</Btn> : undefined}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-left microlabel border-b border-edge">
                  <th className="px-3 py-1.5 font-medium">OPENED</th>
                  <th className="px-2 py-1.5 font-medium">SYMBOL</th>
                  <th className="px-2 py-1.5 font-medium">DIR</th>
                  <th className="px-2 py-1.5 font-medium text-right">ENTRY</th>
                  <th className="px-2 py-1.5 font-medium text-right">EXIT</th>
                  <th className="px-2 py-1.5 font-medium text-right">QTY</th>
                  <th className="px-2 py-1.5 font-medium text-right">NET P&L</th>
                  <th className="px-2 py-1.5 font-medium">STRATEGY</th>
                  <th className="px-2 py-1.5 font-medium hidden md:table-cell">DURATION</th>
                  <th className="px-2 py-1.5 font-medium">MODE</th>
                  <th className="px-2 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="border-b border-edge/50 hover:bg-panel2/50">
                    <td className="px-3 py-1.5 num text-dim">{fmtDateTime(new Date(e.openedAt).getTime(), settings.timezone)}</td>
                    <td className="px-2 py-1.5 num">{e.symbol}</td>
                    <td className={cx("px-2 py-1.5", e.direction === "long" ? "text-up" : "text-dn")}>{e.direction.toUpperCase()}</td>
                    <td className="px-2 py-1.5 num text-right">{fmtPrice(e.entry)}</td>
                    <td className="px-2 py-1.5 num text-right">{e.exit !== null ? fmtPrice(e.exit) : "—"}</td>
                    <td className="px-2 py-1.5 num text-right">{e.qty}</td>
                    <td className={cx("px-2 py-1.5 num text-right", e.pnl > 0 ? "text-up" : e.pnl < 0 ? "text-dn" : "")}>
                      {e.exit !== null ? `${e.pnl > 0 ? "+" : ""}${e.pnl.toFixed(2)}` : "open"}
                    </td>
                    <td className="px-2 py-1.5 text-mut">{e.strategy || "—"}</td>
                    <td className="px-2 py-1.5 num text-dim hidden md:table-cell">
                      {e.closedAt ? fmtDuration(new Date(e.closedAt).getTime() - new Date(e.openedAt).getTime()) : "—"}
                    </td>
                    <td className="px-2 py-1.5"><Chip>{e.mode.toUpperCase()}</Chip></td>
                    <td className="px-2 py-1.5 text-right whitespace-nowrap">
                      <button onClick={() => setEditing(e)} aria-label="Edit entry" className="text-dim hover:text-ink p-1"><Pencil size={12} /></button>
                      <button
                        aria-label="Delete entry"
                        onClick={() => {
                          if (window.confirm("Delete this journal entry?")) {
                            void api.del(`/api/journal?id=${e.id}`).then(refresh);
                          }
                        }}
                        className="text-dim hover:text-dn p-1"
                      >
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {editing && <EditModal entry={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />}
      {adding && <AddModal onClose={() => setAdding(false)} onSaved={() => { setAdding(false); refresh(); }} />}
    </div>
  );
}

function EditModal({ entry, onClose, onSaved }: { entry: Row; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    strategy: entry.strategy, reason: entry.reason, notes: entry.notes,
    emotion: entry.emotion, tags: (entry.tags ?? []).join(", "),
  });
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    await api.patch("/api/journal", {
      id: entry.id, ...form, tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
    }).catch(() => undefined);
    setSaving(false);
    onSaved();
  };
  return (
    <Modal open onClose={onClose} title={`EDIT TRADE — ${entry.symbol}`}>
      <div className="space-y-2.5">
        <label className="block space-y-1"><span className="microlabel">STRATEGY</span>
          <Select className="w-full" value={form.strategy} onChange={(e) => setForm({ ...form, strategy: e.target.value })}>
            {["", "trend", "breakout", "sr", "manual", "paper"].map((s) => <option key={s} value={s}>{s || "none"}</option>)}
          </Select></label>
        <label className="block space-y-1"><span className="microlabel">REASON / SETUP</span>
          <Input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></label>
        <label className="block space-y-1"><span className="microlabel">NOTES</span>
          <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
            className="bg-bg2 border border-edge rounded px-2 py-1.5 text-[12px] w-full h-20 outline-none focus:border-accent/50" /></label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block space-y-1"><span className="microlabel">EMOTION</span>
            <Select className="w-full" value={form.emotion} onChange={(e) => setForm({ ...form, emotion: e.target.value })}>
              {["", "calm", "focused", "confident", "hesitant", "rushed", "fomo", "disciplined"].map((s) => <option key={s} value={s}>{s || "none"}</option>)}
            </Select></label>
          <label className="block space-y-1"><span className="microlabel">TAGS (COMMA-SEP)</span>
            <Input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} /></label>
        </div>
        <p className="text-[9.5px] text-dim">Raw entry/exit figures are preserved — editing annotations never alters the trade record.</p>
        <div className="flex justify-end gap-2">
          <Btn variant="ghost" onClick={onClose}>CANCEL</Btn>
          <Btn variant="primary" onClick={() => void save()} disabled={saving}>{saving ? "SAVING…" : "SAVE"}</Btn>
        </div>
      </div>
    </Modal>
  );
}

function AddModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    symbol: "BTCUSD", direction: "long", entry: "", exit: "", qty: "", pnl: "", strategy: "manual", reason: "",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const save = async () => {
    setSaving(true);
    setErr("");
    try {
      await api.post("/api/journal", {
        ...form,
        entry: parseFloat(form.entry), exit: form.exit ? parseFloat(form.exit) : null,
        qty: parseFloat(form.qty), pnl: parseFloat(form.pnl) || 0,
      });
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal open onClose={onClose} title="ADD TRADE MANUALLY">
      <div className="space-y-2.5">
        <div className="grid grid-cols-2 gap-2">
          <label className="block space-y-1"><span className="microlabel">SYMBOL</span>
            <Input value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value.toUpperCase() })} /></label>
          <label className="block space-y-1"><span className="microlabel">DIRECTION</span>
            <Select className="w-full" value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })}>
              <option value="long">long</option><option value="short">short</option>
            </Select></label>
          <label className="block space-y-1"><span className="microlabel">ENTRY</span>
            <Input inputMode="decimal" value={form.entry} onChange={(e) => setForm({ ...form, entry: e.target.value })} /></label>
          <label className="block space-y-1"><span className="microlabel">EXIT (OPT)</span>
            <Input inputMode="decimal" value={form.exit} onChange={(e) => setForm({ ...form, exit: e.target.value })} /></label>
          <label className="block space-y-1"><span className="microlabel">QTY</span>
            <Input inputMode="decimal" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} /></label>
          <label className="block space-y-1"><span className="microlabel">NET P&L ($)</span>
            <Input inputMode="decimal" value={form.pnl} onChange={(e) => setForm({ ...form, pnl: e.target.value })} /></label>
        </div>
        <label className="block space-y-1"><span className="microlabel">REASON</span>
          <Input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></label>
        {err && <p className="text-[10px] text-dn">{err}</p>}
        <div className="flex justify-end gap-2">
          <Btn variant="ghost" onClick={onClose}>CANCEL</Btn>
          <Btn variant="primary" onClick={() => void save()} disabled={saving}>{saving ? "SAVING…" : "ADD"}</Btn>
        </div>
      </div>
    </Modal>
  );
}
