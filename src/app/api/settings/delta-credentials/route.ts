/**
 * Delta credentials: GET status (no secrets), POST save, DELETE clear.
 *
 * Write-only by design. Once stored, the values cannot be read back through
 * any endpoint — the response confirms success and nothing else. The UI shows
 * "configured / not configured", never a masked key.
 *
 * Environment variables take precedence over anything saved here, so a
 * deployment that already injects keys keeps using those.
 */
import {
  clearDeltaCredentials,
  deltaCredentialsStatus,
  saveDeltaCredentials,
} from "@/lib/credentials";
import { logAudit } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    return Response.json(await deltaCredentialsStatus());
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Could not read credential status" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const status = await deltaCredentialsStatus();
  if (status.source === "env") {
    return Response.json(
      { error: "Delta credentials are managed by the server environment. Update DELTA_API_KEY and DELTA_API_SECRET in Vercel, then redeploy." },
      { status: 409 }
    );
  }

  let apiKey = "";
  let apiSecret = "";
  try {
    const body = (await req.json()) as { apiKey?: unknown; apiSecret?: unknown };
    apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
    apiSecret = typeof body.apiSecret === "string" ? body.apiSecret.trim() : "";
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!apiKey || !apiSecret) {
    return Response.json(
      { error: "Both apiKey and apiSecret are required." },
      { status: 400 }
    );
  }

  try {
    await saveDeltaCredentials(apiKey, apiSecret);
  } catch {
    // Driver errors may include SQL and bound credential ciphertext. Never
    // return them to the browser or record them in the audit log.
    await logAudit("delta_credentials_save_failed", {});
    return Response.json(
      { error: "Could not persist Delta credentials. Verify the storage connection and apply the dashboard database schema." },
      { status: 503 }
    );
  }

  // Audit records that credentials changed, never their values.
  await logAudit("delta_credentials_saved", {});
  return Response.json({ ok: true, configured: true, source: "stored" });
}

export async function DELETE() {
  try {
    await clearDeltaCredentials();
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof Error ? e.message : "Could not clear credentials (database unreachable?)",
      },
      { status: 500 }
    );
  }
  await logAudit("delta_credentials_cleared", {});
  return Response.json({ ok: true, configured: false, source: "none" });
}