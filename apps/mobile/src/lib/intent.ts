/**
 * Ticket logic shared by the trade screen and the signal inbox.
 *
 * Pure functions only: no React, no React Native. The important rules live
 * here so they can be tested directly:
 *   - a signal only pre-fills a ticket for LONG_SETUP / SHORT_SETUP
 *   - a signal without a real positive price pre-fills nothing
 *   - the client order id is stable per intent, which is what makes a retry
 *     idempotent on the server
 *   - submission is blocked unless the server mode is `paper`
 */
import type { Mode, SignalRow, SignalStatus } from "../api/types";

export type OrderSide = "buy" | "sell";

export interface TicketDraft {
  symbol: string;
  side: OrderSide;
  qty: string;
  clientOrderId: string;
  signalId?: string;
  entry?: number | null;
  stop?: number | null;
  target?: number | null;
}

export type QtyResult = { ok: true; qty: number } | { ok: false; error: string };

export function sideForStatus(status: SignalStatus): OrderSide | null {
  if (status === "LONG_SETUP") return "buy";
  if (status === "SHORT_SETUP") return "sell";
  return null;
}

/** Server rule: 1-64 chars of [A-Za-z0-9._:-]. Signal ids are UUIDs. */
export function signalClientOrderId(signalId: string): string {
  return `sig:${signalId}`;
}

/** A fresh idempotency key. Generated once per ticket, reused on retry. */
export function newClientOrderId(now = Date.now(), random: () => number = Math.random): string {
  const suffix = Math.floor(random() * 36 ** 6)
    .toString(36)
    .padStart(6, "0");
  return `m-${now.toString(36)}-${suffix}`;
}

/**
 * Build a ticket from a signal.
 *
 * Returns null for WATCH/WAIT/INVALIDATED signals and for a signal whose price
 * is not a real positive number — the app must not invent one.
 */
export function draftFromSignal(signal: SignalRow, qty = "0.001"): TicketDraft | null {
  const side = sideForStatus(signal.status);
  if (!side) return null;
  if (!Number.isFinite(signal.price) || signal.price <= 0) return null;
  return {
    symbol: signal.symbol,
    side,
    qty,
    clientOrderId: signalClientOrderId(signal.id),
    signalId: signal.id,
    entry: Number.isFinite(signal.entry as number) ? (signal.entry as number) : signal.price,
    stop: signal.stop,
    target: signal.target,
  };
}

export function parseQty(raw: string): QtyResult {
  const text = raw.trim();
  if (!text) return { ok: false, error: "Enter a quantity" };
  const qty = Number(text);
  if (!Number.isFinite(qty) || qty <= 0) {
    return { ok: false, error: "Quantity must be a positive number" };
  }
  if (qty > 1_000_000) return { ok: false, error: "Quantity is unreasonably large" };
  return { ok: true, qty };
}

/** Human-readable reason the ticket cannot submit, or null when it can. */
export function submitBlocker(draft: TicketDraft, mode: Mode): string | null {
  if (mode !== "paper") {
    return mode === "live"
      ? "The server is in LIVE mode. Paper orders are refused."
      : "The server is in READ ONLY mode. Switch to PAPER to place paper orders.";
  }
  if (!draft.symbol.trim()) return "Enter a symbol";
  const parsed = parseQty(draft.qty);
  if (!parsed.ok) return parsed.error;
  if (!draft.clientOrderId) return "Order id is missing";
  return null;
}

export const CLIENT_ORDER_ID_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;
