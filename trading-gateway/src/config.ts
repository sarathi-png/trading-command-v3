/**
 * Gateway configuration.
 *
 * Everything the gateway needs comes from the process environment. Nothing is
 * read from disk except the idempotency journal, and no default here is ever a
 * credential — a missing secret makes the gateway refuse to serve, never fall
 * open.
 *
 * `describeConfig()` deliberately returns NAMES and booleans only. It is what
 * /ready and the startup log use, so a misconfigured deployment can be
 * diagnosed without ever printing a secret.
 */

export interface GatewayConfig {
  host: string;
  port: number;
  /** Server-to-server shared secret. Empty string = not configured. */
  gatewaySecret: string;
  deltaApiKey: string;
  deltaApiSecret: string;
  deltaBaseUrl: string;
  liveExecutionEnabled: boolean;
  maxOrderValue: number;
  maxLeverage: number;
  maxOpenPositions: number;
  maxDailyLoss: number;
  allowedSymbols: string[];
  deltaTimeoutMs: number;
  deltaMaxRetries: number;
  requestTimeoutMs: number;
  bodyLimitBytes: number;
  rateLimitWindowMs: number;
  rateLimitReadMax: number;
  rateLimitOrderMax: number;
  trustProxy: boolean;
  corsAllowedOrigins: string[];
  idempotencyStore: string;
  idempotencyTtlHours: number;
  logLevel: LogLevel;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: LogLevel[] = ["debug", "info", "warn", "error"];

/*
 * Every reader takes the environment map explicitly. Reading `process.env`
 * directly inside these helpers would make `loadConfig(env)` misleading: it
 * would look configurable in tests while silently using the real process
 * environment.
 */
function str(env: NodeJS.ProcessEnv, name: string, fallback = ""): string {
  const value = env[name];
  return value === undefined || value === "" ? fallback : value;
}

function int(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  min = 0,
  max = Number.MAX_SAFE_INTEGER
): number {
  const raw = str(env, name);
  if (raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

function bool(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const raw = str(env, name).trim().toLowerCase();
  if (raw === "") return fallback;
  return raw === "true" || raw === "1" || raw === "yes" || raw === "on";
}

function list(env: NodeJS.ProcessEnv, name: string): string[] {
  return str(env, name)
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const logLevelRaw = str(env, "LOG_LEVEL", "info").toLowerCase();
  const logLevel = (LOG_LEVELS as string[]).includes(logLevelRaw)
    ? (logLevelRaw as LogLevel)
    : "info";

  return {
    host: str(env, "HOST", "0.0.0.0"),
    port: int(env, "PORT", 8787),
    gatewaySecret: str(env, "TRADING_GATEWAY_SECRET"),
    deltaApiKey: str(env, "DELTA_API_KEY"),
    deltaApiSecret: str(env, "DELTA_API_SECRET"),
    deltaBaseUrl: str(env, "DELTA_BASE_URL", "https://api.india.delta.exchange").replace(/\/+$/, ""),
    liveExecutionEnabled: bool(env, "LIVE_EXECUTION_ENABLED", false),
    maxOrderValue: int(env, "GATEWAY_MAX_ORDER_VALUE", 5000),
    maxLeverage: int(env, "GATEWAY_MAX_LEVERAGE", 10, 1, 50),
    maxOpenPositions: int(env, "GATEWAY_MAX_OPEN_POSITIONS", 4, 1, 50),
    maxDailyLoss: int(env, "GATEWAY_MAX_DAILY_LOSS", 200, 1),
    allowedSymbols: list(env, "GATEWAY_ALLOWED_SYMBOLS").map((s) => s.toUpperCase()),
    deltaTimeoutMs: int(env, "DELTA_TIMEOUT_MS", 10_000, 500, 60_000),
    // Retries apply to read-only requests only; order submission is never
    // retried automatically (see delta/client.ts).
    deltaMaxRetries: int(env, "DELTA_MAX_RETRIES", 1, 0, 3),
    requestTimeoutMs: int(env, "REQUEST_TIMEOUT_MS", 15_000, 500, 120_000),
    bodyLimitBytes: int(env, "BODY_LIMIT_BYTES", 32 * 1024, 512, 1024 * 1024),
    rateLimitWindowMs: int(env, "RATE_LIMIT_WINDOW_MS", 60_000, 1000, 3_600_000),
    rateLimitReadMax: int(env, "RATE_LIMIT_READ_MAX", 240, 1),
    rateLimitOrderMax: int(env, "RATE_LIMIT_ORDER_MAX", 30, 1),
    trustProxy: bool(env, "TRUST_PROXY", false),
    corsAllowedOrigins: list(env, "CORS_ALLOWED_ORIGINS").filter((o) => o !== "*"),
    idempotencyStore: str(env, "IDEMPOTENCY_STORE", "./data/order-ledger.jsonl"),
    idempotencyTtlHours: int(env, "IDEMPOTENCY_TTL_HOURS", 24 * 14, 1),
    logLevel,
  };
}

export interface ConfigSummary {
  /** True when every value required to serve authenticated traffic is set. */
  ready: boolean;
  /** Environment variable NAMES that are missing (never values). */
  missing: string[];
  /** Environment variable NAMES that are set (never values). */
  present: string[];
  liveExecutionEnabled: boolean;
  deltaBaseHost: string;
}

/** Non-secret summary used by /ready, /health and the startup log. */
export function describeConfig(config: GatewayConfig): ConfigSummary {
  const required: [string, string][] = [
    ["TRADING_GATEWAY_SECRET", config.gatewaySecret],
    ["DELTA_API_KEY", config.deltaApiKey],
    ["DELTA_API_SECRET", config.deltaApiSecret],
  ];
  const missing = required.filter(([, value]) => value === "").map(([name]) => name);
  const present = required.filter(([, value]) => value !== "").map(([name]) => name);

  let deltaBaseHost = "";
  try {
    deltaBaseHost = new URL(config.deltaBaseUrl).host;
  } catch {
    deltaBaseHost = "invalid";
  }

  const problems: string[] = missing;
  try {
    new URL(config.deltaBaseUrl);
  } catch {
    problems.push("DELTA_BASE_URL");
  }

  return {
    ready: problems.length === 0,
    missing,
    present,
    liveExecutionEnabled: config.liveExecutionEnabled,
    deltaBaseHost,
  };
}
