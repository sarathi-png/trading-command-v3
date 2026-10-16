import { headers } from "next/headers";

export type Workspace = "paper" | "live";
export function parseWorkspace(value: string | null): Workspace | null {
  return value === "paper" || value === "live" ? value : null;
}
/** Request-local selection. Never cache a workspace in process-global state. */
export async function requestWorkspace(): Promise<Workspace | null> {
  try { return parseWorkspace((await headers()).get("x-tc-workspace")); }
  catch { return null; } // CLI jobs have no browser request scope.
}
