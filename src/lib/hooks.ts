"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/** Poll an async fetcher on an interval. Keeps last good data on errors. */
export function usePoll<T>(
  fetcher: () => Promise<T>,
  intervalMs: number,
  opts?: { deps?: unknown[]; immediate?: boolean; enabled?: boolean }
): { data: T | null; error: string | null; refresh: () => void; loading: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fetchRef = useRef(fetcher);
  useEffect(() => {
    fetchRef.current = fetcher;
  }, [fetcher]);
  const enabled = opts?.enabled !== false;

  const refreshRef = useRef<() => void>(() => {});
  const refresh = useCallback(() => refreshRef.current(), []);
  useEffect(() => {
    let active = true;
    let pending = false;
    // Clear the previous resource when the subscription identity changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setData(null);
    setError(null);
    setLoading(enabled);
    const run = async () => {
      if (!active || !enabled || pending) return;
      pending = true;
      try {
        const result = await fetchRef.current();
        if (active) { setData(result); setError(null); }
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "Request failed");
      } finally {
        pending = false;
        if (active) setLoading(false);
      }
    };
    refreshRef.current = () => void run();
    if (enabled && opts?.immediate !== false) void run();
    const id = enabled ? setInterval(() => void run(), intervalMs) : undefined;
    return () => { active = false; clearInterval(id); };
    // Explicit caller deps identify the resource; fetcher identity changes on render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, enabled, opts?.immediate, ...(opts?.deps ?? [])]);
  return { data, error, refresh, loading };
}

export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px)");
    const update = () => setMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return mobile;
}

/**
 * Trap Tab/Shift+Tab inside a dialog and restore focus on close.
 * Attach the returned ref to the dialog panel (not the backdrop).
 */
export function useFocusTrap<T extends HTMLElement = HTMLDivElement>(active: boolean) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!active) return;
    const container = ref.current;
    if (!container) return;

    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () =>
      Array.from(
        container.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => el.getAttribute("aria-hidden") !== "true" && (el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement));

    focusable()[0]?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, [active]);
  return ref;
}
