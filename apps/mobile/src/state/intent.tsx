import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { TicketDraft } from "@/src/lib/intent";

interface IntentValue {
  intent: TicketDraft | null;
  /** Pre-fill the trade ticket. Placement still requires an explicit confirm. */
  setIntent: (draft: TicketDraft) => void;
  clearIntent: () => void;
}

const IntentContext = createContext<IntentValue | null>(null);

/**
 * A signal-to-ticket handoff, held in memory only.
 *
 * Nothing here places an order: selecting a signal fills the ticket and the
 * operator still confirms on the trade screen.
 */
export function IntentProvider({ children }: { children: ReactNode }) {
  const [intent, setIntentState] = useState<TicketDraft | null>(null);

  const setIntent = useCallback((draft: TicketDraft) => setIntentState(draft), []);
  const clearIntent = useCallback(() => setIntentState(null), []);

  const value = useMemo<IntentValue>(() => ({ intent, setIntent, clearIntent }), [intent, setIntent, clearIntent]);

  return <IntentContext.Provider value={value}>{children}</IntentContext.Provider>;
}

export function useIntent(): IntentValue {
  const value = useContext(IntentContext);
  if (!value) throw new Error("useIntent must be used inside IntentProvider");
  return value;
}
