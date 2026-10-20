/**
 * Where the app talks to.
 *
 * `EXPO_PUBLIC_*` values are inlined into the bundle by Expo, so this may only
 * ever hold a public URL — never a password or exchange credential.
 *
 * Default is the local Next.js dev server. Point it at the deployed API with
 * `EXPO_PUBLIC_API_URL=https://trading-command-v3.vercel.app` once that
 * deployment includes `POST /api/auth/mobile`.
 */
export const API_BASE_URL =
  (process.env.EXPO_PUBLIC_API_URL ?? "").trim() || "http://localhost:3000";

/** Matches the web app's 8 s outbound budget; keeps the UI from hanging. */
export const API_TIMEOUT_MS = 8_000;
