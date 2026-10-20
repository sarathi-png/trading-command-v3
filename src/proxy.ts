/**
 * API authentication choke point.
 *
 * Next.js 16 renamed `middleware.ts` to `proxy.ts`. This project keeps its app
 * under `src/`, so the file lives at `src/proxy.ts` next to the routes it
 * guards. Enforcing auth here rather than inside each handler means a route
 * added later cannot forget to check.
 *
 * Allow-listed:
 *   /api/auth/login    - issues the session cookie
 *   /api/auth/logout   - clears it
 *   /api/auth/mobile   - issues a bearer session for the mobile app
 *   /api/health        - liveness probe for the container/orchestrator
 *   /api/integrations/tradingview/webhook
 *                       - machine-to-machine; authenticated by its own
 *                         shared secret + timestamp window in that handler
 */
import { NextResponse, type NextRequest } from "next/server";
import {
  authConfigured,
  bearerFrom,
  isAuthenticated,
  sessionSecret,
  timingSafeEqual,
  verifySession,
} from "./lib/auth";

const PUBLIC_API = new Set([
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/mobile",
  "/api/health",
  "/api/integrations/tradingview/webhook",
]);

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Scheduler credential grants access ONLY to the two read/synchronization monitor endpoints.
  if (["/api/notifications/scan", "/api/journal/sync"].includes(pathname) && process.env.CRON_SECRET &&
      timingSafeEqual(req.headers.get("authorization") ?? "", `Bearer ${process.env.CRON_SECRET}`)) {
    return NextResponse.next();
  }
  if (PUBLIC_API.has(pathname)) return NextResponse.next();

  // Fail closed: refuse everything rather than serve an unauthenticated API
  // that can place live orders.
  if (!authConfigured()) {
    return NextResponse.json(
      {
        error:
          "Authentication is not configured. Set API_PASSWORD (and SESSION_SECRET) and restart.",
      },
      { status: 503 }
    );
  }

  // Accepts a signed session (cookie or bearer) or the operator password.
  if (await isAuthenticated(req)) {
    const workspace = req.headers.get("x-tc-workspace");
    // A browser (cookie) and a mobile client (signed bearer session) must both
    // declare which workspace they are acting in. A password bearer is a
    // script/curl caller and keeps its historical behaviour: it must opt in to
    // the paper/live route separation explicitly through the same header only
    // when it wants that workspace enforced.
    const bearer = bearerFrom(req.headers.get("authorization"));
    const sessionBearer = bearer ? await verifySession(bearer, sessionSecret()) : false;
    const mustDeclareWorkspace =
      (!bearer || sessionBearer) && pathname !== "/api/settings";
    if (mustDeclareWorkspace && !["paper", "live"].includes(workspace ?? "")) {
      return NextResponse.json({ error: "Select a Live or Paper workspace first." }, { status: 428 });
    }
    if (workspace === "live" && pathname.startsWith("/api/paper")) {
      return NextResponse.json({ error: "Paper execution is unavailable in the Live workspace." }, { status: 403 });
    }
    if (workspace === "paper" && (pathname.startsWith("/api/orders") || pathname === "/api/positions/close" || pathname.startsWith("/api/exchange/") || pathname === "/api/journal/sync")) {
      return NextResponse.json({ error: "Live account actions are unavailable in the Paper workspace." }, { status: 403 });
    }
    return NextResponse.next();
  }

  return NextResponse.json({ error: "Authentication required." }, { status: 401 });
}

export const config = {
  matcher: ["/api/:path*"],
};