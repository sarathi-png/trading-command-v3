import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createApiClient } from "@/src/api/client";
import { API_BASE_URL, API_TIMEOUT_MS } from "@/src/api/config";
import type { LoginResponse } from "@/src/api/types";
import { clearSession, readSession, writeSession } from "@/src/auth/store";

export type SessionStatus = "loading" | "signedOut" | "signedIn";

export interface SessionValue {
  status: SessionStatus;
  token: string | null;
  expiresAt: number | null;
  login: (password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

/**
 * Unauthenticated client used only for `POST /api/auth/mobile`.
 * It never carries a token, and the auth route is workspace-exempt.
 */
const anonymousClient = createApiClient({
  baseUrl: API_BASE_URL,
  workspace: "paper",
  getToken: () => null,
  timeoutMs: API_TIMEOUT_MS,
});

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>("loading");
  const [token, setToken] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void readSession().then((session) => {
      if (cancelled) return;
      if (session) {
        setToken(session.token);
        setExpiresAt(session.expiresAt);
        setStatus("signedIn");
      } else {
        setStatus("signedOut");
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const signOut = useCallback(async () => {
    setStatus("signedOut");
    setToken(null);
    setExpiresAt(null);
    await clearSession();
  }, []);

  const login = useCallback(async (password: string) => {
    const result = await anonymousClient.post<LoginResponse>("/api/auth/mobile", { password });
    if (
      !result ||
      typeof result.token !== "string" ||
      result.token.length === 0 ||
      typeof result.expiresAt !== "number" ||
      !Number.isFinite(result.expiresAt) ||
      result.expiresAt <= Date.now()
    ) {
      throw new Error("The server returned an invalid session.");
    }
    await writeSession({ token: result.token, expiresAt: result.expiresAt });
    setToken(result.token);
    setExpiresAt(result.expiresAt);
    setStatus("signedIn");
  }, []);

  // Sessions are 12 h and there is no refresh endpoint. Drop the token the
  // moment it expires rather than letting the next request fail with a 401.
  useEffect(() => {
    if (status !== "signedIn" || !expiresAt) return;
    const remaining = expiresAt - Date.now();
    const timer = setTimeout(() => void signOut(), Math.max(0, remaining));
    return () => clearTimeout(timer);
  }, [status, expiresAt, signOut]);

  const value = useMemo<SessionValue>(
    () => ({ status, token, expiresAt, login, signOut }),
    [status, token, expiresAt, login, signOut]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider");
  return value;
}
