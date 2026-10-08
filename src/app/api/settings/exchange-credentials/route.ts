/**
 * Exchange credential status: GET status, POST refused, DELETE purges legacy keys.
 *
 * The application signs CoinDCX requests with credentials taken from the
 * environment (COINDCX_API_KEY / COINDCX_API_SECRET). There is deliberately no
 * endpoint that ACCEPTS a key or a secret:
 *
 *   POST is refused with 409 and an explanation. This is a hard refusal rather
 *   than a hidden no-op, so an operator who pastes keys into the dashboard is
 *   told exactly where they belong (Vercel environment variables) instead of
 *   believing they were stored somewhere that would be used.
 *
 *   DELETE removes the legacy encrypted Delta row an older deployment may have
 *   created. Nothing in the running system reads that row any more.
 *
 * GET never returns a secret — only presence, the NAME of any missing variable,
 * and whether an unused legacy row is still present.
 */
import { exchangeCredentialsStatus, purgeLegacyDeltaCredentials } from "@/lib/credentials";
import { logAudit } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return Response.json(await exchangeCredentialsStatus());
}

export async function POST() {
  await logAudit("exchange_credentials_rejected", { reason: "environment_only" });
  return Response.json(
    {
      error:
        "API keys are read from the deployment environment and cannot be saved from the dashboard. Set COINDCX_API_KEY and COINDCX_API_SECRET in the Vercel project (Production + Preview) and redeploy.",
      code: "CREDENTIALS_ENVIRONMENT_ONLY",
    },
    { status: 409 }
  );
}

export async function DELETE() {
  const result = await purgeLegacyDeltaCredentials();
  await logAudit("legacy_credentials_purged", { removed: result.removed });
  return Response.json(result);
}
