import { Redirect } from "expo-router";

import { Loading } from "../src/components/ui";
import { useSession } from "../src/state/session";

/**
 * The gate: a saved session goes straight to the workspace, anything else to
 * the sign-in screen.
 */
export default function Index() {
  const status = useSession((state) => state.status);

  if (status === "idle") return <Loading label="Restoring session…" />;
  if (status === "ready" || status === "error") {
    // "error" keeps a reachable-but-unauthenticated user on the login screen.
    return <Redirect href={status === "ready" ? "/(tabs)" : "/login"} />;
  }
  return <Loading label="Connecting…" />;
}
