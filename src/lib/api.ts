/** Client-side fetch helpers with uniform error handling. */

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw new ApiError("Network error — the dashboard backend is unreachable.", 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Let the shell know the session died (expired cookie, server restart) so
    // it can show the login gate instead of silently falling back to defaults.
    // The login attempt itself is excluded — its 401 just means "wrong password"
    // and is handled by the login form.
    if (res.status === 401 && typeof window !== "undefined" && !url.startsWith("/api/auth/")) {
      window.dispatchEvent(new Event("auth:unauthorized"));
    }
    throw new ApiError(String((data as { error?: string }).error ?? `Request failed (${res.status})`), res.status);
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>("GET", url),
  post: <T>(url: string, body?: unknown) => request<T>("POST", url, body ?? {}),
  patch: <T>(url: string, body?: unknown) => request<T>("PATCH", url, body ?? {}),
  del: <T>(url: string) => request<T>("DELETE", url),
};

/**
 * Clear the session cookie and lock the UI behind the login gate.
 *
 * The logout route is unauthenticated and must always succeed from the
 * operator's point of view: even if the network call fails, we still fire
 * `auth:unauthorized` so the shell does not stay on a logged-in screen.
 */
export async function logout(): Promise<void> {
  try {
    await fetch("/api/auth/logout", { method: "POST", cache: "no-store" });
  } catch {
    // Cookie clear is best-effort; the gate still comes up.
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("auth:unauthorized"));
  }
}
