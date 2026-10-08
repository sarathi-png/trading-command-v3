/**
 * Exchange credential STATUS for the application.
 *
 * After the CoinDCX migration the application IS the exchange client: the API
 * routes sign CoinDCX requests directly (src/lib/exchange), so the credentials
 * live in the Vercel environment as COINDCX_API_KEY / COINDCX_API_SECRET.
 * Nothing is stored in the database, and this module never returns a value —
 * only whether the variables are present, and which NAMES are missing.
 *
 * History worth knowing before changing this file:
 *   - An older deployment let the browser save an encrypted Delta key/secret in
 *     the settings table (`credentials.delta`). That path was removed, the
 *     ability to save keys from the UI is gone, and `purgeLegacyDeltaCredentials()`
 *     deletes the leftover row. Anything that could read a stored secret into
 *     the process is deliberately absent.
 *   - The intermediate design routed private calls through a static-IP gateway
 *     holding the keys. CoinDCX does not require an IP-bound key, so the gateway
 *     hop is gone from the application (the standalone service remains in
 *     trading-gateway/ but is no longer part of the request path).
 */
import { getRepo } from "@/lib/repo";
import { exchangeConfigState } from "@/lib/exchange/service";

/** Where the legacy encrypted Delta credentials used to be stored. */
const LEGACY_CREDENTIALS_KEY = "credentials.delta";

export type CredentialSource = "environment" | "none";

export interface ExchangeCredentialStatus {
  /** True when the exchange can be called with credentials. */
  configured: boolean;
  source: CredentialSource;
  /** Venue the credentials belong to ("coindcx"). */
  exchange: string;
  /** Environment variable NAMES that are unset. Never values. */
  missing: string[];
  /** One variable set without the other — a deployment mistake. */
  misconfigured: boolean;
  /** Host the credentials will be sent to (no secret, no key). */
  baseUrl: string;
  /** True when an old deployment stored encrypted Delta keys in the database. */
  legacyStoredKeys: boolean;
}

/** Whether the legacy key row still exists. Never returns the value. */
async function legacyRowExists(): Promise<boolean> {
  try {
    const stored = await (await getRepo()).getSetting(LEGACY_CREDENTIALS_KEY);
    return stored !== null && stored !== undefined;
  } catch {
    // Database unavailable: report "no legacy row" rather than failing the
    // whole status read. Nothing security-relevant depends on this flag.
    return false;
  }
}

/**
 * Credential status for the UI and for order-route guards. Reveals only:
 * configured? which variable names are missing? legacy row present?
 */
export async function exchangeCredentialsStatus(): Promise<ExchangeCredentialStatus> {
  const state = exchangeConfigState();
  return {
    configured: state.configured,
    source: state.configured ? "environment" : "none",
    exchange: state.exchange,
    missing: state.missing,
    misconfigured: state.misconfigured,
    baseUrl: state.baseUrl,
    legacyStoredKeys: await legacyRowExists(),
  };
}

/**
 * True when private exchange endpoints can be called. Safe to call per request.
 */
export async function exchangeAccountConfigured(): Promise<boolean> {
  return exchangeConfigState().configured;
}

/**
 * Delete the legacy encrypted credential row, if any.
 *
 * Callable from Settings. It cannot leak anything: the row is deleted, never
 * returned, and the value was never readable through any endpoint.
 */
export async function purgeLegacyDeltaCredentials(): Promise<{ removed: boolean }> {
  const existed = await legacyRowExists();
  if (existed) await (await getRepo()).deleteSetting(LEGACY_CREDENTIALS_KEY);
  return { removed: existed };
}
