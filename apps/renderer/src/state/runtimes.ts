/**
 * Runtimes panel state (plan todo 12). Multi-runtime management (feature):
 * system-wide detection per runtime id, nvm-windows Node versions, managed
 * installs, available versions per runtime, and a per-runtime selection.
 * Selections persist to localStorage (interim until the settings store lands).
 */
import { create } from 'zustand';
import type {
  BinaryProgressEvent,
  ManifestEntry,
  NvmInfo,
  RuntimeId,
  RuntimeVersionRow,
  SystemRuntimeInfo
} from '@rh/protocol';
import { RUNTIME_CATALOG, type RuntimeCatalogEntry } from '../panels/runtimes/runtime-catalog';

const SELECT_KEY = 'rh.runtime.selected';
const LEGACY_SELECT_KEY = 'rh.runtime.selectedVersion';
const ACTIVE_KEY = 'rh.runtime.activeRuntime';

const RUNTIME_IDS: readonly RuntimeId[] = ['node', 'deno', 'bun'];

/** Per-runtime system detection outcome, keyed by catalog entry id. */
export interface RuntimeDetection {
  installed: boolean;
  version?: string;
}

/** Selection value: a managed version, an nvm version, or the global PATH runtime. */
export type RuntimeSelection = string;

interface RuntimesState {
  loadedOnce: boolean;
  loading: boolean;
  systemRuntimes: Record<string, SystemRuntimeInfo | null>;
  nvm: NvmInfo | null;
  /** Managed runtime and engine entries returned by the binary manifest. */
  installed: ManifestEntry[];
  availableVersions: Record<string, RuntimeVersionRow[]>;
  availableErrors: Record<string, string>;
  /** Single active install download progress (per runtime id). */
  progress: { id: string; version: string; receivedBytes: number; totalBytes: number | null } | null;
  /** Per-runtime selection, keyed by runtime id. */
  selected: Record<string, RuntimeSelection>;
  /** Runtime used to run code (Ctrl+Enter / auto-run). */
  activeRuntime: RuntimeId;
  notice: string | null;
  /** Static catalog of all known JS runtimes/engines/polyfills. */
  catalog: RuntimeCatalogEntry[];
  /** System-detection results for catalog entries, keyed by entry id. */
  detectionResults: Record<string, RuntimeDetection>;
  refresh: () => Promise<void>;
  bindEvents: () => (() => void) | undefined;
  install: (kind: 'runtime' | 'engine', id: string, version?: string) => Promise<void>;
  importLocal: (kind: 'runtime' | 'engine', id: string, sourcePath: string, version: string) => Promise<void>;
  remove: (kind: 'runtime' | 'engine', id: string, version: string) => Promise<void>;
  select: (id: string, version: RuntimeSelection | null) => void;
  /** Set the runtime used to run code; persists across reloads. */
  setActiveRuntime: (id: RuntimeId) => void;
  /** Probe the system for catalog runtimes (system detection + nvm). */
  detectRuntimes: () => Promise<void>;
}

function loadSelected(): Record<string, RuntimeSelection> {
  try {
    const raw = localStorage.getItem(SELECT_KEY);
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed as Record<string, RuntimeSelection>;
    }
    // Migrate the legacy single-version key (node only).
    const legacy = localStorage.getItem(LEGACY_SELECT_KEY);
    if (legacy !== null) {
      localStorage.removeItem(LEGACY_SELECT_KEY);
      return { node: legacy };
    }
  } catch {
    /* storage unavailable — session-only selection */
  }
  return {};
}

/** Load the active runtime id. Anything unrecognized falls back to 'node'. */
function loadActiveRuntime(): RuntimeId {
  try {
    const raw = localStorage.getItem(ACTIVE_KEY);
    if (raw !== null && (RUNTIME_IDS as readonly string[]).includes(raw)) return raw as RuntimeId;
  } catch {
    /* storage unavailable — default applies */
  }
  return 'node';
}

export const useRuntimes = create<RuntimesState>((set, get) => ({
  loadedOnce: false,
  loading: false,
  systemRuntimes: {},
  nvm: null,
  installed: [],
  availableVersions: {},
  availableErrors: {},
  progress: null,
  selected: loadSelected(),
  activeRuntime: loadActiveRuntime(),
  notice: null,
  catalog: RUNTIME_CATALOG,
  detectionResults: {},

  refresh: async () => {
    if (!window.api) return;
    set({ loading: true });
    try {
      const list = await window.api.listBinaries();
      const selected = { ...get().selected };
      // Drop selections that no longer resolve to an installed/nvm version.
      for (const [id, value] of Object.entries(selected)) {
        if (value.startsWith('nvm:')) {
          const v = value.slice(4);
          if (!list.nvm?.versions.some((nv) => nv.version === v)) delete selected[id];
        } else if (value !== 'system' && !list.installed.some((e) => e.id === id && e.version === value && e.installedPath !== undefined)) {
          delete selected[id];
        }
      }
      set({
        loadedOnce: true,
        loading: false,
        systemRuntimes: list.systemRuntimes,
        nvm: list.nvm,
        installed: list.installed,
        availableVersions: list.availableVersions,
        availableErrors: list.availableErrors,
        selected
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
        progress: { id: event.id, version: event.version, receivedBytes: event.receivedBytes, totalBytes: event.totalBytes }
      });
    });
  },

  install: async (kind, id, version) => {
    if (!window.api || get().progress !== null) return;
    const progressVersion = version ?? 'latest';
    set({ notice: null, progress: { id, version: progressVersion, receivedBytes: 0, totalBytes: null } });
    const response =
      kind === 'runtime'
        ? await window.api.installRuntime(id, version ?? '')
        : await window.api.installEngine(id, version);
    if (!response.ok) {
      set({ notice: `install failed: ${response.message}`, progress: null });
      return;
    }
    const selected = kind === 'runtime'
      ? { ...get().selected, [id]: response.entry.version }
      : get().selected;
    set({ progress: null, selected });
    if (kind === 'runtime') {
      try {
        localStorage.setItem(SELECT_KEY, JSON.stringify(selected));
      } catch {
        /* storage unavailable — session-only selection */
      }
    }
    await get().refresh();
  },

  importLocal: async (kind, id, sourcePath, version) => {
    if (!window.api || get().progress !== null) return;
    const normalizedPath = sourcePath.trim();
    const normalizedVersion = version.trim();
    if (normalizedPath === '' || normalizedVersion === '') {
      set({ notice: 'local import requires an absolute path and version' });
      return;
    }
    set({ notice: null, progress: { id, version: normalizedVersion, receivedBytes: 0, totalBytes: null } });
    const response = await window.api.importLocalBinary(kind, id, normalizedPath, normalizedVersion);
    if (!response.ok) {
      set({ notice: `local import failed: ${response.message}`, progress: null });
      return;
    }
    const selected = kind === 'runtime'
      ? { ...get().selected, [id]: response.entry.version }
      : get().selected;
    set({ progress: null, selected });
    if (kind === 'runtime') {
      try {
        localStorage.setItem(SELECT_KEY, JSON.stringify(selected));
      } catch {
        /* storage unavailable — session-only selection */
      }
    }
    await get().refresh();
  },

  remove: async (kind, id, version) => {
    if (!window.api) return;
    const response =
      kind === 'runtime'
        ? await window.api.removeRuntime(id, version)
        : await window.api.removeEngine(id, version);
    if (!response.ok) {
      set({ notice: `remove failed: ${response.message}` });
      return;
    }
    if (kind === 'runtime' && get().selected[id] === version) {
      const selected = { ...get().selected };
      delete selected[id];
      set({ selected });
      try {
        localStorage.setItem(SELECT_KEY, JSON.stringify(selected));
      } catch {
        /* storage unavailable */
      }
    }
    await get().refresh();
  },

  select: (id, version) => {
    const selected = { ...get().selected };
    if (version === null) delete selected[id];
    else selected[id] = version;
    try {
      localStorage.setItem(SELECT_KEY, JSON.stringify(selected));
    } catch {
      /* storage unavailable — session-only selection */
    }
    set({ selected });
  },

  setActiveRuntime: (id) => {
    try {
      localStorage.setItem(ACTIVE_KEY, id);
    } catch {
      /* storage unavailable — session-only selection */
    }
    set({ activeRuntime: id });
  },

  detectRuntimes: async () => {
    const results: Record<string, RuntimeDetection> = {};
    for (const [id, sys] of Object.entries(get().systemRuntimes)) {
      if (sys !== null) results[id] = { installed: true, version: sys.version };
    }
    const nvm = get().nvm;
    const nvmFirst = nvm?.versions[0];
    if (nvmFirst !== undefined) {
      results.node = { installed: true, version: nvmFirst.version };
    }
    set({ detectionResults: results });
  }
}));
