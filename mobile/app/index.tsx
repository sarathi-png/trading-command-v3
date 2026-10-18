import { useEffect, useState } from "react";
import { Redirect } from "expo-router";

import { Loading } from "../src/components/ui";
import { useSession } from "../src/state/session";

/** How long the gate waits for the saved session before it moves on. */
const RESTORE_TIMEOUT_MS = 4000;

/**
 * The gate: a saved session goes straight to the workspace, anything else to
 * the sign-in screen.
 */
export default function Index() {
  const status = useSession((state) => state.status);
  const restore = useSession((state) => state.restore);
  const [timedOut, setTimedOut] = useState(false);

  // A restore that never comes back must not keep the user on a spinner.
  useEffect(() => {
    if (status !== "idle") return;
    const timer = setTimeout(() => {
      setTimedOut(true);
      void restore();
    }, RESTORE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [status, restore]);

  if (status === "idle" && !timedOut) return <Loading label="Restoring session…" />;
  if (status === "ready") return <Redirect href="/(tabs)" />;
  // "error" keeps a reachable-but-unauthenticated user on the login screen.
  if (status === "error" || timedOut) return <Redirect href="/login" />;
  return <Loading label="Connecting…" />;
}
