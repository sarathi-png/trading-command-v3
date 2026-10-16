"use client";
export type Workspace = "paper" | "live";
let memory: Workspace | null = null;
export function workspaceSelection(): Workspace | null {
  try {
    const value = sessionStorage.getItem("tc-workspace");
    return value === "paper" || value === "live" ? value : memory;
  } catch { return memory; }
}
export function selectWorkspace(value: Workspace | null) {
  memory = value;
  try {
    if (value) sessionStorage.setItem("tc-workspace", value);
    else sessionStorage.removeItem("tc-workspace");
  } catch { /* Embedded previews may deny storage. */ }
}
