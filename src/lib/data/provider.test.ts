import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MARKET_FANOUT_LIMIT, mapLimit } from "./provider";

describe("provider fan-out", () => {
  it("never exceeds the configured concurrency cap", async () => {
    let active = 0;
    let peak = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);
    const out = await mapLimit(items, MARKET_FANOUT_LIMIT, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active--;
      return n * 2;
    });
    assert.equal(peak, MARKET_FANOUT_LIMIT);
    assert.deepEqual(out, items.map((n) => n * 2), "results preserve input order");
  });

  it("handles an empty batch and a cap larger than the batch", async () => {
    assert.deepEqual(await mapLimit([], 3, async (n: number) => n), []);
    assert.deepEqual(await mapLimit([1, 2], 99, async (n) => n + 1), [2, 3]);
  });
});
