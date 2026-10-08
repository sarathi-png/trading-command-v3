/**
 * Delta credential STATUS for the application.
 *
 * After the static-IP gateway migration the application no longer holds — or
 * even reads — the Delta API key/secret. They live in the gateway's environment
 * on the host whose public IPv4 is allowlisted at Delta. This module reports
 * whether the gateway is configured, and cleans up the legacy encrypted row if
 * an older deployment stored one.
 *
 * What changed and why:
 *   - `resolveDeltaCredentials()` is GONE. It used to decrypt the Delta secret
 *     into the Vercel process. Any function that needs credentials must now go
 *     through src/lib/tradingGateway, which never sees a secret: it sends the
 *     gateway its own shared secret and the gateway signs with Delta.
 *   - `saveDeltaCredentials()` is GONE. A browser posting keys into the app's
 *     database was the reason the secret could be exposed to Vercel at all.
 *   - `deltaAccountConfigured()` is kept (many call sites) but now answers
 *     "is the trading gateway configured", which is what the UI actually needs.
 */
import { getRepo } from "@/lib/repo";
import { gatewayConfigState } from "@/lib/tradingGateway";

/** Where the legacy encrypted Delta credentials used to be stored. */
const LEGACY_CREDENTIALS_KEY = "credentials.delta";

export type CredentialSource = "gateway" | "none";

export interface DeltaCredentialStatus {
  /** True when private Delta operations are possible (gateway configured). */
  configured: boolean;
  source: CredentialSource;
  /** Host of the trading gateway, e.g. "gateway.example.com". Never a secret. */
  gatewayHost: string | null;
  /** True when URL and secret are not both set — a deployment mistake. */
  misconfigured: boolean;
  /**
   * True when an old deployment stored encrypted Delta keys in the database.
   * Harmless (they are unused, and encrypted with the old SESSION_SECRET) but
   * worth surfacing so they can be purged.
   */
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
 * Credential status for the UI and for order-route guards.
 * Reveals only: gateway configured? gateway host? legacy row present?
 */
export async function deltaCredentialsStatus(): Promise<DeltaCredentialStatus> {
  const state = gatewayConfigState();
  return {
    configured: state.configured,
    source: state.configured ? "gateway" : "none",
    gatewayHost: state.host,
    misconfigured: state.misconfigured,
    legacyStoredKeys: await legacyRowExists(),
  };
}

/**
 * True when private Delta endpoints can be called — i.e. when the gateway is
 * configured on this deployment. Safe to call per request.
 */
export async function deltaAccountConfigured(): Promise<boolean> {
  return gatewayConfigState().configured;
}

/**
 * Delete the legacy encrypted credential row, if any.
 *
 * Callable from Settings after the migration. It cannot leak anything: the row
 * is deleted, never returned, and the value was never readable through any
 * endpoint.
 */
export async function purgeLegacyDeltaCredentials(): Promise<{ removed: boolean }> {
  const existed = await legacyRowExists();
  if (existed) await (await getRepo()).deleteSetting(LEGACY_CREDENTIALS_KEY);
  return { removed: existed };
}
