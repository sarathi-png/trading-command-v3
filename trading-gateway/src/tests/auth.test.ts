/**
 * Gateway authentication: valid secret accepted, everything else rejected.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { IncomingMessage } from "node:http";
import { GatewayError } from "../errors.js";
import { bearerFrom, constantTimeEqual } from "../auth/gatewayAuth.js";
import { requireGatewayAuth } from "../middleware/authentication.js";

const SECRET = "s3cret-gateway-token-value";

function requestWith(authorization?: string): IncomingMessage {
  return { headers: authorization === undefined ? {} : { authorization } } as IncomingMessage;
}

test("auth: a valid bearer token is accepted", () => {
  assert.doesNotThrow(() => requireGatewayAuth(requestWith(`Bearer ${SECRET}`), SECRET));
  assert.doesNotThrow(() => requireGatewayAuth(requestWith(`bearer ${SECRET}`), SECRET));
});

test("auth: a wrong secret is rejected", () => {
  assert.throws(
    () => requireGatewayAuth(requestWith("Bearer wrong-secret-value"), SECRET),
    (error: unknown) => error instanceof GatewayError && error.code === "UNAUTHORIZED" && error.status === 401
  );
});

test("auth: a missing header is rejected", () => {
  assert.throws(() => requireGatewayAuth(requestWith(), SECRET), /Invalid or missing gateway credentials/);
});

test("auth: a malformed header is rejected (no 'Bearer' prefix)", () => {
  assert.throws(() => requireGatewayAuth(requestWith(SECRET), SECRET), /Invalid or missing/);
  assert.throws(() => requireGatewayAuth(requestWith("Basic abc"), SECRET), /Invalid or missing/);
  assert.throws(() => requireGatewayAuth(requestWith("Bearer "), SECRET), /Invalid or missing/);
});

test("auth: a prefix of the secret is rejected", () => {
  assert.throws(() => requireGatewayAuth(requestWith(`Bearer ${SECRET.slice(0, -1)}`), SECRET), /Invalid or missing/);
  assert.throws(() => requireGatewayAuth(requestWith(`Bearer ${SECRET}x`), SECRET), /Invalid or missing/);
});

test("auth: an unconfigured gateway fails closed with 503, never falls open", () => {
  assert.throws(
    () => requireGatewayAuth(requestWith("Bearer anything"), ""),
    (error: unknown) =>
      error instanceof GatewayError && error.code === "GATEWAY_NOT_CONFIGURED" && error.status === 503
  );
});

test("auth: constant-time comparison is correct and does not disclose length", () => {
  assert.equal(constantTimeEqual(SECRET, SECRET), true);
  assert.equal(constantTimeEqual(SECRET, `${SECRET} `), false);
  assert.equal(constantTimeEqual("", ""), true);
  assert.equal(constantTimeEqual("a", "b"), false);
});

test("auth: bearer parsing tolerates surrounding whitespace and array headers", () => {
  assert.equal(bearerFrom(`  Bearer   ${SECRET}  `), SECRET);
  assert.equal(bearerFrom([`Bearer ${SECRET}`, "ignored"]), SECRET);
  assert.equal(bearerFrom(undefined), null);
  assert.equal(bearerFrom(""), null);
});
