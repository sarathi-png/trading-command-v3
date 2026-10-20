"use client";
import { useDisplayCurrency } from "@/lib/useDisplayCurrency";
import { useMemo, useState } from "react";
import { BookOpen, Download, Pencil, RefreshCw, Share2 } from "lucide-react";
import { Btn, Chip, EmptyState, Input, MetricCard, PageHeader, Modal, Panel, Select, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { cx, fmtDateTime, fmtPrice, fmtUsd } from "@/lib/format";
import { usePoll } from "@/lib/hooks";
import { useApp } from "@/stores";
import { csvCell, type PredictionContext } from "@/lib/journal/context";
import { reservedJournalTag } from "@/lib/journal/annotations";
import type { JournalRow, PaperOrderRow, PaperPositionRow } from "@/lib/repo/types";
import type { JournalSyncStatus } from "@/lib/journal/service";
import type { JournalFill } from "@/lib/journal/fifo";
interface Row extends JournalRow { predictionContext: PredictionContext[] }
interface History {
  entries: Row[]; total: number; legacyCount: number; sync: JournalSyncStatus; fills: JournalFill[];
  paperOrders: PaperOrderRow[]; paperPositions: PaperPositionRow[]; notice: string;
}
function downloadCsv(name: string, rows: unknown[][]) {
  const blob = new Blob(["\uFEFF" + rows.map(row => row.map(csvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob), anchor = document.createElement("a");
  anchor.href = url; anchor.download = `${name}-${new Date().toISOString().slice(0,10)}.csv`; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function JournalPage() {
  useDisplayCurrency();
  const { settings } = useApp();
  const [fSymbol, setFSymbol] = useState(""), [fMode] = useState(settings.mode), [fDir, setFDir] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const [editing, setEditing] = useState<Row | null>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const { data, refresh, loading, error } = usePoll(() => api.get<History>(`/api/journal${fSymbol ? `?symbol=${encodeURIComponent(fSymbol)}` : ""}`), 15_000, { deps: [fSymbol] });
  const entries = useMemo(() => (data?.entries ?? []).filter(r => (!fMode || r.mode === fMode) && (!fDir || r.direction === fDir)), [data, fMode, fDir]);
  const closed = entries.filter(e => e.closedAt && e.exit !== null);
  const pageCount = Math.max(1, Math.ceil(entries.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visible = entries.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const pnlFor = (mode: string) => closed.filter(e => e.mode === mode).reduce((sum,e) => sum + e.pnl,0);
  async function sync() {
    setBusy(true);
    try {
      const res = await api.post<{sync: JournalSyncStatus}>("/api/journal/sync", {});
      setMessage(res.sync.configured ? "One bounded sync batch finished. Inspect coverage/errors below; a completed API request does not mean all history is imported." : "No CoinDCX credentials configured. Paper history still records automatically."); refresh();
    } catch (e) { setMessage(e instanceof Error ? e.message : "Sync unavailable"); }
    finally { setBusy(false); }
  }
  async function exportHistory(activity = false) {
    setBusy(true);
    try {
      const history = await api.get<History>(`/api/journal?export=1${fSymbol ? `&symbol=${encodeURIComponent(fSymbol)}` : ""}`);
      const rate = settings.displayCurrency === "inr" ? settings.usdInrRate : 1;
      if (activity) {
        downloadCsv("automatic-execution-activity", [
          ["source", "id", "symbol", "side", "status", "timestamp_utc", "price_usd_equivalent", "coin_quantity", "native_fee", "fee_currency", "fee_usd_equivalent", "import_fx_rate"],
          ...history.fills.filter(f => !fSymbol || f.symbol === fSymbol).map(f => ["coindcx-fill", f.key, f.symbol, f.side, "filled", new Date(f.ts).toISOString(), f.price, f.quantity, f.nativeFee, f.margin, f.fee, f.fxRate]),
          ...history.paperOrders.filter(o => !fSymbol || o.symbol === fSymbol).map(o => ["paper-order", o.id, o.symbol, o.side, o.status, o.createdAt, o.filledPrice ?? "", o.qty, "", "USD", "", ""]),
        ]);
      } else {
        const rows = history.entries.filter(e => (!fMode || e.mode === fMode) && (!fDir || e.direction === fDir));
        downloadCsv("automatic-trade-pnl", [
          ["id","source","mode","symbol","direction","opened_utc","closed_utc","entry_usd_equivalent","exit_usd_equivalent","coin_qty","fees_usd_equivalent","pnl_usd_equivalent","display_currency","manual_usd_inr_rate","entry_display","exit_display","pnl_display","pnl_basis","prior_ai_ids","prior_ai_models","prior_ai_chart_types","prior_ai_directions","attribution","notes","tags"],
          ...rows.map(e => [e.id,e.source,e.mode,e.symbol,e.direction,e.openedAt,e.closedAt,e.entry,e.exit,e.qty,e.fees,e.pnl,settings.displayCurrency.toUpperCase(),settings.usdInrRate,e.entry*rate,e.exit===null?"":e.exit*rate,e.pnl*rate,e.source==="coindcx"?"FIFO reconstruction, not venue-booked; no funding/liquidation":"Simulated paper net P&L",e.predictionContext.map(p=>p.id).join("|"),e.predictionContext.map(p=>`${p.provider}:${p.model}`).join("|"),e.predictionContext.map(p=>p.chartType).join("|"),e.predictionContext.map(p=>p.direction).join("|"),e.predictionContext.length?"Prior context only, not execution attribution":"No retained compatible prior prediction",e.notes,e.tags.join("|")]),
        ]);
      }
      setMessage("Exported retained history, including rows outside the 800-row screen limit. Coverage gaps are not invented.");
    } catch (e) { setMessage(e instanceof Error ? e.message : "Export unavailable"); }
    finally { setBusy(false); }
  }
  async function share() {
    const text = `Trading log · ${closed.length} displayed closed records\n${settings.mode === "paper" ? `Paper net: ${fmtUsd(pnlFor("paper"),{sign:true})} (simulated)` : `CoinDCX FIFO estimate: ${fmtUsd(pnlFor("live"),{sign:true})} (not venue-booked; excludes funding/liquidation)`}\n${closed.filter(e=>e.predictionContext.length).length} records with compatible prior AI context — not proof trades followed AI.\nFX: ${settings.displayCurrency === "inr" ? `manual USD/INR ${settings.usdInrRate}` : "USD-equivalent; USDT treated as USD"}. Coverage may be incomplete. Not investment advice.`;
    try { await navigator.clipboard.writeText(text); setMessage("P&L summary copied. No credentials or recipient details included."); }
    catch { setMessage("Clipboard unavailable in this browser. Use the CSV export instead."); }
  }
  return <div className="p-4 lg:p-6 space-y-4 page-shell">
    <PageHeader crumb="TRADING / AUTOMATIC JOURNAL" title="Trading journal" description="Automatic trade history for this workspace only. Financial facts are read-only; notes remain editable." />
    {(error || message) && <p role="status" className="text-[12px] text-warn">{error || message}</p>}
    <div className="auto-cells">
      <MetricCard label="DISPLAYED CLOSED RECORDS" value={String(closed.length)} sub={data ? `${data.total} retained automatic records` : "Loading history"}/>
      {settings.mode === "paper" && <MetricCard label="PAPER NET P&L" value={fmtUsd(pnlFor("paper"),{sign:true})} sub="SIMULATED EXECUTION" />}
      {settings.mode === "live" && <MetricCard label="LIVE FIFO ESTIMATE" value={fmtUsd(pnlFor("live"),{sign:true})} sub="NOT EXCHANGE-BOOKED P&L" />}
      <MetricCard label="PRIOR AI CONTEXT" value={String(closed.filter(e=>e.predictionContext.length).length)} sub="CONTEXT, NOT ATTRIBUTED PROFIT" />
    </div>
    {settings.mode === "live" && <Panel title="AUTOMATIC SYNC · READ ONLY" badge={<Chip tone={data?.sync?.configured ? "accent" : "warn"}>{data?.sync?.configured ? "API CONFIGURED · CHECK COVERAGE" : "NO LIVE API"}</Chip>}>
      <div className="p-3 space-y-2 text-[11px] text-mut">
        <p>{data?.sync?.note ?? "Loading import status…"}</p>
        <p>{data?.notice}</p>
        {data && <p>{data.sync.pairs.filter(p=>p.coveredThrough).length}/{data.sync.pairs.length} symbol/margin streams have a completed window · {data.sync.pairs.filter(p=>p.error).length} errors · {data.legacyCount} legacy manual/sample rows excluded, not deleted.</p>}
        <details><summary className="cursor-pointer text-accent">Coverage by symbol and margin currency</summary>
          <div className="mt-2 auto-cells gap-2">{data?.sync?.pairs.map(p=><div key={`${p.symbol}:${p.margin}`} className="border border-edge rounded p-2">
            <strong>{p.symbol} · {p.margin}</strong><p>{p.fills} retained fills · {p.coveredThrough ? `scanned to ${fmtDateTime(p.coveredThrough,settings.timezone)}` : "not yet complete"}{p.pendingPage ? ` · pending page ${p.pendingPage}` : ""}</p>
            <p className="text-dim">{p.historyFrom ? `History starts ${new Date(p.historyFrom).toISOString().slice(0,10)}` : "Not initialized"}</p>{p.error&&<p className="text-warn">{p.error}</p>}
          </div>)}</div>
        </details>
        <Btn disabled={busy} onClick={()=>void sync()}><RefreshCw size={12}/> SYNC NEXT BATCH</Btn>
      </div>
    </Panel>}
    <Panel title={`CLOSED TRADE LOG · PAGE ${currentPage} / ${pageCount}`}>
      <div className="flex items-center gap-2 flex-wrap px-3 py-2 border-b border-edge">
        <Input aria-label="Filter symbol" placeholder="symbol" value={fSymbol} onChange={e=>{setFSymbol(e.target.value.toUpperCase());setPage(1);}} className="w-24"/>
        <Chip>{settings.mode === "live" ? "LIVE HISTORY ONLY" : "PAPER HISTORY ONLY"}</Chip>
        <Select aria-label="Filter direction" value={fDir} onChange={e=>{setFDir(e.target.value);setPage(1);}}><option value="">all directions</option><option value="long">long</option><option value="short">short</option></Select>
        <Btn disabled={busy||!data?.total} onClick={()=>void exportHistory()}><Download size={12}/> EXPORT P&L + AI CONTEXT</Btn>
        <Btn disabled={!closed.length} onClick={()=>void share()}><Share2 size={12}/> COPY SUMMARY</Btn>
      </div>
      {loading&&!data ? <div className="p-3"><Skeleton className="h-20"/></div> : !entries.length ? <EmptyState icon={<BookOpen size={18}/>} title="No automatic closed trades yet" hint="Paper closes record automatically; CoinDCX reads need valid credentials and completed sync pages. No sample profits or manual entries."/> : <div className="overflow-x-auto"><table className="w-full text-[11px]">
        <thead><tr className="microlabel border-b border-edge text-left">{["OPENED","SYMBOL / SOURCE","DIR","ENTRY → EXIT","COIN QTY","NET P&L / BASIS","PRIOR AI CONTEXT","NOTES"].map(h=><th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
        <tbody>{visible.map(e=><tr key={e.id} className="border-b border-edge/50 hover:bg-panel2/50">
          <td className="px-3 py-2 num text-dim whitespace-nowrap">{fmtDateTime(Date.parse(e.openedAt),settings.timezone)}</td>
          <td className="px-3 py-2 num">{e.symbol}<p className="text-[9px] text-dim">{e.source === "coindcx" ? "COINDCX FILLS" : "PAPER EXECUTION"}</p></td>
          <td className={cx("px-3 py-2",e.direction==="long"?"text-up":"text-dn")}>{e.direction.toUpperCase()}</td>
          <td className="px-3 py-2 num whitespace-nowrap">{fmtPrice(e.entry)} → {fmtPrice(e.exit)}</td><td className="px-3 py-2 num">{e.qty}</td>
          <td className={cx("px-3 py-2 num whitespace-nowrap",e.pnl>=0?"text-up":"text-dn")}>{fmtUsd(e.pnl,{sign:true})}<p className="text-[9px] text-dim">{e.source==="coindcx"?"FIFO ESTIMATE":"PAPER NET"} · fees {fmtUsd(e.fees)}</p></td>
          <td className="px-3 py-2 min-w-48">{e.predictionContext.length ? <details><summary className="text-accent cursor-pointer">{e.predictionContext.length} prior calls · context only</summary>{e.predictionContext.map(p=><p key={p.id} className="text-[10px] mt-1" title={p.rationale}>{p.chartType} · {p.provider} · {p.direction} · {p.agrees?"aligned":"disagreed"}<br/><span className="text-dim">{p.model} · {p.id}</span></p>)}</details> : <span className="text-dim">No retained compatible prior call</span>}</td>
          <td className="px-3 py-2"><button onClick={()=>setEditing(e)} aria-label={`Annotate ${e.symbol} trade`} className="p-2 text-dim hover:text-ink"><Pencil size={13}/></button></td>
        </tr>)}</tbody></table></div>}
      {entries.length > pageSize && <div className="flex items-center justify-between gap-2 border-t border-edge px-3 py-2">
        <p className="text-[10px] text-dim">{(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, entries.length)} of {entries.length} filtered records</p>
        <div className="flex gap-1">
          <Btn variant="ghost" disabled={currentPage <= 1} onClick={()=>setPage(p=>Math.max(1,p-1))}>PREV</Btn>
          <Btn variant="ghost" disabled={currentPage >= pageCount} onClick={()=>setPage(p=>p+1)}>NEXT</Btn>
        </div>
      </div>}
    </Panel>
    <Panel title="EXECUTION ACTIVITY · OPEN AND CLOSED FILLS">
      <div className="p-3 text-[11px] space-y-2">
        <p className="text-dim">Retained CoinDCX fills include opening activity; paper orders/positions stay separate. The closed log above requires a matched round trip. Showing up to 80 latest entries per activity stream.</p>
        <Btn disabled={busy} onClick={()=>void exportHistory(true)}><Download size={12}/> EXPORT ALL RETAINED ACTIVITY</Btn>
        <div className="overflow-x-auto max-h-80"><table className="w-full text-left num"><thead><tr className="microlabel"><th className="p-2">TIME</th><th className="p-2">SOURCE / SYMBOL</th><th className="p-2">SIDE / STATUS</th><th className="p-2">PRICE</th><th className="p-2">COIN QTY</th></tr></thead><tbody>
          {data?.fills.map(f=><tr key={f.key} className="border-b border-edge/50"><td className="p-2 whitespace-nowrap">{fmtDateTime(f.ts,settings.timezone)}</td><td className="p-2">CoinDCX {f.margin} · {f.symbol}</td><td className="p-2">{f.side} · filled</td><td className="p-2">{fmtPrice(f.price)}</td><td className="p-2">{f.quantity}</td></tr>)}
          {data?.paperOrders.map(o=><tr key={o.id} className="border-b border-edge/50"><td className="p-2 whitespace-nowrap">{fmtDateTime(Date.parse(o.createdAt),settings.timezone)}</td><td className="p-2">Paper · {o.symbol}</td><td className="p-2">{o.side} · {o.status}</td><td className="p-2">{fmtPrice(o.filledPrice ?? o.price)}</td><td className="p-2">{o.qty}</td></tr>)}
        </tbody></table></div>
        {!!data?.paperPositions.length&&<p className="text-dim">{data.paperPositions.length} paper positions still open; unrealized P&L is not included in closed-trade totals.</p>}
      </div>
    </Panel>
    {editing&&<AnnotationModal entry={editing} onClose={()=>setEditing(null)} onSaved={()=>{setEditing(null);refresh();}}/>}
  </div>;
}
function AnnotationModal({entry,onClose,onSaved}:{entry:Row;onClose:()=>void;onSaved:()=>void}) {
  const [notes,setNotes]=useState(entry.notes), [emotion,setEmotion]=useState(entry.emotion), [tags,setTags]=useState(entry.tags.filter(t=>!reservedJournalTag(t)).join(", "));
  const [saving,setSaving]=useState(false), [error,setError]=useState("");
  async function save(){setSaving(true);setError("");try{await api.patch("/api/journal",{id:entry.id,notes,emotion,tags:tags.split(",").map(t=>t.trim()).filter(Boolean)});onSaved();}catch(e){setError(e instanceof Error?e.message:"Save failed");}finally{setSaving(false);}}
  return <Modal open onClose={onClose} title={`ANNOTATIONS · ${entry.symbol}`}><div className="space-y-3 text-[12px]">
    <p className="text-mut">Prices, quantity, fees, P&L, source and AI context are read-only. Financial history cannot be deleted here.</p>
    <label className="block">Notes<textarea aria-label="Trade notes" value={notes} maxLength={4000} onChange={e=>setNotes(e.target.value)} className="w-full h-24 mt-1 bg-bg2 border border-edge rounded p-2"/></label>
    <label className="block">Emotion<Input aria-label="Trade emotion" value={emotion} maxLength={80} onChange={e=>setEmotion(e.target.value)}/></label>
    <label className="block">Personal tags (comma separated)<Input aria-label="Trade tags" value={tags} onChange={e=>setTags(e.target.value)}/></label>
    {error&&<p role="alert" className="text-warn">{error}</p>}
    <div className="flex justify-end gap-2"><Btn onClick={onClose}>CANCEL</Btn><Btn variant="primary" disabled={saving} onClick={()=>void save()}>{saving?"SAVING…":"SAVE NOTES"}</Btn></div>
  </div></Modal>;
}
