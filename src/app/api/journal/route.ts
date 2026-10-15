import { getRepo } from "@/lib/repo";
import { logAudit } from "@/lib/settings";
import { importedFills, journalSyncStatus, withJournalContext } from "@/lib/journal/service";
import { annotationPatch, reservedJournalTag } from "@/lib/journal/annotations";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(req: Request) {
  const url = new URL(req.url), repo = await getRepo();
  const exporting = url.searchParams.get("export") === "1";
  const all = await repo.listJournal({ symbol: url.searchParams.get("symbol")?.toUpperCase(), mode: url.searchParams.get("mode") ?? undefined, limit: 1_000_000 });
  const automatic = all.filter(row => row.source === "paper" || row.source === "coindcx");
  const selected = automatic.slice(0, exporting ? 1_000_000 : 800);
  const fills = await importedFills();
  return Response.json({ entries: await withJournalContext(selected), total: automatic.length, legacyCount: all.length - automatic.length,
    paperOrders: await repo.listPaperOrders({ limit: exporting ? 1_000_000 : 80 }), paperPositions: await repo.listPaperPositions(),
    sync: await journalSyncStatus(), fills: exporting ? fills : fills.slice(0, 80),
    notice: "Paper rows are simulated execution results. CoinDCX rows are FIFO reconstruction, not venue-booked P&L. Prior AI context is not proof a trade followed AI. Legacy manual/sample rows are retained in storage but excluded from performance." });
}
export async function POST() {
  return Response.json({ error: "Journal is automatic. Manual insertion and sample seeding are disabled." }, { status: 405 });
}
export async function PATCH(req: Request) {
  try {
    const { id, ...patch } = annotationPatch(await req.json());
    const repo = await getRepo();
    const row = (await repo.listJournal({ limit: 1_000_000 })).find(r => r.id === id);
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
