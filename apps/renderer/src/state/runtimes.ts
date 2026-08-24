/**
 * Runtimes panel state (plan todo 12). The per-workspace override persists to
 * localStorage INTERIM (documented): the settings store lands in todo 21 and
 * will migrate this key.
 */
import { create } from 'zustand';
import type { BinaryProgressEvent, ManifestEntry, NodeVersionRow, SystemRuntimeInfo } from '@rh/protocol';

const SELECT_KEY = 'rh.runtime.selectedVersion';

interface RuntimesState {
  loadedOnce: boolean;
  loading: boolean;
  system: SystemRuntimeInfo | null;
  installed: ManifestEntry[];
  available: NodeVersionRow[];
  availableError: string | null;
  /** Single active install download progress. */
  progress: { version: string; receivedBytes: number; totalBytes: number | null } | null;
  selectedVersion: string | null;
  notice: string | null;
  refresh: () => Promise<void>;
  bindEvents: () => (() => void) | undefined;
  install: (version: string) => Promise<void>;
  remove: (version: string) => Promise<void>;
  select: (version: string | null) => void;
}

function loadSelected(): string | null {
  try {
    return localStorage.getItem(SELECT_KEY);
  } catch {
    return null;
  }
}

export const useRuntimes = create<RuntimesState>((set, get) => ({
  loadedOnce: false,
  loading: false,
  system: null,
  installed: [],
  available: [],
  availableError: null,
  progress: null,
  selectedVersion: loadSelected(),
  notice: null,

  refresh: async () => {
    if (!window.api) return;
    set({ loading: true });
    try {
      const list = await window.api.listBinaries();
      set({
        loadedOnce: true,
        loading: false,
        system: list.system,
        installed: list.installed,
        available: list.available,
        availableError: list.availableError ?? null,
        // Drop a selection that no longer resolves to an installed version.
        selectedVersion:
          get().selectedVersion !== null &&
          list.installed.some((e) => e.version === get().selectedVersion && e.installedPath !== undefined)
            ? get().selectedVersion
            : null
      });
    } catch (err) {
      set({ loading: false, notice: err instanceof Error ? err.message : String(err) });
    }
  },

  bindEvents: () => {
    if (!window.api?.onBinariesProgress) return undefined;
    return window.api.onBinariesProgress((event: BinaryProgressEvent) => {
      if (event.done) {
        set({ progress: null });
        void get().refresh();
        return;
      }
      set({
        progress: { version: event.version, receivedBytes: event.receivedBytes, totalBytes: event.totalBytes }
      });
    });
  },

  install: async (version) => {
    if (!window.api || get().progress !== null) return;
    set({ notice: null, progress: { version, receivedBytes: 0, totalBytes: null } });
    const response = await window.api.installRuntime(version);
    if (!response.ok) {
      set({ notice: `install failed: ${response.message}`, progress: null });
      return;
    }
    set({ progress: null });
    await get().refresh();
  },

  remove: async (version) => {
    if (!window.api) return;
    const response = await window.api.removeRuntime(version);
    if (!response.ok) {
      set({ notice: `remove failed: ${response.message}` });
      return;
    }
    if (get().selectedVersion === version) set({ selectedVersion: null });
    await get().refresh();
  },

  select: (version) => {
    try {
      if (version === null) localStorage.removeItem(SELECT_KEY);
      else localStorage.setItem(SELECT_KEY, version);
    } catch {
      /* storage unavailable — session-only selection */
    }
    set({ selectedVersion: version });
  }
}));
