import { create } from 'zustand';
import type {
  PerformanceCase,
  PerformanceCatalogResponse,
  PerformanceEvent,
  PerformanceMeasurement,
  PerformanceRunResult,
  PerformanceTargetOption,
  PerformanceTargetSelection
} from '@rh/protocol';

const STORAGE_KEY = 'rh.performance.experiment.v2';

interface PersistedExperiment {
  name: string;
  setup: string;
  cases: PerformanceCase[];
  selectedProfiles: Record<string, string[]>;
  measurement: PerformanceMeasurement;
  results: PerformanceRunResult[];
}

interface PerformanceState extends PersistedExperiment {
  catalog: PerformanceCatalogResponse | null;
  loadingCatalog: boolean;
  running: boolean;
  requestId: string | null;
  progress: string;
  completedGroups: number;
  totalGroups: number;
  errors: Record<string, string>;
  refreshCatalog: () => Promise<void>;
  bindEvents: () => (() => void) | undefined;
  addCase: (item: PerformanceCase) => void;
  removeCase: (id: string) => void;
  renameCase: (id: string, label: string) => void;
  setSetup: (setup: string) => void;
  clearSetup: () => void;
  toggleTarget: (target: PerformanceTargetOption) => void;
  toggleProfile: (target: PerformanceTargetOption, profileId: string) => void;
  setMeasurement: (patch: Partial<PerformanceMeasurement>) => void;
  applyPreset: (preset: 'quick' | 'reliable' | 'cold' | 'steady') => void;
  clearExperiment: () => void;
  clearResults: () => void;
  run: () => Promise<void>;
  cancel: () => Promise<void>;
  handleEvent: (event: PerformanceEvent) => void;
}

const DEFAULT_MEASUREMENT: PerformanceMeasurement = { samples: 20, warmupRounds: 5, iterationsPerSample: 1_000, timeoutMs: 120_000 };

function readPersisted(): PersistedExperiment {
  const fallback: PersistedExperiment = { name: 'Performance experiment', setup: '', cases: [], selectedProfiles: {}, measurement: DEFAULT_MEASUREMENT, results: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return fallback;
    const value = JSON.parse(raw) as Partial<PersistedExperiment>;
    return {
      name: typeof value.name === 'string' ? value.name : fallback.name,
      setup: typeof value.setup === 'string' ? value.setup : '',
      cases: Array.isArray(value.cases) ? value.cases : [],
      selectedProfiles: value.selectedProfiles && typeof value.selectedProfiles === 'object' ? value.selectedProfiles : {},
      measurement: { ...DEFAULT_MEASUREMENT, ...(value.measurement ?? {}) },
      results: Array.isArray(value.results) ? value.results : []
    };
  } catch { return fallback; }
}

function persist(state: PersistedExperiment): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* session-only fallback */ }
}

function snapshot(state: PerformanceState): PersistedExperiment {
  // localStorage keeps the last matrix useful without duplicating potentially
  // hundreds of thousands of raw samples. Raw samples remain available for
  // export during the live session; persisted rows retain computed metrics.
  const results = state.results.slice(-48).map((group) => ({
    ...group,
    results: group.results.map((result) => ({ ...result, samples: [] }))
  }));
  return { name: state.name, setup: state.setup, cases: state.cases, selectedProfiles: state.selectedProfiles, measurement: state.measurement, results };
}

export function performanceTargetKey(target: PerformanceTargetOption | PerformanceTargetOption['ref']): string {
  const ref = 'ref' in target ? target.ref : target;
  return `${ref.source}:${ref.id}:${ref.version ?? 'auto'}:${ref.provenance ?? 'auto'}`;
}

function requestId(): string {
  return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `perf-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const persisted = readPersisted();
export const usePerformance = create<PerformanceState>((set, get) => ({
  ...persisted,
  catalog: null,
  loadingCatalog: false,
  running: false,
  requestId: null,
  progress: 'ready',
  completedGroups: 0,
  totalGroups: 0,
  errors: {},

  refreshCatalog: async () => {
    if (!window.api?.performanceCatalog) return;
    set({ loadingCatalog: true });
    try {
      const catalog = await window.api.performanceCatalog();
      let selectedProfiles = { ...get().selectedProfiles };
      const valid = new Map(catalog.targets.map((target) => [performanceTargetKey(target), target]));
      selectedProfiles = Object.fromEntries(Object.entries(selectedProfiles).flatMap(([key, ids]) => {
        const target = valid.get(key);
        if (target === undefined || !target.available) return [];
        const supported = new Set(target.profiles.filter((profile) => profile.available).map((profile) => profile.id));
        const kept = ids.filter((id) => supported.has(id));
        return kept.length ? [[key, kept]] : [];
      }));
      if (Object.keys(selectedProfiles).length === 0) {
        const first = catalog.targets.find((target) => target.available);
        const natural = first?.profiles.find((profile) => profile.available);
        if (first && natural) selectedProfiles[performanceTargetKey(first)] = [natural.id];
      }
      set({ catalog, loadingCatalog: false, selectedProfiles });
      persist(snapshot(get()));
    } catch (error) {
      set({ loadingCatalog: false, errors: { catalog: error instanceof Error ? error.message : String(error) } });
    }
  },

  bindEvents: () => window.api?.onPerformanceEvent((event) => get().handleEvent(event)),

  addCase: (item) => {
    if (get().running || get().cases.length >= 12) return;
    set((state) => ({ cases: [...state.cases, item], results: [], errors: {} }));
    persist(snapshot(get()));
  },
  removeCase: (id) => { if (!get().running) { set((state) => ({ cases: state.cases.filter((item) => item.id !== id), results: [], errors: {} })); persist(snapshot(get())); } },
  renameCase: (id, label) => { if (!get().running && label.trim()) { set((state) => ({ cases: state.cases.map((item) => item.id === id ? { ...item, label: label.slice(0, 80) } : item), results: [] })); persist(snapshot(get())); } },
  setSetup: (setup) => { if (!get().running) { set({ setup, results: [], errors: {} }); persist(snapshot(get())); } },
  clearSetup: () => { if (!get().running) { set({ setup: '', results: [], errors: {} }); persist(snapshot(get())); } },
  toggleTarget: (target) => {
    if (get().running || !target.available) return;
    const key = performanceTargetKey(target);
    const selectedProfiles = { ...get().selectedProfiles };
    if (selectedProfiles[key]) delete selectedProfiles[key];
    else {
      const natural = target.profiles.find((profile) => profile.available);
      if (natural) selectedProfiles[key] = [natural.id];
    }
    set({ selectedProfiles, results: [], errors: {} }); persist(snapshot(get()));
  },
  toggleProfile: (target, profileId) => {
    if (get().running) return;
    const profile = target.profiles.find((item) => item.id === profileId);
    if (!profile?.available) return;
    const key = performanceTargetKey(target);
    const selectedProfiles = { ...get().selectedProfiles };
    const current = selectedProfiles[key] ?? [];
    const next = current.includes(profileId) ? current.filter((id) => id !== profileId) : [...current, profileId];
    if (next.length) selectedProfiles[key] = next; else delete selectedProfiles[key];
    set({ selectedProfiles, results: [], errors: {} }); persist(snapshot(get()));
  },
  setMeasurement: (patch) => { if (!get().running) { set((state) => ({ measurement: { ...state.measurement, ...patch }, results: [] })); persist(snapshot(get())); } },
  applyPreset: (preset) => {
    if (get().running) return;
    const measurement: Record<typeof preset, PerformanceMeasurement> = {
      quick: { samples: 5, warmupRounds: 2, iterationsPerSample: 250, timeoutMs: 30_000 },
      reliable: { samples: 50, warmupRounds: 20, iterationsPerSample: 2_000, timeoutMs: 300_000 },
      cold: { samples: 15, warmupRounds: 0, iterationsPerSample: 1, timeoutMs: 120_000 },
      steady: { samples: 30, warmupRounds: 50, iterationsPerSample: 2_000, timeoutMs: 240_000 }
    };
    set({ measurement: measurement[preset], results: [], errors: {} }); persist(snapshot(get()));
  },
  clearExperiment: () => {
    if (get().running) return;
    set({ setup: '', cases: [], selectedProfiles: {}, measurement: DEFAULT_MEASUREMENT, results: [], errors: {}, progress: 'ready' });
    persist(snapshot(get()));
  },
  clearResults: () => { if (!get().running) { set({ results: [], errors: {}, progress: 'ready' }); persist(snapshot(get())); } },

  run: async () => {
    const state = get();
    if (state.running) return;
    if (state.cases.length === 0) { set({ errors: { experiment: 'Add at least one benchmark case.' } }); return; }
    const targets: PerformanceTargetSelection[] = [];
    for (const target of state.catalog?.targets ?? []) {
      const selected = state.selectedProfiles[performanceTargetKey(target)] ?? [];
      if (!target.available || selected.length === 0) continue;
      targets.push({ target: target.ref, profiles: selected.map((id) => ({ id, label: target.profiles.find((profile) => profile.id === id)?.label ?? id })) });
    }
    if (targets.length === 0) { set({ errors: { experiment: 'Select at least one available target and profile.' } }); return; }
    const id = requestId();
    const totalGroups = targets.reduce((sum, target) => sum + target.profiles.length, 0);
    set({ running: true, requestId: id, results: [], errors: {}, progress: 'starting', completedGroups: 0, totalGroups });
    try {
      const response = await window.api.performanceStart({
        requestId: id, workspaceId: 'default', name: state.name, setup: state.setup, cases: state.cases, targets,
        measurement: state.measurement, isolation: { mode: 'target-profile' }
      });
      set({ totalGroups: response.totalGroups });
    } catch (error) {
      set({ running: false, requestId: null, progress: 'failed', errors: { experiment: error instanceof Error ? error.message : String(error) } });
    }
  },
  cancel: async () => { const id = get().requestId; if (id) await window.api.performanceCancel(id); },

  handleEvent: (event) => {
    if (event.requestId !== get().requestId) return;
    if (event.type === 'progress') set({ progress: event.message });
    else if (event.type === 'result') { set((state) => ({ results: [...state.results.filter((item) => item.groupId !== event.result.groupId), event.result], completedGroups: state.completedGroups + 1 })); persist(snapshot(get())); }
    else if (event.type === 'cell-error') set((state) => ({ errors: { ...state.errors, [event.groupId]: event.message } }));
    else {
      set({ running: false, requestId: null, progress: event.status, completedGroups: event.completedGroups, totalGroups: event.totalGroups });
      persist(snapshot(get()));
    }
  }
}));
