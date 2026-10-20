import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SignalRow } from "../src/api/types";
import {
  CLIENT_ORDER_ID_PATTERN,
  draftFromSignal,
  newClientOrderId,
  parseQty,
  sideForStatus,
  signalClientOrderId,
  submitBlocker,
  type TicketDraft,
} from "../src/lib/intent";

const signal: SignalRow = {
  id: "2f1c9f6e-0f4c-4a55-8c1d-6a1f2b3c4d5e",
  symbol: "BTCUSD",
  timeframe: "15m",
  strategy: "tradingview:breakout",
  status: "LONG_SETUP",
  outcome: "ACTIVE",
  price: 108000,
  entry: 107900,
  stop: 106500,
  target: 111000,
  rr: 2,
  reasons: ["test"],
  createdAt: "2026-10-20T10:00:00.000Z",
  updatedAt: "2026-10-20T10:00:00.000Z",
};

const draft: TicketDraft = {
  symbol: "BTCUSD",
  side: "buy",
  qty: "0.01",
  clientOrderId: "m-test-000001",
};

describe("ticket intent", () => {
  it("maps only directional setups to a side", () => {
    assert.equal(sideForStatus("LONG_SETUP"), "buy");
    assert.equal(sideForStatus("SHORT_SETUP"), "sell");
    for (const status of ["WAIT", "WATCH", "INVALIDATED"] as const) {
      assert.equal(sideForStatus(status), null);
    }
  });

  it("pre-fills a ticket from a directional signal", () => {
    const result = draftFromSignal(signal);
    assert.ok(result);
    assert.equal(result.symbol, "BTCUSD");
    assert.equal(result.side, "buy");
    assert.equal(result.entry, 107900);
    assert.equal(result.stop, 106500);
    assert.equal(result.target, 111000);
    assert.equal(result.clientOrderId, signalClientOrderId(signal.id));
    assert.match(result.clientOrderId, CLIENT_ORDER_ID_PATTERN);
  });

  it("refuses to pre-fill from a signal without a real price", () => {
    assert.equal(draftFromSignal({ ...signal, price: 0 }), null);
    assert.equal(draftFromSignal({ ...signal, price: Number.NaN }), null);
    assert.equal(draftFromSignal({ ...signal, status: "WATCH" }), null);
  });

  it("produces short, server-valid client order ids", () => {
    const id = newClientOrderId(1_700_000_000_000, () => 0.5);
    assert.match(id, CLIENT_ORDER_ID_PATTERN);
    assert.ok(id.length <= 64);
    assert.notEqual(id, newClientOrderId(1_700_000_000_000, () => 0.6));
  });

  it("validates quantity without accepting zero or text", () => {
    assert.deepEqual(parseQty(" 0.25 "), { ok: true, qty: 0.25 });
    for (const raw of ["", "0", "-1", "abc", "Infinity", "1e12"]) {
      assert.equal(parseQty(raw).ok, false, `expected ${JSON.stringify(raw)} to be rejected`);
    }
  });

  it("blocks submission outside paper mode", () => {
    assert.equal(submitBlocker(draft, "paper"), null);
    assert.match(submitBlocker(draft, "read_only") ?? "", /READ ONLY/);
    assert.match(submitBlocker(draft, "live") ?? "", /LIVE/);
  });

  it("blocks an invalid ticket even in paper mode", () => {
    assert.match(submitBlocker({ ...draft, symbol: " " }, "paper") ?? "", /symbol/);
    assert.match(submitBlocker({ ...draft, qty: "0" }, "paper") ?? "", /Quantity/);
    assert.match(submitBlocker({ ...draft, clientOrderId: "" }, "paper") ?? "", /id/);
  });
});
