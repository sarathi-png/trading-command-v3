"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.api = exports.ApiError = void 0;
exports.configureApi = configureApi;
exports.apiConfig = apiConfig;
exports.normaliseBaseUrl = normaliseBaseUrl;
class ApiError extends Error {
    constructor(message, status) {
        super(message);
        this.status = status;
        this.name = "ApiError";
    }
}
exports.ApiError = ApiError;
const config = { baseUrl: "", password: "", workspace: null };
function configureApi(next) {
    Object.assign(config, next);
}
function apiConfig() {
    return { ...config };
}
function normaliseBaseUrl(url) {
    const trimmed = url.trim().replace(/\/+$/, "");
    if (!trimmed)
        return "";
    if (/^https?:\/\//i.test(trimmed))
        return trimmed;
    return `https://${trimmed}`;
}
async function request(method, path, body) {
    const base = normaliseBaseUrl(config.baseUrl);
    if (!base)
        throw new ApiError("No server address configured.", 0);
    if (!config.password)
        throw new ApiError("Not signed in.", 401);
    const headers = {
        Authorization: `Bearer ${config.password}`,
        Accept: "application/json",
    };
    if (config.workspace)
        headers["X-TC-Workspace"] = config.workspace;
    if (body !== undefined)
        headers["Content-Type"] = "application/json";
    let response;
    try {
        response = await fetch(`${base}${path}`, {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
            cache: "no-store",
        });
    }
    catch {
        throw new ApiError("Network error — the server is unreachable.", 0);
    }
    const text = await response.text();
    let data = {};
    if (text) {
        try {
            data = JSON.parse(text);
        }
        catch {
            data = {};
        }
    }
    if (!response.ok) {
        const message = data?.error ?? `Request failed (${response.status})`;
        throw new ApiError(String(message), response.status);
    }
    return data;
}
const get = (path) => request("GET", path);
const post = (path, body) => request("POST", path, body ?? {});
const patch = (path, body) => request("PATCH", path, body ?? {});
const del = (path, body) => request("DELETE", path, body);
exports.api = {
    health: () => get("/api/health"),
    /** Validate the operator password. The server also records the attempt. */
    login: (password) => post("/api/auth/login", { password }),
    logout: () => post("/api/auth/logout"),
    system: () => get("/api/system"),
    settings: () => get("/api/settings"),
    saveSettings: (patchBody) => patch("/api/settings", patchBody),
    tickers: (symbols) => get(`/api/market/tickers${symbols?.length ? `?symbols=${symbols.join(",")}` : ""}`),
    candles: (symbol, timeframe, limit = 300) => get(`/api/market/candles?symbol=${symbol}&timeframe=${timeframe}&limit=${limit}`),
    orderbook: (symbol) => get(`/api/market/orderbook?symbol=${symbol}`),
    movers: () => get("/api/market/movers"),
    strategy: (symbol, timeframe, chartType) => get(`/api/strategy/evaluate?symbol=${symbol}&timeframe=${timeframe}&chartType=${chartType}`),
    signals: (symbol) => get(`/api/signals${symbol ? `?symbol=${symbol}` : ""}`),
    updateSignal: (id, outcome) => patch("/api/signals", { id, outcome }),
    account: () => get("/api/account"),
    paper: () => get("/api/paper"),
    placePaperOrder: (body) => post("/api/paper", body),
    liveOrdersInfo: () => get("/api/orders"),
    placeLiveOrder: (body) => post("/api/orders", body),
    closeLivePosition: (symbol) => post("/api/positions/close", { symbol }),
    journal: () => get("/api/journal"),
    annotateJournal: (id, patchBody) => patch("/api/journal", { id, ...patchBody }),
    alerts: () => get("/api/alerts"),
    createAlert: (body) => post("/api/alerts", body),
    updateAlert: (body) => patch("/api/alerts", body),
    deleteAlert: (id) => del(`/api/alerts?id=${encodeURIComponent(id)}`),
    audit: () => get("/api/audit"),
};
