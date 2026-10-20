import { requestWorkspace, parseWorkspace } from "@/lib/workspace";
import { getRepo } from "@/lib/repo";
import { getSettings, logAudit } from "@/lib/settings";
import { importedFills, journalSyncStatus, withJournalContext } from "@/lib/journal/service";
import { annotationPatch, reservedJournalTag } from "@/lib/journal/annotations";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 10;
export async function GET(req: Request) {
  const url = new URL(req.url), repo = await getRepo();
  const mode = await requestWorkspace() ?? parseWorkspace(url.searchParams.get("mode")) ?? (await getSettings()).mode;
  const exporting = url.searchParams.get("export") === "1";
  const all = await repo.listJournal({ symbol: url.searchParams.get("symbol")?.toUpperCase(), mode, limit: 1_000_000 });
  const automatic = all.filter(row => row.source === "paper" || row.source === "coindcx");
  const selected = automatic.slice(0, exporting ? 1_000_000 : 800);
  const fills = mode === "live" ? await importedFills() : [];
  return Response.json({ entries: await withJournalContext(selected), total: automatic.length, legacyCount: all.length - automatic.length,
    paperOrders: mode === "paper" ? await repo.listPaperOrders({ limit: exporting ? 1_000_000 : 80 }) : [], paperPositions: mode === "paper" ? await repo.listPaperPositions() : [],
    sync: mode === "live" ? await journalSyncStatus() : { configured: false, note: "Paper history records automatically.", pairs: [] }, fills: exporting ? fills : fills.slice(0, 80),
    notice: mode === "paper" ? "Paper workspace: simulated executions only. No live balances or fills are included." : "Live workspace: CoinDCX FIFO reconstruction only, not venue-booked P&L. Prior AI context is not proof a trade followed AI. Funding and liquidations are excluded." });
}
export async function POST() {
  return Response.json({ error: "Journal is automatic. Manual insertion and sample seeding are disabled." }, { status: 405 });
}
export async function PATCH(req: Request) {
  try {
    const { id, ...patch } = annotationPatch(await req.json());
    const repo = await getRepo();
    const row = (await repo.listJournal({ mode: await requestWorkspace() ?? undefined, limit: 1_000_000 })).find(r => r.id === id);
    if (!row) return Response.json({ error: "Record not found" }, { status: 404 });
    if (patch.tags) patch.tags = [...new Set([...row.tags.filter(reservedJournalTag), ...patch.tags.filter(t => !reservedJournalTag(t))])];
    const updated = await repo.updateJournal(id, patch);
    await logAudit("journal_annotations_updated", { id, fields: Object.keys(patch) });
    return Response.json({ entry: updated });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Invalid annotations" }, { status: 400 });
  }
}
export async function DELETE() {
  return Response.json({ error: "Automatic trade history cannot be deleted through the journal." }, { status: 405 });
}
