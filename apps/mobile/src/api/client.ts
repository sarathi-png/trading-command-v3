/**
 * Minimal typed REST client for the Trading Command API.
 *
 * Kept free of React Native imports so it can be unit tested under plain Node.
 * The token and workspace are supplied by the session/workspace contexts.
 *
 * Two behaviours are deliberate:
 *   - The workspace header is added to every request except the settings and
 *     health routes. Sending it to a mode change is rejected by the server, and
 *     omitting it elsewhere would weaken paper/live route separation.
 *   - A 401 notifies the session layer so an expired token clears storage and
 *     returns the user to login instead of leaving screens in a broken state.
 */
import type { Workspace } from "./types";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface FetchLikeResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  }
) => Promise<FetchLikeResponse>;

export interface ApiClientConfig {
  baseUrl: string;
  workspace: Workspace;
  getToken: () => string | null;
  onUnauthorized?: () => void;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}

/** Routes that must not receive `x-tc-workspace`. */
const WORKSPACE_EXEMPT = new Set(["/api/settings", "/api/health"]);

export function pathNeedsWorkspace(path: string): boolean {
  const clean = path.split("?")[0];
  if (clean.startsWith("/api/auth/")) return false;
  return !WORKSPACE_EXEMPT.has(clean);
}

/** Trim a configured base URL and reject an empty one. */
export function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (!trimmed) throw new Error("API base URL is required");
  return trimmed;
}

export function createApiClient(config: ApiClientConfig) {
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const timeoutMs = config.timeoutMs ?? 8_000;
  const doFetch: FetchLike = config.fetchImpl ?? ((input, init) => fetch(input, init));

  async function request<T>(
    path: string,
    init: { method?: string; body?: unknown } = {}
  ): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    const token = config.getToken();
    if (token) headers.authorization = `Bearer ${token}`;
    if (init.body !== undefined) headers["content-type"] = "application/json";
    if (pathNeedsWorkspace(path)) headers["x-tc-workspace"] = config.workspace;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: FetchLikeResponse;
    try {
      response = await doFetch(`${baseUrl}${path}`, {
        method: init.method ?? "GET",
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new ApiError(0, `Request timed out after ${timeoutMs} ms`);
      }
      throw new ApiError(0, error instanceof Error ? error.message : "Network request failed");
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    if (!response.ok) {
      if (response.status === 401) config.onUnauthorized?.();
      throw new ApiError(response.status, errorMessage(parsed, response.status), parsed);
    }
    return parsed as T;
  }

  return {
    baseUrl,
    workspace: config.workspace,
    get: <T>(path: string) => request<T>(path),
    post: <T>(path: string, body: unknown) => request<T>(path, { method: "POST", body }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

/** Prefer the server's `error` string; never render a bare status alone. */
export function errorMessage(parsed: unknown, status: number): string {
  if (parsed && typeof parsed === "object" && "error" in parsed) {
    const value = (parsed as { error?: unknown }).error;
    if (typeof value === "string" && value.trim()) return value;
  }
  return `Request failed (HTTP ${status})`;
}
