import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { cached, clearMarketCache } from "./cache";

describe("market cache", () => {
  it("serves a hit within the TTL", async () => {
    clearMarketCache();
    let calls = 0;
    const load = async () => {
      calls += 1;
      return calls;
    };
    assert.equal(await cached("k", 1000, load), 1);
    assert.equal(await cached("k", 1000, load), 1);
    assert.equal(calls, 1);
  });

  it("reloads after the TTL", async () => {
    clearMarketCache();
    let calls = 0;
    const load = async () => ++calls;
    await cached("k", -1, load);
    assert.equal(await cached("k", -1, load), 2);
  });

  it("de-duplicates concurrent misses", async () => {
    clearMarketCache();
    let calls = 0;
    let release: (value: number) => void = () => undefined;
    const gate = new Promise<number>((resolve) => {
      release = resolve;
    });
    const load = async () => {
      calls += 1;
      return gate;
    };
    const a = cached("k", 1000, load);
    const b = cached("k", 1000, load);
    release(7);
    assert.deepEqual(await Promise.all([a, b]), [7, 7]);
    assert.equal(calls, 1);
  });

  it("does not cache failures", async () => {
    clearMarketCache();
    let calls = 0;
    const load = async () => {
      calls += 1;
      if (calls === 1) throw new Error("venue down");
      return "ok";
    };
    await assert.rejects(cached("k", 1000, load), /venue down/);
    assert.equal(await cached("k", 1000, load), "ok");
    assert.equal(calls, 2);
  });
});
