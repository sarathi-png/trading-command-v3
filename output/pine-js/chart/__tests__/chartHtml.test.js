"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * The chart page is a plain string builder, so it can be checked in Node
 * without a WebView.
 */
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const chartHtml_1 = require("../chartHtml");
(0, node_test_1.test)("the library is inlined and the bridge is defined", () => {
    const html = (0, chartHtml_1.buildChartHtml)("window.LightweightCharts = {};");
    strict_1.default.match(html, /window\.LightweightCharts = \{\};/);
    strict_1.default.match(html, /window\.__tcChart/);
    strict_1.default.match(html, /setData/);
    strict_1.default.match(html, /ReactNativeWebView\.postMessage/);
});
(0, node_test_1.test)("a closing script tag inside the library cannot break out", () => {
    const html = (0, chartHtml_1.buildChartHtml)("var s = '</script><script>alert(1)</script>';");
    strict_1.default.ok(!html.includes("</script><script>alert(1)"));
    strict_1.default.match(html, /<\\\/script>/);
});
(0, node_test_1.test)("the page is a complete document", () => {
    const html = (0, chartHtml_1.buildChartHtml)("");
    strict_1.default.match(html, /^<!DOCTYPE html>/);
    strict_1.default.match(html, /<meta name="viewport"/);
    strict_1.default.match(html, /id="chart"/);
});
(0, node_test_1.test)("the page can draw the Pine boxes, labels and tables", () => {
    const html = (0, chartHtml_1.buildChartHtml)("");
    strict_1.default.match(html, /id="overlay"/);
    strict_1.default.match(html, /function renderDrawings/);
    strict_1.default.match(html, /timeToCoordinate/);
    strict_1.default.match(html, /priceToCoordinate/);
});
