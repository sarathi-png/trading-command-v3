import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  UnsupportedTimeframeError,
  isTimeframeSupported,
  resolutionForTimeframe,
} from "./timeframes";
import type { Timeframe } from "@/lib/types";

describe("resolutionForTimeframe", () => {
  const cases: Array<[number, string]> = [
    [60, "1"],
    [300, "5"],
    [900, "15"],
    [3600, "60"],
    [14400, "240"],
    [86400, "1D"],
  ];

  for (const [seconds, expected] of cases) {
    it(`maps ${seconds}s to ${expected}`, () => {
      assert.equal(resolutionForTimeframe(seconds), expected);
    });
  }

  // These previously fell through to "60", silently serving 1H bars labelled
  // as 3m/30m/2H/1W. Wrong data is worse than an explicit error.
  for (const seconds of [180, 1800, 7200, 604800]) {
    it(`refuses ${seconds}s instead of guessing`, () => {
      assert.throws(() => resolutionForTimeframe(seconds), UnsupportedTimeframeError);
    });
  }
});

describe("isTimeframeSupported", () => {
  it("marks only venue-published timeframes as supported", () => {
    const expected: Record<Timeframe, boolean> = {
      "1m": true,
      "3m": false,
      "5m": true,
      "15m": true,
      "30m": false,
      "1H": true,
      "2H": false,
      "4H": true,
      "1D": true,
      "1W": false,
    };
    for (const [tf, supported] of Object.entries(expected)) {
      assert.equal(isTimeframeSupported(tf as Timeframe), supported, tf);
    }
  });
});
