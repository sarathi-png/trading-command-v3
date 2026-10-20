import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { SignalRow, SignalsResponse } from "@/src/api/types";
import { errorText, useApi } from "./api";
import { useSession } from "./session";
import { usePoll } from "./usePoll";

interface SignalsValue {
  signals: SignalRow[];
  loading: boolean;
  error: string | null;
  /** New active signals seen since the inbox was last opened. */
  unread: number;
  refresh: () => Promise<void>;
  markRead: () => void;
}

const SignalsContext = createContext<SignalsValue | null>(null);

const POLL_MS = 15_000;

function timestamp(signal: SignalRow): number {
  const value = Date.parse(signal.createdAt);
  return Number.isFinite(value) ? value : 0;
}

/**
 * Foreground polling for the signal inbox.
 *
 * v1 deliberately has no push notifications: the badge only updates while the
 * app is open, and the inbox is honest about it in the UI.
 */
export function SignalsProvider({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const api = useApi();
  const [signals, setSignals] = useState<SignalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Zero means "the inbox has not been opened yet this session", so active
  // signals fetched at launch surface as unread. Opening the inbox sets it.
  const [lastOpenedAt, setLastOpenedAt] = useState(0);

  const refresh = useCallback(async () => {
    if (status !== "signedIn") return;
    try {
      const result = await api.get<SignalsResponse>("/api/signals?limit=50");
      const rows = Array.isArray(result.signals) ? [...result.signals] : [];
      rows.sort((a, b) => timestamp(b) - timestamp(a));
      setSignals(rows);
      setError(null);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setLoading(false);
    }
  }, [api, status]);

  usePoll(refresh, POLL_MS, status === "signedIn");

  const markRead = useCallback(() => setLastOpenedAt(Date.now()), []);

  const unread = useMemo(
    () => signals.filter((signal) => signal.outcome === "ACTIVE" && timestamp(signal) > lastOpenedAt).length,
    [signals, lastOpenedAt]
  );

  const value = useMemo<SignalsValue>(
    () => ({ signals, loading, error, unread, refresh, markRead }),
    [signals, loading, error, unread, refresh, markRead]
  );

  return <SignalsContext.Provider value={value}>{children}</SignalsContext.Provider>;
}

export function useSignals(): SignalsValue {
  const value = useContext(SignalsContext);
  if (!value) throw new Error("useSignals must be used inside SignalsProvider");
  return value;
}
