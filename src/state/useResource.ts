/**
 * A tiny data-loading hook.
 *
 * Every screen in this app reads from the same backend, so the loading,
 * error and refresh behaviour is shared rather than repeated.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export interface Resource<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => Promise<void>;
  setData: (value: T | null) => void;
}

export function useResource<T>(
  loader: () => Promise<T>,
  deps: unknown[],
  options: { pollMs?: number } = {}
): Resource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const value = await loaderRef.current();
      if (!mounted.current) return;
      setData(value);
      setError(null);
    } catch (caught) {
      if (!mounted.current) return;
      setError(caught instanceof Error ? caught.message : "Request failed.");
    } finally {
      if (mounted.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    void reload();
  }, [reload]);

  const { pollMs } = options;
  useEffect(() => {
    if (!pollMs) return;
    const timer = setInterval(() => {
      void reload();
    }, pollMs);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollMs, reload]);

  return { data, error, loading, reload, setData };
}
