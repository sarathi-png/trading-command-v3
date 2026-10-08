/**
 * Delta credential status: GET status, POST refused, DELETE purges legacy keys.
 *
 * After the static-IP gateway migration a Delta API key/secret must exist ONLY
 * on the gateway host. The application therefore has no way to accept one:
 *
 *   POST is refused with 409 and an explanation. This is deliberately a hard
 *   refusal rather than a hidden no-op, so an operator who pastes keys into the
 *   dashboard is told exactly where they belong instead of believing they were
 *   saved somewhere that would be used.
 *
 *   DELETE removes the legacy encrypted row an older deployment may have
 *   created. Nothing in the running system reads that row any more.
 *
 * GET never returns a secret — only whether the gateway is configured, and
 * whether an unused legacy row is still present.
 */
import { deltaCredentialsStatus, purgeLegacyDeltaCredentials } from "@/lib/credentials";
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

export async function POST() {
  await logAudit("delta_credentials_rejected", { reason: "credentials_live_on_gateway" });
  return Response.json(
    {
      error:
        "Delta API keys are held only by the static-IP trading gateway. Set DELTA_API_KEY and DELTA_API_SECRET in the gateway's environment (see docs/TRADING_GATEWAY_DEPLOYMENT.md), then allowlist the gateway's public IPv4 at Delta.",
      configured: false,
      source: "none",
    },
    { status: 409 }
  );
}

export async function DELETE() {
  try {
    const result = await purgeLegacyDeltaCredentials();
    await logAudit("delta_credentials_legacy_purged", { removed: result.removed });
    return Response.json({ ok: true, removed: result.removed });
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof Error ? e.message : "Could not remove the legacy credential row (database unreachable?)",
      },
      { status: 500 }
    );
  }
}
