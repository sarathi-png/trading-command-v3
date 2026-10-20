/**
 * Readiness probe for local/Vercel checks.
 *
 * `ok` means the selected storage backend answers AND the schema this build
 * needs is present. A liveness-only 200 would let a deployment with missing
 * migrations receive paper orders and then fail every fill.
 */
import { getRepo } from "@/lib/repo";
import { APP_VERSION } from "@/lib/flags";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 5;

export async function GET() {
  const repo = await getRepo();
  const [database, schema] = await Promise.all([
    repo.probe().catch(() => false),
    repo.schemaReady().catch(() => ({ ok: false, missing: ["schema probe failed"] })),
  ]);
  const ok = database && schema.ok;
  return Response.json(
    {
      ok,
      status: ok ? "ready" : "degraded",
      backend: repo.backend,
      version: APP_VERSION,
      checks: { database, schema: schema.ok },
      missing: schema.missing,
      checkedAt: new Date().toISOString(),
    },
    { status: ok ? 200 : 500, headers: { "cache-control": "no-store" } }
  );
}
