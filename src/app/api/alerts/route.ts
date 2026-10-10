import { getRepo } from "@/lib/repo";
import type { AlertRuleRow } from "@/lib/repo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const KINDS = ["price_above", "price_below", "zone_enter", "signal", "pnl_below", "strategy_signal"];

export async function GET() {
  const rows = await (await getRepo()).listAlertRules();
  return Response.json({ rules: rows });
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const kind = String(body.kind ?? "");
  if (!KINDS.includes(kind)) return Response.json({ error: "Unknown alert kind" }, { status: 400 });
  const symbol = String(body.symbol ?? "").toUpperCase();
  if (!symbol) return Response.json({ error: "Symbol required" }, { status: 400 });
  const level = typeof body.level === "number" ? body.level : null;
  if (kind !== "signal" && kind !== "strategy_signal" && level === null) {
    return Response.json({ error: "Level required for this alert type" }, { status: 400 });
  }
  const row = await (await getRepo()).insertAlertRule({
    symbol,
    kind: kind as AlertRuleRow["kind"],
    level,
    level2: typeof body.level2 === "number" ? body.level2 : null,
    enabled: body.enabled !== false,
    sound: body.sound !== false,
    browser: body.browser === true,
  });
  return Response.json({ rule: row });
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
  const patch: Partial<AlertRuleRow> = {};
  if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
  if (typeof body.sound === "boolean") patch.sound = body.sound;
  if (typeof body.browser === "boolean") patch.browser = body.browser;
  if (body.triggered === true) patch.triggeredAt = new Date().toISOString();
  if (body.reset === true) patch.triggeredAt = null;
  const row = await (await getRepo()).updateAlertRule(id, patch);
  if (!row) return Response.json({ error: "Rule not found" }, { status: 404 });
  return Response.json({ rule: row });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "id required" }, { status: 400 });
  await (await getRepo()).deleteAlertRule(id);
  return Response.json({ ok: true });
}
