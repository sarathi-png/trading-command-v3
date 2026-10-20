/**
 * Repository selection.
 *
 * The terminal runs on a workstation that may have no PostgreSQL at all, so the
 * backend is chosen at runtime rather than at build time:
 *
 *   1. `DATA_BACKEND=file|postgres` forces a backend (escape hatch / CI).
 *   2. Otherwise, if `DATABASE_URL` is set, a single cheap `select 1` probe is
 *      run against Postgres with a short timeout. Success -> Postgres (the
 *      original, fully-featured path). Any failure, timeout or missing URL ->
 *      the JSON file backend.
 *
 * The decision is cached in a module-level promise: the probe runs at most once
 * per process, and `getRepo()` is awaitable and cheap afterwards.
 */
import { onAfterWrite } from "@/lib/fileStore";
import { scheduleHfSync } from "@/lib/hfSync";
import { fileRepo } from "./file";
import type { Repo } from "./types";

export * from "./types";
export { ALL_DOCS } from "./file";

/** Give up on Postgres quickly — a refused connection returns in ms anyway. */
const PROBE_TIMEOUT_MS = Number(process.env.DB_PROBE_TIMEOUT_MS ?? 1500) || 1500;

let repoPromise: Promise<Repo> | null = null;
let resolved: Repo | null = null;

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms);
        (timer as unknown as { unref?: () => void }).unref?.();
      }),
    ]);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

let probeWarned = false;

async function postgresWorks(): Promise<boolean> {
  if (!process.env.DATABASE_URL) return false;
  try {
    const { probePostgres } = await import("./postgres");
    return (await withTimeout(probePostgres(), PROBE_TIMEOUT_MS)) === true;
  } catch {
    // `@/db` throws at import time when DATABASE_URL is missing.
    return false;
  }
}

/**
 * A serverless deployment cannot use the JSON file backend: each instance has
 * an ephemeral disk, so orders/settings silently vanish and uniqueness checks
 * are meaningless. Fail loudly instead of pretending writes are durable.
 */
function assertBackendAllowed(repo: Repo): void {
  const onVercel = process.env.VERCEL === "1" || Boolean(process.env.VERCEL_ENV);
  const override = process.env.ALLOW_FILE_BACKEND_ON_VERCEL === "1";
  if (onVercel && repo.backend === "file" && !override) {
    throw new Error(
      "Refusing to run on Vercel with the file data backend: writes are not durable and idempotency is unsafe. " +
        "Set DATABASE_URL to a Neon PostgreSQL connection string (DATA_BACKEND=postgres), then redeploy."
    );
  }
}

async function resolve(): Promise<Repo> {
  const forced = (process.env.DATA_BACKEND ?? "").trim().toLowerCase();
  let repo: Repo;
  if (forced === "file") {
    repo = fileRepo;
  } else if (forced === "postgres") {
    repo = (await import("./postgres")).postgresRepo;
  } else {
    const ok = await postgresWorks();
    if (!ok && process.env.DATABASE_URL && !probeWarned) {
      probeWarned = true;
      console.warn(
        `[repo] DATABASE_URL is set but PostgreSQL did not answer within ${PROBE_TIMEOUT_MS}ms; falling back to the file backend.`
      );
    }
    repo = ok ? (await import("./postgres")).postgresRepo : fileRepo;
  }
  assertBackendAllowed(repo);
  resolved = repo;
  if (repo.backend === "file") {
    // Mirror to Hugging Face after a durable write (no-op unless configured).
    onAfterWrite(() => scheduleHfSync());
  }
  return repo;
}

/** The active repository. Resolves once; every later call reuses the result. */
export function getRepo(): Promise<Repo> {
  if (!repoPromise) repoPromise = resolve();
  return repoPromise;
}

/** Synchronous view for logging/diagnostics; `null` before the first resolve. */
export function activeBackend(): "postgres" | "file" | null {
  return resolved?.backend ?? null;
}

/**
 * Test/ops helper: force the next `getRepo()` to re-run the probe. Only useful
 * when a database is started after the process.
 */
export function resetRepoSelection(): void {
  repoPromise = null;
  resolved = null;
}
