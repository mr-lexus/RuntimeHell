import { create } from 'zustand';
import type {
  PerformanceCase,
  PerformanceCatalogResponse,
  PerformanceEvent,
  PerformanceMeasurement,
  PerformanceRunResult,
  PerformanceTargetRef,
  PerformanceTargetOption,
  PerformanceTargetSelection
} from '@rh/protocol';
import { MAX_PERFORMANCE_TARGETS, PerformanceTargetSelectionSchema } from '@rh/protocol';

type PerformanceProgressPhase = 'resolving' | 'preparing' | 'warmup' | 'measurement';

interface PerformanceConfig {
  cases: PerformanceCase[];
  runTargets: PerformanceTargetSelection[];
  selectedProfiles: Record<string, string[]>;
  measurement: PerformanceMeasurement;
  results: PerformanceRunResult[];
}

interface PerformanceState extends PerformanceConfig {
  catalog: PerformanceCatalogResponse | null;
  loadingCatalog: boolean;
  running: boolean;
  requestId: string | null;
  progress: string;
  progressCompleted: number;
  progressTotal: number;
  progressPhase: PerformanceProgressPhase | null;
  activeGroupId: string | null;
  completedGroups: number;
  totalGroups: number;
  errors: Record<string, string>;
  refreshCatalog: () => Promise<void>;
  bindEvents: () => (() => void) | undefined;
  addCase: (item: PerformanceCase) => void;
  duplicateCase: (id: string) => void;
  removeCase: (id: string) => void;
  renameCase: (id: string, label: string) => void;
  updateCaseBody: (id: string, body: string) => void;
  setCaseMode: (id: string, mode: PerformanceCase['mode']) => void;
  setCaseTarget: (id: string, target: PerformanceTargetOption | undefined) => void;
  toggleCaseProfile: (id: string, profileId: string) => void;
  setRunTargets: (targets: PerformanceTargetSelection[]) => void;
  toggleTarget: (target: PerformanceTargetOption) => void;
  toggleProfile: (target: PerformanceTargetOption, profileId: string) => void;
  setMeasurement: (patch: Partial<PerformanceMeasurement>) => void;
  applyPreset: (preset: 'quick' | 'reliable' | 'cold' | 'steady') => void;
  clearExperiment: () => void;
  clearResults: () => void;
  run: (casesOverride?: PerformanceCase[]) => Promise<void>;
  cancel: () => Promise<void>;
  handleEvent: (event: PerformanceEvent) => void;
}

const DEFAULT_MEASUREMENT: PerformanceMeasurement = { samples: 20, warmupRounds: 5, iterationsPerSample: 1_000, timeoutMs: 120_000, gcMode: 'runtime' };
const RUN_TARGETS_KEY = 'rh.performance.run-targets.v1';

function loadRunTargets(): PerformanceTargetSelection[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(RUN_TARGETS_KEY) ?? 'null');
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((item) => {
      const parsed = PerformanceTargetSelectionSchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    });
  } catch { return []; }
}

function persistRunTargets(targets: readonly PerformanceTargetSelection[]): void {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(RUN_TARGETS_KEY, JSON.stringify(targets)); } catch { /* optional storage */ }
}

export function performanceTargetKey(target: PerformanceTargetOption | PerformanceTargetOption['ref']): string {
  const ref = 'ref' in target ? target.ref : target;
  return `${ref.source}:${ref.id}:${ref.version ?? 'auto'}:${ref.provenance ?? 'auto'}`;
}

function requestId(): string {
  return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `perf-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function targetRefMatches(left: PerformanceTargetRef | undefined, right: PerformanceTargetRef): boolean {
  if (left === undefined) return false;
  if (left.source !== right.source || left.id !== right.id) return false;
  return left.version === undefined || right.version === undefined || left.version === right.version || left.version === 'system' || left.version === 'auto' || right.version === 'system' || right.version === 'auto';
}

function naturalProfile(target: PerformanceTargetOption): string | undefined {
  return target.profiles.find((profile) => profile.id === 'natural' && profile.available)?.id
    ?? target.profiles.find((profile) => profile.available)?.id;
}

const initialExperiment: PerformanceConfig = { cases: [], runTargets: loadRunTargets(), selectedProfiles: {}, measurement: DEFAULT_MEASUREMENT, results: [] };
export const usePerformance = create<PerformanceState>((set, get) => ({
  ...initialExperiment,
  catalog: null,
  loadingCatalog: false,
  running: false,
  requestId: null,
  progress: 'ready',
  progressCompleted: 0,
  progressTotal: 0,
  progressPhase: null,
  activeGroupId: null,
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
      const available = catalog.targets.filter((target) => target.available);
      const resolveTarget = (ref: PerformanceTargetRef): PerformanceTargetOption | undefined => available.find((target) => targetRefMatches(ref, target.ref));
      const configured = get().runTargets.flatMap((selection) => {
        const target = resolveTarget(selection.target);
        if (!target) return [];
        const profiles = selection.profiles.filter((profile) => target.profiles.some((candidate) => candidate.available && candidate.id === profile.id)).map((profile) => ({ id: profile.id, label: target.profiles.find((candidate) => candidate.id === profile.id)?.label ?? profile.label ?? profile.id }));
        return profiles.length ? [{ target: target.ref, profiles }] : [];
      });
      const fromLegacy = Object.entries(selectedProfiles).flatMap(([key, ids]) => {
        const target = available.find((candidate) => performanceTargetKey(candidate) === key);
        if (!target) return [];
        const profiles = ids.filter((id) => target.profiles.some((profile) => profile.available && profile.id === id)).map((id) => ({ id, label: target.profiles.find((profile) => profile.id === id)?.label ?? id }));
        return profiles.length ? [{ target: target.ref, profiles }] : [];
      });
      const fallback = configured.length ? configured : fromLegacy.length ? fromLegacy : (() => {
        const target = catalog.targets.find((candidate) => candidate.available);
        const profile = target?.profiles.find((candidate) => candidate.available);
        return target && profile ? [{ target: target.ref, profiles: [{ id: profile.id, label: profile.label }] }] : [];
      })();
      persistRunTargets(fallback);
      set({ catalog, loadingCatalog: false, selectedProfiles, runTargets: fallback });
    } catch (error) {
      set({ loadingCatalog: false, errors: { catalog: error instanceof Error ? error.message : String(error) } });
    }
  },

  bindEvents: () => window.api?.onPerformanceEvent((event) => get().handleEvent(event)),

  addCase: (item) => {
    if (get().running) return;
    set((state) => ({ cases: [...state.cases, { ...item, target: undefined, profileIds: undefined }], results: [], errors: {} }));
  },
  duplicateCase: (id) => {
    if (get().running) return;
    const source = get().cases.find((item) => item.id === id);
    if (!source) return;
    const copy = { ...source, id: requestId(), label: `${source.label} copy`.slice(0, 80) };
    set((state) => ({ cases: [...state.cases, copy], results: [], errors: {} }));
  },
  removeCase: (id) => { if (!get().running) set((state) => ({ cases: state.cases.filter((item) => item.id !== id), results: [], errors: {} })); },
  renameCase: (id, label) => { if (!get().running && label.trim()) set((state) => ({ cases: state.cases.map((item) => item.id === id ? { ...item, label: label.slice(0, 80) } : item), results: [] })); },
  updateCaseBody: (id, body) => { if (!get().running) set((state) => ({ cases: state.cases.map((item) => item.id === id ? { ...item, body } : item), results: [], errors: {} })); },
  setCaseMode: (id, mode) => { if (!get().running) set((state) => ({ cases: state.cases.map((item) => item.id === id ? { ...item, mode } : item), results: [], errors: {} })); },
  setCaseTarget: (id, target) => {
    if (get().running) return;
    set((state) => ({
      cases: state.cases.map((item) => {
        if (item.id !== id) return item;
        if (target === undefined) return { ...item, target: undefined, profileIds: undefined };
        const natural = naturalProfile(target);
        return { ...item, target: target.ref, profileIds: natural ? [natural] : undefined };
      }),
      results: [], errors: {}
    }));
  },
  toggleCaseProfile: (id, profileId) => {
    if (get().running) return;
    const item = get().cases.find((candidate) => candidate.id === id);
    if (!item?.target) return;
    const target = get().catalog?.targets.find((candidate) => targetRefMatches(item.target, candidate.ref));
    const profile = target?.profiles.find((candidate) => candidate.id === profileId && candidate.available);
    if (!target || !profile) return;
    const current = item.profileIds ?? [naturalProfile(target) ?? profileId];
    const next = current.includes(profileId) ? current.filter((idValue) => idValue !== profileId) : [...current, profileId];
    set((state) => ({ cases: state.cases.map((candidate) => candidate.id === id ? { ...candidate, profileIds: next.length ? next : [profileId] } : candidate), results: [], errors: {} }));
  },
  setRunTargets: (runTargets) => {
    if (get().running) return;
    const normalized = runTargets.filter((selection) => selection.profiles.length > 0).slice(0, MAX_PERFORMANCE_TARGETS).map((selection) => ({ target: selection.target, profiles: selection.profiles.slice(0, 8) }));
    persistRunTargets(normalized);
    set({ runTargets: normalized, results: [], errors: {} });
  },
  toggleTarget: (target) => {
    if (get().running || !target.available) return;
    const key = performanceTargetKey(target);
    const current = get().runTargets;
    const next = current.some((selection) => performanceTargetKey(selection.target) === key)
      ? current.filter((selection) => performanceTargetKey(selection.target) !== key)
      : (() => { const natural = target.profiles.find((profile) => profile.available); return natural ? [...current, { target: target.ref, profiles: [{ id: natural.id, label: natural.label }] }] : current; })();
    get().setRunTargets(next);
  },
  toggleProfile: (target, profileId) => {
    if (get().running) return;
    const profile = target.profiles.find((item) => item.id === profileId);
    if (!profile?.available) return;
    const key = performanceTargetKey(target);
    const currentSelection = get().runTargets.find((selection) => performanceTargetKey(selection.target) === key);
    const current = currentSelection?.profiles.map((item) => item.id) ?? [];
    const next = current.includes(profileId) ? current.filter((id) => id !== profileId) : [...current, profileId];
    const runTargets = get().runTargets.filter((selection) => performanceTargetKey(selection.target) !== key);
    if (next.length) runTargets.push({ target: target.ref, profiles: next.map((id) => ({ id, label: target.profiles.find((item) => item.id === id)?.label ?? id })) });
    get().setRunTargets(runTargets);
  },
  setMeasurement: (patch) => { if (!get().running) set((state) => ({ measurement: { ...state.measurement, ...patch }, results: [] })); },
  applyPreset: (preset) => {
    if (get().running) return;
    const gcMode = get().measurement.gcMode;
    const measurement: Record<typeof preset, PerformanceMeasurement> = {
      quick: { samples: 5, warmupRounds: 2, iterationsPerSample: 250, timeoutMs: 30_000, gcMode },
      reliable: { samples: 30, warmupRounds: 10, iterationsPerSample: 1_000, timeoutMs: 180_000, gcMode },
      cold: { samples: 15, warmupRounds: 0, iterationsPerSample: 1, timeoutMs: 120_000, gcMode },
      steady: { samples: 30, warmupRounds: 50, iterationsPerSample: 2_000, timeoutMs: 240_000, gcMode }
    };
    set({ measurement: measurement[preset], results: [], errors: {} });
  },
  clearExperiment: () => {
    if (get().running) return;
    persistRunTargets([]);
    set({ cases: [], runTargets: [], selectedProfiles: {}, measurement: DEFAULT_MEASUREMENT, results: [], errors: {}, progress: 'ready', progressCompleted: 0, progressTotal: 0, progressPhase: null, activeGroupId: null });
  },
  clearResults: () => { if (!get().running) set({ results: [], errors: {}, progress: 'ready', progressCompleted: 0, progressTotal: 0, progressPhase: null, activeGroupId: null }); },

  run: async (casesOverride) => {
    const state = get();
    if (state.running) return;
    // Runtime/profile selection is now a run-level matrix. Strip legacy
    // per-case assignments so every selected runtime executes every file case.
    const cases = (casesOverride ?? state.cases).map((item) => ({ ...item, target: undefined, profileIds: undefined }));
    if (cases.length === 0) { set({ errors: { experiment: 'Add at least one benchmark case.' } }); return; }
    if (cases.some((item) => !item.body.trim())) { set({ errors: { experiment: 'Every case must contain executable code.' } }); return; }
    const targets: PerformanceTargetSelection[] = state.runTargets;
    if (targets.length === 0) { set({ errors: { experiment: 'Select one available runtime and profile for your cases.' } }); return; }
    const id = requestId();
    const totalGroups = targets.reduce((sum, target) => sum + target.profiles.length, 0);
    set({ running: true, requestId: id, results: [], errors: {}, progress: 'starting', progressCompleted: 0, progressTotal: 0, progressPhase: 'resolving', activeGroupId: null, completedGroups: 0, totalGroups });
    try {
      const response = await window.api.performanceStart({
        requestId: id, workspaceId: 'default', name: 'Performance experiment', setup: '', cases, targets,
        measurement: state.measurement, isolation: { mode: 'target-profile' }
      });
      set({ totalGroups: response.totalGroups });
    } catch (error) {
      set({ running: false, requestId: null, progress: 'failed', progressPhase: null, activeGroupId: null, errors: { experiment: error instanceof Error ? error.message : String(error) } });
    }
  },
  cancel: async () => { const id = get().requestId; if (id) await window.api.performanceCancel(id); },

  handleEvent: (event) => {
    if (event.requestId !== get().requestId) return;
    if (event.type === 'progress') set({ progress: event.message, progressCompleted: event.completed, progressTotal: event.total, progressPhase: event.phase, activeGroupId: event.groupId ?? null });
    else if (event.type === 'result') set((state) => ({ results: [...state.results.filter((item) => item.groupId !== event.result.groupId), event.result], completedGroups: state.completedGroups + 1 }));
    else if (event.type === 'cell-error') set((state) => ({ errors: { ...state.errors, [event.groupId]: event.message } }));
    else {
      const finished = event.status !== 'cancelled';
      set((state) => ({ running: false, requestId: null, progress: event.status, progressCompleted: finished ? Math.max(state.progressCompleted, state.progressTotal) : state.progressCompleted, progressPhase: null, activeGroupId: null, completedGroups: event.completedGroups, totalGroups: event.totalGroups }));
    }
  }
}));
