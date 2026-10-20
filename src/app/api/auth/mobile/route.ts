/**
 * POST /api/auth/mobile — exchange the operator password for a bearer session.
 *
 * The browser flow issues an HttpOnly cookie, which a native client cannot use.
 * This endpoint returns the same signed session that `/api/auth/login` puts in
 * the cookie, so the mobile app can store it in the device keychain and send it
 * as `Authorization: Bearer <token>`.
 *
 * The token is never the password and carries only an expiry. The password
 * itself is not stored, echoed, or logged. Fail-closed rules match the browser
 * login: unconfigured deployments issue nothing, and repeated failures are
 * throttled.
 */
import { NextResponse } from "next/server";
import {
  SESSION_TTL_MS,
  authConfigured,
  passwordMatches,
  sessionSecret,
  signSession,
} from "@/lib/auth";
import {
  bodyTooLarge,
  clearAuthFailures,
  clientKey,
  isThrottled,
  recordAuthFailure,
  retryAfterSeconds,
} from "@/lib/authRateLimit";
import { logAudit } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!authConfigured()) {
    return Response.json(
      { error: "Authentication is not configured. Set API_PASSWORD and restart." },
      { status: 503 }
    );
  }

  const key = clientKey(req);
  if (isThrottled(key)) {
    return Response.json(
      { error: "Too many failed attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds(key)) } }
    );
  }
  if (bodyTooLarge(req)) {
    return Response.json({ error: "Request body is too large" }, { status: 413 });
  }

  let password = "";
  try {
    const body = (await req.json()) as { password?: unknown };
    password = typeof body.password === "string" ? body.password : "";
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!passwordMatches(password)) {
    recordAuthFailure(key);
    // Never record the attempted value.
    await logAudit("auth_mobile_login_failed", {});
    return Response.json({ error: "Invalid credentials." }, { status: 401 });
  }

  clearAuthFailures(key);
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const token = await signSession(expiresAt, sessionSecret());
  await logAudit("auth_mobile_login_succeeded", {});

  const res = NextResponse.json({ token, expiresAt });
  res.headers.set("Cache-Control", "no-store");
  return res;
}
