/**
 * Authentication middleware: the first stage of the private request pipeline.
 *
 * Rules (unchanged from the original single-file implementation):
 *   - No secret configured on the gateway -> 503. The gateway never falls open.
 *   - Missing / malformed / wrong bearer -> 401. The reason is not disclosed.
 *   - Comparison is constant-time over SHA-256 digests, so neither the value
 *     nor its length leaks through response timing.
 *   - The browser never sends this header: only server-side Vercel code reads
 *     TRADING_GATEWAY_SECRET (see src/lib/tradingGateway/client.ts upstream).
 *
 * The credential mechanics live in `src/auth/gatewayAuth.ts`; this module is
 * the policy layer that applies them to an incoming request.
 */
import type { IncomingMessage } from "node:http";
import { GatewayError } from "../errors.js";
import {
  authenticateGatewayCaller,
  bearerFrom,
  constantTimeEqual,
  gatewaySecretConfigured,
} from "../auth/gatewayAuth.js";

// Re-exported so middleware consumers and tests keep a single import surface.
export { bearerFrom, constantTimeEqual };

/**
 * Assert that the request carries the gateway secret.
 * Throws GatewayError(UNAUTHORIZED | GATEWAY_NOT_CONFIGURED).
 */
export function requireGatewayAuth(req: IncomingMessage, gatewaySecret: string): void {
  if (!gatewaySecretConfigured(gatewaySecret)) {
    throw new GatewayError(
      "GATEWAY_NOT_CONFIGURED",
      503,
      "The gateway is not configured for authenticated traffic (TRADING_GATEWAY_SECRET is unset)."
    );
  }
  const presented = bearerFrom(req.headers.authorization);
  if (!authenticateGatewayCaller(presented, gatewaySecret)) {
    throw new GatewayError("UNAUTHORIZED", 401, "Invalid or missing gateway credentials.");
  }
}
