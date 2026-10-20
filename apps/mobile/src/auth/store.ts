/**
 * Device keychain storage for the mobile session.
 *
 * Only the signed token and its expiry are stored. The operator password is
 * never written here: it is used once by the login screen and discarded.
 */
import * as SecureStore from "expo-secure-store";

const SESSION_KEY = "tc.session.v1";

export interface StoredSession {
  token: string;
  expiresAt: number;
}

/** Read a usable session. Expired or corrupt entries are deleted. */
export async function readSession(now = Date.now()): Promise<StoredSession | null> {
  try {
    const raw = await SecureStore.getItemAsync(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    const token = typeof parsed.token === "string" ? parsed.token : "";
    const expiresAt = typeof parsed.expiresAt === "number" ? parsed.expiresAt : 0;
    if (!token || !Number.isFinite(expiresAt) || expiresAt <= now) {
      await SecureStore.deleteItemAsync(SESSION_KEY);
      return null;
    }
    return { token, expiresAt };
  } catch {
    // A keychain failure must not strand the app on the splash screen.
    return null;
  }
}

export async function writeSession(session: StoredSession): Promise<void> {
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
}

export async function clearSession(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(SESSION_KEY);
  } catch {
    // Nothing to delete is not an error.
  }
}
