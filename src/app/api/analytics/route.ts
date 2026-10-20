/**
 * Server-side performance metrics for the current workspace.
 *
 * Filters are applied before aggregation, and pagination only affects the row
 * list, never the metrics. Workspace mode is authoritative: a paper request can
 * never include live rows (and vice versa).
 */
import { requestWorkspace } from "@/lib/workspace";
import { getRepo } from "@/lib/repo";
import { getSettings } from "@/lib/settings";
import { computeAnalytics } from "@/lib/analytics/metrics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 10;

function dateBound(value: string | null, endOfDay = false): number | null {
  if (!value) return null;
  const ms = Date.parse(endOfDay ? `${value}T23:59:59.999Z` : `${value}T00:00:00.000Z`);
  return Number.isFinite(ms) ? ms : null;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const settings = await getSettings();
  const mode = await requestWorkspace() ?? settings.mode;

  const symbol = url.searchParams.get("symbol")?.trim().toUpperCase() || undefined;
  const direction = url.searchParams.get("direction");
  const strategy = url.searchParams.get("strategy")?.trim() || undefined;
  const from = dateBound(url.searchParams.get("from"));
  const to = dateBound(url.searchParams.get("to"), true);
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get("pageSize") ?? "25", 10) || 25));

  const repo = await getRepo();
  const all = await repo.listJournal({ mode, symbol, limit: 1_000_000 });
  const automatic = all.filter((row) => row.source === "paper" || row.source === "coindcx");
  const filtered = automatic.filter((row) => {
    if (direction !== "long" && direction !== "short") return true;
    if (row.direction !== direction) return false;
    if (strategy && row.strategy !== strategy) return false;
    const closed = row.closedAt ? Date.parse(row.closedAt) : NaN;
    if (!Number.isFinite(closed)) return true;
    if (from !== null && closed < from) return false;
    if (to !== null && closed > to) return false;
    return true;
  });

  const closed = filtered.filter((row) => row.exit !== null && row.closedAt !== null);
  const metrics = computeAnalytics(closed);
  const sorted = [...closed].sort(
    (a, b) => new Date(b.closedAt as string).getTime() - new Date(a.closedAt as string).getTime()
  );
  const total = sorted.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pageCount);
  const entries = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);

  return Response.json({
    mode,
    metrics,
    entries,
    total,
    page: safePage,
    pageSize,
    pageCount,
    filters: { symbol: symbol ?? null, direction: direction ?? null, strategy: strategy ?? null, from: from !== null ? new Date(from).toISOString() : null, to: to !== null ? new Date(to).toISOString() : null },
    notice: mode === "paper"
      ? "Paper workspace: simulated executions only; live rows are excluded."
      : "Live workspace: CoinDCX FIFO reconstruction, not venue-booked P&L; funding and liquidations excluded.",
  });
}
