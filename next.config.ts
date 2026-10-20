import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

/**
 * Pin the workspace root to THIS project directory.
 *
 * Without this, Next walks upward looking for a lockfile and adopts whatever
 * it finds first. If an ancestor directory (here, C:\Users\BLF) has a
 * package-lock.json, Next treats that as the root — and then silently never
 * finds `proxy.ts`, which means **all API authentication is skipped** while
 * the app still serves 200s. Pinning the root makes the guard impossible to
 * lose by accident.
 */
const projectRoot = dirname(fileURLToPath(import.meta.url));

const isProduction = process.env.NODE_ENV === "production";
/** HSTS/HTTPS upgrades only on a real deployment, never local `next start`. */
const isDeployed = process.env.VERCEL === "1";

/**
 * Baseline security headers. Inline script/style are required by Next's
 * hydration bootstrap and by the chart's style attributes; a nonce-based CSP
 * would need middleware plumbing and is deliberately out of scope here.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' ws: wss:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isDeployed ? ["upgrade-insecure-requests"] : []),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  ...(isDeployed
    ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
    : []),
];

const nextConfig: NextConfig = {
  allowedDevOrigins: ["*.e2b.app"],
  poweredByHeader: false,
  turbopack: {
    root: projectRoot,
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
