/**
 * Pine scripts saved on the device.
 *
 * The mobile app carries its own Pine runtime (src/pine), so a script can be
 * pasted once and then run against live candles on the chart — no rebuild, no
 * server round trip. The active script is shared with the chart screen, which
 * draws the script's plots as overlays.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";

import { EXAMPLES } from "../pine/examples";
import type { PineValue } from "../pine/values";

const STORAGE_KEY = "tc_pine_scripts";

export interface PineScript {
  id: string;
  name: string;
  source: string;
  createdAt: number;
  updatedAt: number;
}

interface PineState {
  scripts: PineScript[];
  activeId: string | null;
  /** Per-script input overrides, keyed by script id. */
  overrides: Record<string, Record<string, PineValue>>;

  load: () => Promise<void>;
  save: (script: PineScript) => Promise<void>;
  remove: (id: string) => Promise<void>;
  setActive: (id: string | null) => Promise<void>;
  setOverride: (scriptId: string, inputId: string, value: PineValue) => Promise<void>;
  clearOverrides: (scriptId: string) => Promise<void>;
  active: () => PineScript | null;
}

/** What is written to storage: the scripts and which one is active. */
interface StoredScripts {
  scripts: PineScript[];
  activeId: string | null;
}

function seedScripts(): PineScript[] {
  const now = Date.now();
  return EXAMPLES.map((example, index) => ({
    id: `example-${index + 1}`,
    name: example.name,
    source: example.source,
    createdAt: now,
    updatedAt: now,
  }));
}

export const usePine = create<PineState>((set, get) => ({
  scripts: [],
  activeId: null,
  overrides: {},

  async load() {
    const seed = (): StoredScripts => {
      const scripts = seedScripts();
      return { scripts, activeId: scripts[0]?.id ?? null };
    };
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (!raw) {
        const fresh = seed();
        set(fresh);
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
        return;
      }
      const parsed = JSON.parse(raw) as Partial<StoredScripts>;
      const scripts = Array.isArray(parsed.scripts) ? parsed.scripts : [];
      if (!scripts.length) {
        const fresh = seed();
        set(fresh);
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
        return;
      }
      // The active script is remembered, so the chart shows the same script
      // the user left it on.
      const activeId =
        parsed.activeId && scripts.some((script) => script.id === parsed.activeId)
          ? parsed.activeId
          : scripts[0]?.id ?? null;
      set({ scripts, activeId });
    } catch {
      const fresh = seed();
      set(fresh);
    }
  },

  async save(script) {
    const scripts = [...get().scripts];
    const index = scripts.findIndex((candidate) => candidate.id === script.id);
    if (index === -1) scripts.unshift(script);
    else scripts[index] = script;
    const activeId = script.id;
    set({ scripts, activeId });
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ scripts, activeId }));
  },

  async remove(id) {
    const scripts = get().scripts.filter((script) => script.id !== id);
    const activeId = get().activeId === id ? scripts[0]?.id ?? null : get().activeId;
    set({ scripts, activeId });
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ scripts, activeId }));
  },

  async setActive(id) {
    const { scripts } = get();
    set({ activeId: id });
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ scripts, activeId: id }));
  },

  async setOverride(scriptId, inputId, value) {
    const overrides = {
      ...get().overrides,
      [scriptId]: { ...(get().overrides[scriptId] ?? {}), [inputId]: value },
    };
    set({ overrides });
    await AsyncStorage.setItem(`${STORAGE_KEY}:overrides`, JSON.stringify(overrides));
  },

  async clearOverrides(scriptId) {
    const overrides = { ...get().overrides };
    delete overrides[scriptId];
    set({ overrides });
    await AsyncStorage.setItem(`${STORAGE_KEY}:overrides`, JSON.stringify(overrides));
  },

  active() {
    const { scripts, activeId } = get();
    return scripts.find((script) => script.id === activeId) ?? null;
  },
}));
