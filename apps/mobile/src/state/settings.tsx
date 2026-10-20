import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { Mode, SettingsResponse } from "@/src/api/types";
import { errorText, useApi } from "./api";
import { useSession } from "./session";
import { usePoll } from "./usePoll";

interface SettingsValue {
  data: SettingsResponse | null;
  mode: Mode | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** Change the server mode. The client omits the workspace header here. */
  setMode: (mode: Mode) => Promise<void>;
}

const SettingsContext = createContext<SettingsValue | null>(null);

const POLL_MS = 20_000;

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const api = useApi();
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (status !== "signedIn") return;
    try {
      const next = await api.get<SettingsResponse>("/api/settings");
      setData(next);
      setError(null);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setLoading(false);
    }
  }, [api, status]);

  usePoll(refresh, POLL_MS, status === "signedIn");

  const setMode = useCallback(
    async (mode: Mode) => {
      const result = await api.post<{ settings: SettingsResponse["settings"] }>("/api/settings", { mode });
      setData((current) => (current ? { ...current, settings: result.settings } : current));
      setError(null);
    },
    [api]
  );

  const value = useMemo<SettingsValue>(
    () => ({
      data,
      mode: data?.settings.mode ?? null,
      loading,
      error,
      refresh,
      setMode,
    }),
    [data, loading, error, refresh, setMode]
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsValue {
  const value = useContext(SettingsContext);
  if (!value) throw new Error("useSettings must be used inside SettingsProvider");
  return value;
}
