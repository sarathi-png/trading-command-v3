import { syncCoinDcxJournal } from "@/lib/journal/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST() {
  try { return Response.json({ sync: await syncCoinDcxJournal() }); }
  catch { return Response.json({ error: "Journal synchronization/storage unavailable; no history was invented." }, { status: 503 }); }
}
