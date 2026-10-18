/**
 * API client for the Trading Command backend.
 *
 * The mobile app is a pure client of the same Next.js API the desktop
 * terminal uses — it never talks to CoinDCX itself, and it never holds
 * exchange credentials. Two things travel with every request:
 *
 *   Authorization: Bearer <password>
 *       The backend accepts the operator password as a bearer token, which is
 *       the only credential a native app can hold: the browser session cookie
 *       is httpOnly and unreadable from JavaScript.
 *
 *   X-TC-Workspace: paper | live
 *       The backend keeps separate settings, risk limits and account views per
 *       workspace. The app always states which one it is talking to, so a
 *       paper order can never be sent while the live workspace is selected.
 */
import type {
  AccountState, AlertRule, Analysis, AppSettings, Candle, JournalEntry, Mover,
  OrderBook, PaperOrder, PaperPosition, QuantPayload, StrategySignal, SystemStatus, Ticker,
} from "./types";

export type Workspace = "paper" | "live";

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "ApiError";
  }
}

interface ApiConfig {
  baseUrl: string;
  password: string;
  workspace: Workspace | null;
}

const config: ApiConfig = { baseUrl: "", password: "", workspace: null };

export function configureApi(next: Partial<ApiConfig>): void {
  Object.assign(config, next);
}

export function apiConfig(): Readonly<ApiConfig> {
  return { ...config };
}

export function normaliseBaseUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const base = normaliseBaseUrl(config.baseUrl);
  if (!base) throw new ApiError("No server address configured.", 0);
  if (!config.password) throw new ApiError("Not signed in.", 401);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.password}`,
    Accept: "application/json",
  };
  if (config.workspace) headers["X-TC-Workspace"] = config.workspace;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    throw new ApiError("Network error — the server is unreachable.", 0);
  }

  const text = await response.text();
  let data: unknown = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = {};
    }
  }
  if (!response.ok) {
    const message =
      (data as { error?: string })?.error ?? `Request failed (${response.status})`;
    throw new ApiError(String(message), response.status);
  }
  return data as T;
}

const get = <T,>(path: string) => request<T>("GET", path);
const post = <T,>(path: string, body?: unknown) => request<T>("POST", path, body ?? {});
const patch = <T,>(path: string, body?: unknown) => request<T>("PATCH", path, body ?? {});
const del = <T,>(path: string, body?: unknown) => request<T>("DELETE", path, body);

/* ------------------------------------------------------------------ */
/* Endpoints                                                           */
/* ------------------------------------------------------------------ */

export interface TickerResponse {
  tickers: Ticker[];
  source: "demo" | "live";
  known: string[];
}

export interface CandleResponse {
  symbol: string;
  timeframe: string;
  candles: Candle[];
  source: "demo" | "live";
}

export interface StrategyResponse {
  analysis: Analysis | null;
  quant: QuantPayload | null;
  chartType: string;
  source: string;
  enabled: boolean;
  notice?: string;
  error?: string;
}

export interface AccountResponse {
  account: AccountState;
  mode: string;
  liveArmed: boolean;
  exchangeAccountConfigured: boolean;
  paperTradingEnabled: boolean;
}

export interface SettingsResponse {
  settings: AppSettings;
  capabilities: Record<string, boolean>;
}

export interface PaperState {
  positions: PaperPosition[];
  orders: PaperOrder[];
  events: Array<{ type: string; message: string; ts: number }>;
  mode?: string;
}

export interface JournalResponse {
  entries: JournalEntry[];
  total: number;
  legacyCount: number;
  notice?: string;
}

export interface MoversResponse {
  movers: Mover[];
  source?: string;
  asOf?: number;
}

export const api = {
  health: () => get<{ ok: boolean; version?: string }>("/api/health"),
  /** Validate the operator password. The server also records the attempt. */
  login: (password: string) => post<{ ok: boolean; expiresInMs: number }>("/api/auth/login", { password }),
  logout: () => post<{ ok: boolean }>("/api/auth/logout"),
  system: () => get<SystemStatus>("/api/system"),
  settings: () => get<SettingsResponse>("/api/settings"),
  saveSettings: (patchBody: Partial<AppSettings> & { confirm?: string }) =>
    patch<{ settings: AppSettings }>("/api/settings", patchBody),

  tickers: (symbols?: string[]) =>
    get<TickerResponse>(`/api/market/tickers${symbols?.length ? `?symbols=${symbols.join(",")}` : ""}`),
  candles: (symbol: string, timeframe: string, limit = 300) =>
    get<CandleResponse>(`/api/market/candles?symbol=${symbol}&timeframe=${timeframe}&limit=${limit}`),
  orderbook: (symbol: string) =>
    get<{ orderbook: OrderBook | null; trades?: unknown[] }>(`/api/market/orderbook?symbol=${symbol}`),
  movers: () => get<MoversResponse>("/api/market/movers"),

  strategy: (symbol: string, timeframe: string, chartType: "candles" | "heikin-ashi") =>
    get<StrategyResponse>(
      `/api/strategy/evaluate?symbol=${symbol}&timeframe=${timeframe}&chartType=${chartType}`
    ),
  signals: (symbol?: string) =>
    get<{ signals: StrategySignal[] }>(`/api/signals${symbol ? `?symbol=${symbol}` : ""}`),
  updateSignal: (id: string, outcome: string) => patch<{ ok: boolean }>("/api/signals", { id, outcome }),

  account: () => get<AccountResponse>("/api/account"),
  paper: () => get<PaperState>("/api/paper"),
  placePaperOrder: (body: Record<string, unknown>) => post<PaperState & { ok?: boolean }>("/api/paper", body),
  liveOrdersInfo: () =>
    get<{
      liveExecutionFlag: boolean;
      mode: string;
      liveArmed: boolean;
      exchangeConfigured: boolean;
      routedVia: string;
      capabilities: Record<string, boolean>;
    }>("/api/orders"),
  placeLiveOrder: (body: Record<string, unknown>) =>
    post<{ ok: boolean; clientOrderId: string; order?: unknown; status?: string }>("/api/orders", body),
  closeLivePosition: (symbol: string) =>
    post<{ ok: boolean; symbol: string; closedQty: number }>("/api/positions/close", { symbol }),

  journal: () => get<JournalResponse>("/api/journal"),
  annotateJournal: (id: string, patchBody: Record<string, unknown>) =>
    patch<{ entry: JournalEntry }>("/api/journal", { id, ...patchBody }),

  alerts: () => get<{ rules: AlertRule[] }>("/api/alerts"),
  createAlert: (body: Record<string, unknown>) => post<{ rule: AlertRule }>("/api/alerts", body),
  updateAlert: (body: Record<string, unknown>) => patch<{ rule: AlertRule }>("/api/alerts", body),
  deleteAlert: (id: string) => del<{ ok: boolean }>(`/api/alerts?id=${encodeURIComponent(id)}`),

  audit: () => get<{ events: Array<{ id?: string; event: string; at: string; detail?: unknown }> }>("/api/audit"),
};
