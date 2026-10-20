import { API_BASE_URL } from "./config";

export interface HealthProbe {
  reachable: boolean;
  detail: string;
}

/**
 * Public health check used by the login screen.
 *
 * This is informational only: a failed probe does not block login (the health
 * route may be rate-limited or the database may recover), but the screen tells
 * the operator which URL it is pointed at.
 */
export async function probeApiHealth(baseUrl = API_BASE_URL, timeoutMs = 4_000): Promise<HealthProbe> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/health`, {
      signal: controller.signal,
    });
    const body = (await response.json().catch(() => null)) as
      | { ok?: boolean; backend?: string; schema?: boolean }
      | null;
    if (!response.ok) {
      return { reachable: false, detail: `API responded with HTTP ${response.status}` };
    }
    const parts = [body?.ok ? "API ready" : "API degraded"];
    if (body?.backend) parts.push(`backend ${body.backend}`);
    if (body && typeof body.schema === "boolean") parts.push(body.schema ? "schema ok" : "schema missing");
    return { reachable: true, detail: parts.join(" · ") };
  } catch {
    return {
      reachable: false,
      detail: controller.signal.aborted ? "API unreachable (timed out)" : "API unreachable",
    };
  } finally {
    clearTimeout(timer);
  }
}
