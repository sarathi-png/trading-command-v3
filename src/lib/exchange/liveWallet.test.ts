import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { selectLiveWallet, toUsd } from "./liveWallet";

describe("selectLiveWallet", () => {
  it("prefers a USD-like wallet over INR", () => {
    const w = selectLiveWallet([
      { asset: "INR", balance: 5000, available: 4000 },
      { asset: "USDT", balance: 100, available: 90 },
    ]);
    assert.deepEqual(w, { currency: "USD", asset: "USDT", balance: 100, available: 90 });
  });

  it("falls back to the INR wallet when no USD wallet exists", () => {
    const w = selectLiveWallet([{ asset: "inr", balance: 8800, available: 8000 }]);
    assert.deepEqual(w, { currency: "INR", asset: "INR", balance: 8800, available: 8000 });
  });

  it("returns null when neither wallet exists", () => {
    assert.equal(selectLiveWallet([{ asset: "BTC", balance: 1, available: 1 }]), null);
    assert.equal(selectLiveWallet([]), null);
  });
});

describe("toUsd", () => {
  it("leaves USD amounts unchanged", () => {
    const w = { currency: "USD" as const, asset: "USDT", balance: 100, available: 90 };
    assert.equal(toUsd(100, w, 88), 100);
  });

  it("converts INR amounts with the manual rate", () => {
    const w = { currency: "INR" as const, asset: "INR", balance: 8800, available: 8800 };
    assert.equal(toUsd(8800, w, 88), 100);
  });

  it("refuses to convert INR without a valid rate", () => {
    const w = { currency: "INR" as const, asset: "INR", balance: 1, available: 1 };
    assert.throws(() => toUsd(1, w, 0), /rate is not set/);
  });
});
