/**
 * Idempotency ledger behaviour: the same client order id must never become two
 * orders, and an unresolved submission must stay blocked until it is
 * reconciled.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GatewayError } from "../errors.js";
import { OrderLedger } from "../idempotency/ledger.js";

function tempLedger(name: string): { ledger: OrderLedger; file: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), `tc-ledger-${name}-`));
  const file = join(dir, "ledger.jsonl");
  return { ledger: new OrderLedger(file, 14), file, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("ledger: a new client order id is claimed and journaled before submission", () => {
  const { ledger, file, cleanup } = tempLedger("new");
  try {
    const outcome = ledger.begin("tc-1", { symbol: "BTCUSD", side: "buy", size: 1 });
    assert.equal(outcome.kind, "new");
    const journal = readFileSync(file, "utf8").trim().split("\n");
    assert.equal(journal.length, 1);
    assert.equal(JSON.parse(journal[0]!).state, "in_flight");
  } finally {
    cleanup();
  }
});

test("ledger: a second request for an in-flight id is a duplicate, not a new claim", () => {
  const { ledger, cleanup } = tempLedger("inflight");
  try {
    assert.equal(ledger.begin("tc-1", { symbol: "BTCUSD" }).kind, "new");
    const second = ledger.begin("tc-1", { symbol: "BTCUSD" });
    assert.equal(second.kind, "duplicate");
    assert.equal(second.kind === "duplicate" && second.record.state, "in_flight");
  } finally {
    cleanup();
  }
});

test("ledger: after submission the stored result is returned (dedupe)", () => {
  const { ledger, cleanup } = tempLedger("submitted");
  try {
    ledger.begin("tc-1", { symbol: "BTCUSD" });
    ledger.markSubmitted("tc-1", { id: 987, state: "open" });
    const outcome = ledger.begin("tc-1", { symbol: "BTCUSD" });
    assert.equal(outcome.kind, "duplicate");
    if (outcome.kind === "duplicate") {
      assert.equal(outcome.record.state, "submitted");
      assert.equal(outcome.record.response?.id, 987);
      assert.equal(outcome.record.deltaOrderId, "987");
    }
  } finally {
    cleanup();
  }
});

test("ledger: an unknown outcome blocks resubmission until it is reconciled", () => {
  const { ledger, cleanup } = tempLedger("unknown");
  try {
    ledger.begin("tc-1", { symbol: "BTCUSD" });
    ledger.markUnknown("tc-1", { reason: "timeout" });
    const outcome = ledger.begin("tc-1", { symbol: "BTCUSD" });
    assert.equal(outcome.kind, "duplicate");
    assert.equal(outcome.kind === "duplicate" && outcome.record.state, "unknown");
  } finally {
    cleanup();
  }
});

test("ledger: reconciliation upgrades an unknown record to submitted", () => {
  const { ledger, cleanup } = tempLedger("reconcile");
  try {
    ledger.begin("tc-1", { symbol: "BTCUSD" });
    ledger.markUnknown("tc-1", { reason: "timeout" });
    ledger.markSubmitted("tc-1", { id: 4242 }, { reconciled: true });
    const outcome = ledger.begin("tc-1", { symbol: "BTCUSD" });
    assert.equal(outcome.kind, "duplicate");
    if (outcome.kind === "duplicate") {
      assert.equal(outcome.record.state, "submitted");
      assert.equal(outcome.record.reconciled, true);
    }
  } finally {
    cleanup();
  }
});

test("ledger: a definite rejection allows a retry with the same id", () => {
  const { ledger, cleanup } = tempLedger("rejected");
  try {
    ledger.begin("tc-1", { symbol: "BTCUSD" });
    ledger.markRejected("tc-1", { reason: "delta_rejected" });
    const outcome = ledger.begin("tc-1", { symbol: "BTCUSD" });
    assert.equal(outcome.kind, "retry");
    if (outcome.kind === "retry") assert.equal(outcome.previous.state, "rejected");
    // ...and the fresh attempt is in flight again.
    assert.equal(ledger.get("tc-1")?.state, "in_flight");
  } finally {
    cleanup();
  }
});

test("ledger: the journal survives a restart (duplicate protection is durable)", () => {
  const { ledger, file, cleanup } = tempLedger("restart");
  try {
    ledger.begin("tc-1", { symbol: "BTCUSD" });
    ledger.markSubmitted("tc-1", { id: 11 });
    const reopened = new OrderLedger(file, 14);
    const outcome = reopened.begin("tc-1", { symbol: "BTCUSD" });
    assert.equal(outcome.kind, "duplicate");
    assert.equal(reopened.get("tc-1")?.state, "submitted");
  } finally {
    cleanup();
  }
});

test("ledger: entries older than the TTL are forgotten", () => {
  const { ledger, cleanup } = tempLedger("ttl");
  try {
    let now = Date.parse("2026-01-01T00:00:00.000Z");
    const dated = new OrderLedger(join(tmpdir(), `tc-ledger-ttl-${Date.now()}.jsonl`), 1, () => now);
    dated.begin("tc-old", { symbol: "BTCUSD" });
    dated.markSubmitted("tc-old", { id: 1 });
    now += 2 * 60 * 60 * 1000; // 2 hours later, TTL is 1 hour
    assert.equal(dated.begin("tc-old", { symbol: "BTCUSD" }).kind, "new");
    ledger.size();
  } finally {
    cleanup();
  }
});

test("ledger: an unwritable journal refuses the claim (fail closed)", () => {
  // The parent path exists but is not a directory, so the append fails
  // immediately (ENOTDIR) instead of blocking on a broken mount.
  const ledger = new OrderLedger("/dev/null/ledger.jsonl", 14);
  assert.throws(
    () => ledger.begin("tc-1", { symbol: "BTCUSD" }),
    (error: unknown) => error instanceof GatewayError && error.status === 503
  );
});

test("ledger: identical-burst detection finds a recent matching order", () => {
  const { ledger, cleanup } = tempLedger("shape");
  try {
    ledger.begin("tc-first", { symbol: "BTCUSD", side: "buy", size: 2 });
    const found = ledger.findRecentByShape("BTCUSD", "buy", 2, 5000);
    assert.equal(found?.clientOrderId, "tc-first");
    assert.equal(ledger.findRecentByShape("BTCUSD", "sell", 2, 5000), undefined);
    assert.equal(ledger.findRecentByShape("BTCUSD", "buy", 3, 5000), undefined);
    assert.equal(ledger.findRecentByShape("ETHUSD", "buy", 2, 5000), undefined);
  } finally {
    cleanup();
  }
});

test("ledger: compaction keeps one record per id", () => {
  const { ledger, file, cleanup } = tempLedger("compact");
  try {
    ledger.begin("tc-1", { symbol: "BTCUSD" });
    ledger.markRejected("tc-1", {});
    ledger.begin("tc-1", { symbol: "BTCUSD" });
    ledger.markSubmitted("tc-1", { id: 5 });
    const before = readFileSync(file, "utf8").trim().split("\n").length;
    const result = ledger.compact();
    assert.equal(before, 4);
    assert.equal(result.after, 1);
    assert.equal(readFileSync(file, "utf8").trim().split("\n").length, 1);
  } finally {
    cleanup();
  }
});
