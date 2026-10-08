/**
 * Durable order idempotency ledger.
 *
 * The failure this file exists to prevent: the same logical order reaching
 * Delta twice. That can happen because of a browser double-click, a Vercel
 * retry, a gateway restart mid-request, or a lost response. The ledger is
 * keyed by `client_order_id`, which Delta also enforces on open orders, and it
 * is written to an append-only journal BEFORE the request leaves for the
 * exchange — so a crash cannot lose the record of an in-flight submission.
 *
 * State machine (one row per attempt, last row wins):
 *
 *   in_flight ──► submitted   Delta accepted (or reconciliation found it)
 *             ├─► rejected    Delta answered and refused: no order exists
 *             └─► unknown     no answer / 5xx / timeout: MUST be reconciled
 *
 * Behaviour on a repeated client_order_id:
 *
 *   in_flight  -> 409: an earlier attempt is unresolved; reconcile first
 *   unknown    -> 409: the exchange may hold this order; reconcile first
 *   submitted  -> 200: return the stored result, `deduplicated: true`
 *   rejected   -> retry allowed: Delta definitively refused, nothing exists
 *
 * If the journal cannot be written, submission is refused (fail closed): an
 * idempotency guarantee that silently disappears under disk pressure is worse
 * than no order at all.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { GatewayError } from "../errors.js";

export type LedgerState = "in_flight" | "submitted" | "rejected" | "unknown";

export interface LedgerRecord {
  clientOrderId: string;
  state: LedgerState;
  at: string;
  /** Local bookkeeping (symbol, side, size, risk verdict, gateway request id). */
  meta?: Record<string, unknown>;
  /** Delta's order payload once known (never a credential). */
  response?: Record<string, unknown> | null;
  deltaOrderId?: string | null;
  /** True when the state was established by reconciliation, not by submission. */
  reconciled?: boolean;
  /** Set when a cancel request was accepted for this order. */
  cancelled?: boolean;
  /** Free-form note (rejection reason, reconciliation source, ...). */
  note?: string;
}

export type BeginOutcome =
  | { kind: "new" }
  | { kind: "retry"; previous: LedgerRecord }
  | { kind: "duplicate"; record: LedgerRecord };

export class OrderLedger {
  private readonly entries = new Map<string, LedgerRecord>();

  constructor(
    private readonly filePath: string,
    private readonly ttlHours: number,
    private readonly now: () => number = () => Date.now()
  ) {
    // Create the journal directory ONCE, at startup, nowhere near the order
    // path: a pathological path (unwritable mount, /proc, a network filesystem
    // that never answers) must fail at boot where an operator can see it, not
    // block a live order mid-flight.
    try {
      if (!existsSync(dirname(this.filePath))) mkdirSync(dirname(this.filePath), { recursive: true });
    } catch {
      /* reported by the first write attempt, which fails closed */
    }
    this.load();
  }

  private get ttlMs(): number {
    return this.ttlHours * 60 * 60 * 1000;
  }

  /** Read the journal, keeping the newest record per client order id. */
  private load(): void {
    if (!existsSync(this.filePath)) return;
    let contents: string;
    try {
      contents = readFileSync(this.filePath, "utf8");
    } catch {
      return;
    }
    const cutoff = this.now() - this.ttlMs;
    for (const line of contents.split("\n")) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line) as LedgerRecord;
        if (!record?.clientOrderId || !record.state) continue;
        const at = Date.parse(record.at);
        if (!Number.isFinite(at) || at < cutoff) continue;
        this.entries.set(record.clientOrderId, record);
      } catch {
        // A truncated final line (crash mid-write) is skipped, not fatal.
      }
    }
  }

  private persist(record: LedgerRecord): void {
    try {
      // No mkdir here: the directory is created at startup. A synchronous
      // mkdir on the request path could block forever on a broken mount, and a
      // hung order request is worse than a refused one.
      appendFileSync(this.filePath, `${JSON.stringify(record)}\n`, { encoding: "utf8" });
    } catch (error) {
      throw new GatewayError(
        "IDEMPOTENCY_CONFLICT",
        503,
        "The order ledger is not writable, so order submission is refused.",
        { reason: error instanceof Error ? error.name : "write_failed" }
      );
    }
  }

  get(clientOrderId: string): LedgerRecord | undefined {
    return this.entries.get(clientOrderId);
  }

  /**
   * Claim a client order id. Writes `in_flight` durably before returning, so
   * the caller can only send the order once the claim exists on disk.
   */
  begin(clientOrderId: string, meta: Record<string, unknown>): BeginOutcome {
    const existing = this.entries.get(clientOrderId);
    if (existing) {
      const age = this.now() - Date.parse(existing.at);
      const expired = !Number.isFinite(age) || age > this.ttlMs;
      if (!expired) {
        if (existing.state === "rejected") {
          this.record(clientOrderId, "in_flight", meta);
          return { kind: "retry", previous: existing };
        }
        return { kind: "duplicate", record: existing };
      }
    }
    this.record(clientOrderId, "in_flight", meta);
    return { kind: "new" };
  }

  private record(
    clientOrderId: string,
    state: LedgerState,
    meta?: Record<string, unknown>,
    extra: Partial<LedgerRecord> = {}
  ): LedgerRecord {
    const entry: LedgerRecord = {
      clientOrderId,
      state,
      at: new Date(this.now()).toISOString(),
      ...(meta ? { meta } : {}),
      ...extra,
    };
    this.persist(entry);
    this.entries.set(clientOrderId, entry);
    return entry;
  }

  /** Delta accepted the order (or an order was found by reconciliation). */
  markSubmitted(
    clientOrderId: string,
    response: Record<string, unknown> | null,
    options: { reconciled?: boolean; meta?: Record<string, unknown> } = {}
  ): LedgerRecord {
    const deltaOrderId =
      response && response.id !== undefined && response.id !== null ? String(response.id) : null;
    return this.record(clientOrderId, "submitted", options.meta, {
      response,
      deltaOrderId,
      ...(options.reconciled ? { reconciled: true } : {}),
    });
  }

  /** Delta answered and refused: no order exists for this id. */
  markRejected(clientOrderId: string, meta?: Record<string, unknown>): LedgerRecord {
    return this.record(clientOrderId, "rejected", meta, { response: null });
  }

  /** No usable answer: the exchange may hold the order. Reconcile before retry. */
  markUnknown(clientOrderId: string, meta?: Record<string, unknown>): LedgerRecord {
    return this.record(clientOrderId, "unknown", meta, { response: null });
  }

  /**
   * Record that a cancel was accepted. The order state itself is kept: a
   * cancelled order was still submitted once, and must never be resubmitted.
   */
  markCancelled(clientOrderId: string, meta?: Record<string, unknown>): LedgerRecord {
    const existing = this.entries.get(clientOrderId);
    const state: LedgerState = existing?.state === "unknown" || existing?.state === "in_flight"
      ? "submitted"
      : existing?.state ?? "submitted";
    return this.record(clientOrderId, state, meta, {
      response: existing?.response ?? null,
      ...(existing?.deltaOrderId ? { deltaOrderId: existing.deltaOrderId } : {}),
      cancelled: true,
      note: "cancel accepted",
    });
  }

  /**
   * Duplicate-order protection for callers that generate a FRESH client order
   * id for a retried logical order (browser retry, double-click). Looks for a
   * recent in-flight or submitted record with the same shape.
   */
  findRecentByShape(
    symbol: string,
    side: string,
    size: number,
    windowMs: number,
    options: { excludeClientOrderId?: string; now?: number } = {}
  ): LedgerRecord | undefined {
    const now = options.now ?? this.now();
    let newest: LedgerRecord | undefined;
    for (const entry of this.entries.values()) {
      // The caller's own freshly-claimed record is not a duplicate of itself.
      if (options.excludeClientOrderId && entry.clientOrderId === options.excludeClientOrderId) continue;
      if (entry.state !== "in_flight" && entry.state !== "submitted") continue;
      const meta = entry.meta ?? {};
      if (String(meta.symbol ?? "") !== symbol) continue;
      if (String(meta.side ?? "") !== side) continue;
      if (Number(meta.size ?? 0) !== size) continue;
      const at = Date.parse(entry.at);
      if (!Number.isFinite(at) || now - at > windowMs) continue;
      if (!newest || Date.parse(newest.at) < at) newest = entry;
    }
    return newest;
  }

  /**
   * Compaction: rewrite the journal with one record per id. Called on startup
   * so the file does not grow without bound. Safe because the in-memory map is
   * already the authoritative newest-wins view.
   */
  compact(): { before: number; after: number } {
    let before = 0;
    try {
      if (existsSync(this.filePath)) before = readFileSync(this.filePath, "utf8").split("\n").filter(Boolean).length;
    } catch {
      before = 0;
    }
    const tmp = `${this.filePath}.tmp`;
    const lines = [...this.entries.values()].map((entry) => JSON.stringify(entry));
    try {
      writeFileSync(tmp, lines.length ? `${lines.join("\n")}\n` : "", "utf8");
      if (existsSync(this.filePath)) {
        // Keep a single-.bak of the previous journal for forensics.
        writeFileSync(`${this.filePath}.bak`, readFileSync(this.filePath, "utf8"), "utf8");
      }
      renameSync(tmp, this.filePath);
    } catch {
      return { before, after: this.entries.size };
    }
    return { before, after: this.entries.size };
  }

  size(): number {
    return this.entries.size;
  }
}
