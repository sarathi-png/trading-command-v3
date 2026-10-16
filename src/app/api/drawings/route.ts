import { chartDrawingLayout, drawingBelongsToChart, type ChartScope } from "@/lib/chartScope";
import { getRepo } from "@/lib/repo";
import type { DrawingRow } from "@/lib/repo";
import type { Drawing, DrawingType, Timeframe } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DRAWING_TYPES: DrawingType[] = [
  "hline", "vline", "trend", "ray", "rect", "text", "entry", "stop", "target",
];

function parseDrawing(body: Record<string, unknown>): Omit<Drawing, "id"> | null {
  const type = body.type as DrawingType;
  if (!DRAWING_TYPES.includes(type)) return null;
  const points = body.points;
  if (!Array.isArray(points) || points.length === 0 || points.length > 2) return null;
  for (const p of points) {
    if (typeof p?.time !== "number" || typeof p?.price !== "number") return null;
  }
  const chartType = body.chartType === "heikin-ashi" || body.layout === "chart:heikin-ashi" ? "heikin-ashi" : "candles";
  return {
    symbol: String(body.symbol ?? "").toUpperCase(),
    timeframe: String(body.timeframe ?? "15m") as Timeframe,
    layout: chartDrawingLayout(chartType),
    type,
    points,
    color: typeof body.color === "string" ? body.color : "#57E6D2",
    width: Number(body.width) || 2,
    opacity: typeof body.opacity === "number" ? Math.max(0.1, Math.min(1, body.opacity)) : 1,
    locked: Boolean(body.locked),
    hidden: Boolean(body.hidden),
    label: String(body.label ?? ""),
    note: String(body.note ?? ""),
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbol = url.searchParams.get("symbol");
  const timeframe = url.searchParams.get("timeframe");
  if (!symbol || !timeframe) {
    return Response.json({ error: "symbol and timeframe are required" }, { status: 400 });
  }
  const chartType = url.searchParams.get("chartType") ?? "candles";
  if (chartType !== "candles" && chartType !== "heikin-ashi") return Response.json({ error: "Unsupported chart type" }, { status: 400 });
  const rows = (await (await getRepo()).listDrawings(symbol, timeframe)).filter(row => drawingBelongsToChart(row.layout, chartType));
  return Response.json({ drawings: rows });
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = parseDrawing(body);
  if (!parsed || !parsed.symbol) {
    return Response.json({ error: "Invalid drawing payload" }, { status: 400 });
  }
  const { createdAt: _omit, ...values } = parsed;
  const row = await (await getRepo()).insertDrawing(values as Omit<DrawingRow, "id" | "createdAt">);
  return Response.json({ drawing: row });
}

export async function PATCH(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const id = String(body.id ?? "");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  if (typeof body.symbol === "string" && typeof body.timeframe === "string") {
    const scope: ChartScope = body.chartType === "heikin-ashi" ? "heikin-ashi" : "candles";
    const own = (await (await getRepo()).listDrawings(body.symbol, body.timeframe)).some(row => row.id === id && drawingBelongsToChart(row.layout, scope));
    if (!own) return Response.json({ error: "Drawing not found in this chart" }, { status: 404 });
  }
  const patch: Partial<DrawingRow> = {};
  for (const k of ["color", "label", "note"] as const) {
    if (typeof body[k] === "string") patch[k] = body[k];
  }
  for (const k of ["width"] as const) {
    if (typeof body[k] === "number") patch[k] = body[k];
  }
  if (typeof body.opacity === "number") patch.opacity = Math.max(0.1, Math.min(1, body.opacity));
  for (const k of ["locked", "hidden"] as const) {
    if (typeof body[k] === "boolean") patch[k] = body[k];
  }
  if (Array.isArray(body.points) && body.points.length > 0 && body.points.length <= 2) {
    patch.points = body.points as DrawingRow["points"];
  }
  const row = await (await getRepo()).updateDrawing(id, patch);
  if (!row) return Response.json({ error: "Drawing not found" }, { status: 404 });
  return Response.json({ drawing: row });
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  const symbol = url.searchParams.get("symbol"), timeframe = url.searchParams.get("timeframe");
  if (symbol && timeframe) {
    const scope = url.searchParams.get("chartType") === "heikin-ashi" ? "heikin-ashi" : "candles";
    const own = (await (await getRepo()).listDrawings(symbol, timeframe)).some(row => row.id === id && drawingBelongsToChart(row.layout, scope));
    if (!own) return Response.json({ error: "Drawing not found in this chart" }, { status: 404 });
  }
  await (await getRepo()).deleteDrawing(id);
  return Response.json({ ok: true });
}
