import type { Mode, SignalStatus } from "../api/types";

export type StatusTone = "neutral" | "accent" | "positive" | "negative" | "warning" | "paper" | "live";

export function modeLabel(mode: Mode | null | undefined): string {
  if (mode === "paper") return "PAPER";
  if (mode === "live") return "LIVE";
  if (mode === "read_only") return "READ ONLY";
  return "MODE UNAVAILABLE";
}

export function modeTone(mode: Mode | null | undefined): StatusTone {
  if (mode === "paper") return "paper";
  if (mode === "live") return "live";
  if (mode === "read_only") return "neutral";
  return "warning";
}

export function signalTone(status: SignalStatus): StatusTone {
  if (status === "LONG_SETUP") return "positive";
  if (status === "SHORT_SETUP") return "negative";
  if (status === "INVALIDATED") return "warning";
  return "neutral";
}

export function signalLabel(status: SignalStatus): string {
  return status.replace("_", " ");
}
