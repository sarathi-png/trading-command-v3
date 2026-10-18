/**
 * The operator password lives here.
 *
 * On a device this is the platform keystore (iOS Keychain / Android
 * Keystore) through expo-secure-store. The web build has no keystore, so
 * `secureStore.web.ts` keeps the value in the browser's local storage —
 * that is a development convenience, not a security guarantee, and the web
 * target is not a supported way to run this app.
 */
export { getItemAsync, setItemAsync, deleteItemAsync } from "expo-secure-store";
