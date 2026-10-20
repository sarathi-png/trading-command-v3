/**
 * POST /api/auth/login — exchange the operator password for a session cookie.
 *
 * Fail closed: without API_PASSWORD the endpoint reports 503 and issues
 * nothing, so a misconfigured deployment cannot be logged into.
 */
import { NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  authConfigured,
  passwordMatches,
  sessionSecret,
  signSession,
  sessionCookieOptions,
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

  // Refuse before parsing anything: a password oracle must not accept
  // unbounded work from an unauthenticated caller.
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
  let embeddedSession = false;
  try {
    const body = (await req.json()) as { password?: unknown; embeddedSession?: unknown };
    password = typeof body.password === "string" ? body.password : "";
    embeddedSession = body.embeddedSession === true && process.env.EMBEDDED_PREVIEW_COOKIES === "true";
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!passwordMatches(password)) {
    // Never record the attempted value.
    recordAuthFailure(key);
    await logAudit("auth_login_failed", {});
    return Response.json({ error: "Invalid credentials." }, { status: 401 });
  }

  // A correct password clears the window so a typo cannot accumulate toward a
  // lockout, while successful logins are never counted.
  clearAuthFailures(key);

  const token = await signSession(Date.now() + SESSION_TTL_MS, sessionSecret());
  await logAudit("auth_login_succeeded", {});

  // Only an explicitly configured embedded preview can issue this JS-readable
  // fallback. It is NOT the API password and expires in 15 minutes.
  const previewToken = embeddedSession
    ? await signSession(Date.now() + 15 * 60_000, sessionSecret()) : undefined;
  const res = NextResponse.json({ ok: true, expiresInMs: SESSION_TTL_MS, ...(previewToken ? { previewToken } : {}) });
  res.headers.set("Cache-Control", "no-store");
  res.cookies.set(SESSION_COOKIE, token, {
    ...sessionCookieOptions(),
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  return res;
}