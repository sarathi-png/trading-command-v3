/**
 * The chart page is a plain string builder, so it can be checked in Node
 * without a WebView.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildChartHtml } from "../chartHtml";

test("the library is inlined and the bridge is defined", () => {
  const html = buildChartHtml("window.LightweightCharts = {};");
  assert.match(html, /window\.LightweightCharts = \{\};/);
  assert.match(html, /window\.__tcChart/);
  assert.match(html, /setData/);
  assert.match(html, /ReactNativeWebView\.postMessage/);
});

test("a closing script tag inside the library cannot break out", () => {
  const html = buildChartHtml("var s = '</script><script>alert(1)</script>';");
  assert.ok(!html.includes("</script><script>alert(1)"));
  assert.match(html, /<\\\/script>/);
});

test("the page is a complete document", () => {
  const html = buildChartHtml("");
  assert.match(html, /^<!DOCTYPE html>/);
  assert.match(html, /<meta name="viewport"/);
  assert.match(html, /id="chart"/);
});

test("the page can draw the Pine boxes, labels and tables", () => {
  const html = buildChartHtml("");
  assert.match(html, /id="overlay"/);
  assert.match(html, /function renderDrawings/);
  assert.match(html, /timeToCoordinate/);
  assert.match(html, /priceToCoordinate/);
});
