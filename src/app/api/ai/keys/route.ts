/**
 * AI provider keys.
 *
 * GET    — public status: configured?, which source, a 4-character hint, model.
 *          Never the key itself.
 * POST   — save a key or model override. Requires the operator session, because
 *          a stored key is a spendable credential (free tier, but still the
 *          user's account).
 * DELETE — clear a stored key.
 *
 * Keys are written to `data/ai-keys.json` (gitignored) so they survive restarts
 * without living in the repo, and are only ever read on the server.
 */
import { isAuthenticated } from "@/lib/auth";
import { keyStatus, saveKeys } from "@/lib/ai/keys";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PROVIDERS = ["openrouter", "nvidia"] as const;
type Provider = (typeof PROVIDERS)[number];

function isProvider(value: unknown): value is Provider {
  return typeof value === "string" && (PROVIDERS as readonly string[]).includes(value);
}

export async function GET() {
  return Response.json({ providers: keyStatus() });
}

export async function POST(req: Request) {
  if (!(await isAuthenticated(req as never))) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  let body: { provider?: string; key?: string; model?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!isProvider(body.provider)) {
    return Response.json({ error: "provider must be openrouter or nvidia" }, { status: 400 });
  }
  if (body.key !== undefined && body.key !== null && typeof body.key !== "string") {
    return Response.json({ error: "key must be a string" }, { status: 400 });
  }
  if (typeof body.key === "string" && body.key.trim() && body.key.trim().length < 8) {
    return Response.json({ error: "That key looks too short to be valid" }, { status: 400 });
  }

  const ok = await saveKeys([{
    provider: body.provider,
    key: body.key ?? undefined,
    model: body.model ?? undefined,
  }]);
  if (!ok) {
    return Response.json({ error: "Could not write the key file (data directory is not writable)" }, { status: 500 });
  }
  return Response.json({ ok: true, providers: keyStatus() });
}

export async function DELETE(req: Request) {
  if (!(await isAuthenticated(req as never))) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }
  let body: { provider?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!isProvider(body.provider)) {
    return Response.json({ error: "provider must be openrouter or nvidia" }, { status: 400 });
  }
  await saveKeys([{ provider: body.provider, key: "", model: "" }]);
  return Response.json({ ok: true, providers: keyStatus() });
}
