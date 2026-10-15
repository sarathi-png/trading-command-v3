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

const nextConfig: NextConfig = {
  allowedDevOrigins: ["*.e2b.app"],
  turbopack: {
    root: projectRoot,
  },
};

export default nextConfig;
