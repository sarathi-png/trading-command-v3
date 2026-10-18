/**
 * Session state: the server address, the operator credential, the selected
 * workspace, and the settings/status the backend reports.
 *
 * The password is kept in the device keystore (expo-secure-store), never in
 * plain storage. Everything else is ordinary app state.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { deleteItemAsync, getItemAsync, setItemAsync } from "./secureStore";
import { create } from "zustand";

import { api, ApiError, configureApi, type Workspace } from "../api/client";
import type { AppSettings, SystemStatus } from "../api/types";

const PASSWORD_KEY = "tc_api_password";
const URL_KEY = "tc_server_url";
const WORKSPACE_KEY = "tc_workspace";

export type SessionStatus = "idle" | "loading" | "ready" | "error";

interface SessionState {
  baseUrl: string;
  password: string;
  workspace: Workspace;
  settings: AppSettings | null;
  system: SystemStatus | null;
  status: SessionStatus;
  error: string | null;

  /** Restore a previously saved session (if any). */
  restore: () => Promise<boolean>;
  signIn: (baseUrl: string, password: string, workspace: Workspace) => Promise<void>;
  signOut: () => Promise<void>;
  setWorkspace: (workspace: Workspace) => Promise<void>;
  refresh: () => Promise<void>;
  saveSettings: (patch: Partial<AppSettings> & { confirm?: string }) => Promise<void>;
}

export const useSession = create<SessionState>((set, get) => ({
  baseUrl: "",
  password: "",
  workspace: "paper",
  settings: null,
  system: null,
  status: "idle",
  error: null,

  async restore() {
    try {
      const [url, password, workspace] = await Promise.all([
        AsyncStorage.getItem(URL_KEY),
        getItemAsync(PASSWORD_KEY),
        AsyncStorage.getItem(WORKSPACE_KEY),
      ]);
      // No saved session is not a failure — it is simply "signed out". The
      // status has to leave "idle", or the gate would wait for a restore
      // that is never coming.
      if (!url || !password) {
        set({ status: "error", error: "Not signed in." });
        return false;
      }
      const selected: Workspace = workspace === "live" ? "live" : "paper";
      configureApi({ baseUrl: url, password, workspace: selected });
      set({ baseUrl: url, password, workspace: selected, status: "loading" });
      try {
        await get().refresh();
        return true;
      } catch (error) {
        // A saved credential that no longer works must not lock the user in.
        set({
          status: "error",
          error: error instanceof Error ? error.message : "Could not reach the server.",
        });
        return false;
      }
    } catch {
      set({ status: "error", error: "Could not read the saved session." });
      return false;
    }
  },

  async signIn(baseUrl, password, workspace) {
    set({ status: "loading", error: null });
    configureApi({ baseUrl, password, workspace });
    try {
      // Validate the credential the way the browser does, so the server's
      // audit trail records the sign-in.
      await api.login(password);
      const [settings, system] = await Promise.all([api.settings(), api.system()]);
      await Promise.all([
        AsyncStorage.setItem(URL_KEY, baseUrl),
        setItemAsync(PASSWORD_KEY, password),
        AsyncStorage.setItem(WORKSPACE_KEY, workspace),
      ]);
      set({
        baseUrl,
        password,
        workspace,
        settings: settings.settings,
        system,
        status: "ready",
        error: null,
      });
    } catch (error) {
      const message =
        error instanceof ApiError ? error.message : "Could not reach the server.";
      set({ status: "error", error: message });
      throw new Error(message);
    }
  },

  async signOut() {
    // Best effort: a failed logout must not keep the credential on the device.
    await api.logout().catch(() => undefined);
    await Promise.all([
      AsyncStorage.removeItem(URL_KEY),
      deleteItemAsync(PASSWORD_KEY).catch(() => undefined),
      AsyncStorage.removeItem(WORKSPACE_KEY),
    ]);
    configureApi({ baseUrl: "", password: "", workspace: null });
    set({
      baseUrl: "",
      password: "",
      settings: null,
      system: null,
      // "idle" means "the restore has not run yet" — a signed-out session
      // must not look like one.
      status: "error",
      error: null,
    });
  },

  async setWorkspace(workspace) {
    configureApi({ workspace });
    set({ workspace });
    await AsyncStorage.setItem(WORKSPACE_KEY, workspace);
    await get().refresh();
  },

  async refresh() {
    try {
      const [settings, system] = await Promise.all([api.settings(), api.system()]);
      set({ settings: settings.settings, system, status: "ready", error: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Refresh failed.";
      set({ status: "error", error: message });
      throw new Error(message);
    }
  },

  async saveSettings(patch) {
    const result = await api.saveSettings(patch);
    set({ settings: result.settings });
  },
}));
