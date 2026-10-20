import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { Workspace } from "@/src/api/types";

interface WorkspaceValue {
  workspace: Workspace;
  setWorkspace: (next: Workspace) => void;
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

/**
 * The selected workspace, defaulting to paper on every launch.
 *
 * This is not persisted on purpose: a relaunch should never surprise the
 * operator by opening the live workspace. The server still enforces the
 * workspace header on every request.
 */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspace, setWorkspace] = useState<Workspace>("paper");
  const value = useMemo<WorkspaceValue>(() => ({ workspace, setWorkspace }), [workspace]);
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return value;
}
