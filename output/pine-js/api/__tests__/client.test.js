"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * API client tests.
 *
 * The mobile app is a client of the desktop backend, so the contract that
 * matters is: which URL is called, which headers travel with it, and how a
 * server error is surfaced. A tiny mock server stands in for the real API.
 */
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_http_1 = require("node:http");
const client_1 = require("../client");
async function startMock(handler) {
    const recorded = [];
    const server = (0, node_http_1.createServer)((request, response) => {
        let body = "";
        request.on("data", (chunk) => {
            body += chunk;
        });
        request.on("end", () => {
            const entry = {
                url: request.url ?? "",
                headers: request.headers,
                method: request.method ?? "GET",
                body,
            };
            recorded.push(entry);
            const result = handler(entry);
            response.writeHead(result.status, { "Content-Type": "application/json" });
            response.end(JSON.stringify(result.body));
        });
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    return { server, url: `http://127.0.0.1:${port}`, recorded };
}
function stop(server) {
    return new Promise((resolve) => server.close(() => resolve()));
}
(0, node_test_1.test)("requests carry the bearer token and the workspace header", async () => {
    const mock = await startMock(() => ({ status: 200, body: { settings: {}, capabilities: {} } }));
    try {
        (0, client_1.configureApi)({ baseUrl: mock.url, password: "secret", workspace: "paper" });
        await client_1.api.settings();
        const request = mock.recorded[0];
        strict_1.default.equal(request.headers.authorization, "Bearer secret");
        strict_1.default.equal(request.headers["x-tc-workspace"], "paper");
        strict_1.default.equal(request.url, "/api/settings");
    }
    finally {
        await stop(mock.server);
    }
});
(0, node_test_1.test)("the workspace header changes with the selected workspace", async () => {
    const mock = await startMock(() => ({ status: 200, body: { settings: {}, capabilities: {} } }));
    try {
        (0, client_1.configureApi)({ baseUrl: mock.url, password: "secret", workspace: "live" });
        await client_1.api.settings();
        strict_1.default.equal(mock.recorded[0].headers["x-tc-workspace"], "live");
    }
    finally {
        await stop(mock.server);
    }
});
(0, node_test_1.test)("server errors are surfaced with the server's message", async () => {
    const mock = await startMock(() => ({
        status: 403,
        body: { error: "Live trading is not armed. Enable LIVE mode and the master switch first." },
    }));
    try {
        (0, client_1.configureApi)({ baseUrl: mock.url, password: "secret", workspace: "live" });
        await strict_1.default.rejects(() => client_1.api.placeLiveOrder({ symbol: "BTCUSD", side: "buy", size: 1 }), (error) => {
            strict_1.default.ok(error instanceof client_1.ApiError);
            strict_1.default.equal(error.status, 403);
            strict_1.default.match(error.message, /not armed/);
            return true;
        });
    }
    finally {
        await stop(mock.server);
    }
});
(0, node_test_1.test)("a missing server address fails fast with a readable message", async () => {
    (0, client_1.configureApi)({ baseUrl: "", password: "secret", workspace: "paper" });
    await strict_1.default.rejects(() => client_1.api.account(), (error) => {
        strict_1.default.ok(error instanceof client_1.ApiError);
        strict_1.default.match(error.message, /server address/i);
        return true;
    });
});
(0, node_test_1.test)("query parameters are encoded", async () => {
    const mock = await startMock(() => ({ status: 200, body: { candles: [], source: "demo" } }));
    try {
        (0, client_1.configureApi)({ baseUrl: mock.url, password: "secret", workspace: "paper" });
        await client_1.api.candles("BTCUSD", "15m", 300);
        strict_1.default.equal(mock.recorded[0].url, "/api/market/candles?symbol=BTCUSD&timeframe=15m&limit=300");
    }
    finally {
        await stop(mock.server);
    }
});
(0, node_test_1.test)("a live order sends the fields the server expects", async () => {
    const mock = await startMock(() => ({ status: 200, body: { ok: true, clientOrderId: "x" } }));
    try {
        (0, client_1.configureApi)({ baseUrl: mock.url, password: "secret", workspace: "live" });
        await client_1.api.placeLiveOrder({
            symbol: "BTCUSD",
            side: "buy",
            type: "market_order",
            size: 0.5,
            client_order_id: "tc-abc",
        });
        const body = JSON.parse(mock.recorded[0].body);
        strict_1.default.equal(body.symbol, "BTCUSD");
        strict_1.default.equal(body.side, "buy");
        strict_1.default.equal(body.size, 0.5);
        strict_1.default.equal(body.client_order_id, "tc-abc");
    }
    finally {
        await stop(mock.server);
    }
});
(0, node_test_1.test)("a base url without a scheme is treated as https", () => {
    strict_1.default.equal((0, client_1.normaliseBaseUrl)("example.test"), "https://example.test");
    strict_1.default.equal((0, client_1.normaliseBaseUrl)("  https://example.test/  "), "https://example.test");
    strict_1.default.equal((0, client_1.normaliseBaseUrl)("http://192.168.1.10:3000"), "http://192.168.1.10:3000");
    strict_1.default.equal((0, client_1.normaliseBaseUrl)(""), "");
});
