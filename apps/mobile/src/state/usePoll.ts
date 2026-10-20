import { useEffect, useRef } from "react";
import { AppState } from "react-native";

/**
 * Run `fn` immediately and then every `intervalMs`, but only while the app is
 * in the foreground.
 *
 * There is no background execution here (and no push notifications in v1), so
 * polling while backgrounded would waste battery for data nobody can see.
 * `fn` is expected to handle its own errors.
 */
export function usePoll(fn: () => Promise<void>, intervalMs: number, enabled: boolean): void {
  const latest = useRef(fn);
  useEffect(() => {
    latest.current = fn;
  }, [fn]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let state = AppState.currentState;

    const schedule = () => {
      if (cancelled) return;
      timer = setTimeout(() => void run(), intervalMs);
    };

    const run = async () => {
      if (cancelled || state !== "active") return;
      try {
        await latest.current();
      } finally {
        schedule();
      }
    };

    const subscription = AppState.addEventListener("change", (next) => {
      const returning = next === "active" && state !== "active";
      state = next;
      if (returning) {
        if (timer) clearTimeout(timer);
        timer = null;
        void run();
      }
    });

    void run();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      subscription.remove();
    };
  }, [enabled, intervalMs]);
}
