/**
 * The web build has no platform keystore, so the operator password is kept
 * in local storage.
 *
 * This exists only so the app can be run in a browser for development. It is
 * NOT a secure store: on a device the password goes to the Keychain / Keystore
 * through `secureStore.ts`.
 */
const PREFIX = "tc_secure_";

export async function getItemAsync(key: string): Promise<string | null> {
  try {
    return window.localStorage.getItem(`${PREFIX}${key}`);
  } catch {
    return null;
  }
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  try {
    window.localStorage.setItem(`${PREFIX}${key}`, value);
  } catch {
    /* storage disabled — the session simply will not be restored */
  }
}

export async function deleteItemAsync(key: string): Promise<void> {
  try {
    window.localStorage.removeItem(`${PREFIX}${key}`);
  } catch {
    /* ignore */
  }
}
