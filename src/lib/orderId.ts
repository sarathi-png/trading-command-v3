/**
 * Client order id: the idempotency key for both live and paper submissions.
 *
 * One definition is shared by the server routes and the browser so a retry
 * cannot be rejected (or silently accepted as a different order) because two
 * copies of the rule drifted apart.
 */
export const CLIENT_ORDER_ID_RE = /^[A-Za-z0-9._:-]{1,64}$/;

export function isValidClientOrderId(value: unknown): value is string {
  return typeof value === "string" && CLIENT_ORDER_ID_RE.test(value);
}

/** A fresh key. `crypto.randomUUID` is available in modern browsers and Node. */
export function newClientOrderId(): string {
  const rand =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID().slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return `tc-${Date.now().toString(36)}-${rand}`;
}
