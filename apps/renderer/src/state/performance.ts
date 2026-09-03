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

type PerformanceProgressPhase = 'resolving' | 'preparing' | 'warmup' | 'measurement';

interface PerformanceConfig {
  cases: PerformanceCase[];
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

function assignCaseTarget(item: PerformanceCase, catalog: PerformanceCatalogResponse | null): PerformanceCase {
  if (catalog === null) return item;
  const target = item.target
    ? catalog.targets.find((candidate) => targetRefMatches(item.target, candidate.ref) && candidate.available)
    : catalog.targets.find((candidate) => candidate.available);
  if (target === undefined) return item;
  const supported = new Set(target.profiles.filter((profile) => profile.available).map((profile) => profile.id));
  const kept = item.profileIds?.filter((id) => supported.has(id)) ?? [];
  return { ...item, target: target.ref, profileIds: kept.length ? kept : [naturalProfile(target) ?? 'natural'] };
}

const initialExperiment: PerformanceConfig = { cases: [], selectedProfiles: {}, measurement: DEFAULT_MEASUREMENT, results: [] };
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
      const cases = get().cases.map((item) => assignCaseTarget(item, catalog));
      set({ catalog, loadingCatalog: false, selectedProfiles, cases });
    } catch (error) {
      set({ loadingCatalog: false, errors: { catalog: error instanceof Error ? error.message : String(error) } });
    }
  },

  bindEvents: () => window.api?.onPerformanceEvent((event) => get().handleEvent(event)),

  addCase: (item) => {
    if (get().running) return;
    set((state) => ({ cases: [...state.cases, assignCaseTarget(item, state.catalog)], results: [], errors: {} }));
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
  toggleTarget: (target) => {
    if (get().running || !target.available) return;
    const key = performanceTargetKey(target);
    const selectedProfiles = { ...get().selectedProfiles };
    if (selectedProfiles[key]) delete selectedProfiles[key];
    else {
      const natural = target.profiles.find((profile) => profile.available);
      if (natural) selectedProfiles[key] = [natural.id];
    }
    set({ selectedProfiles, results: [], errors: {} });
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
    set({ selectedProfiles, results: [], errors: {} });
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
    set({ cases: [], selectedProfiles: {}, measurement: DEFAULT_MEASUREMENT, results: [], errors: {}, progress: 'ready', progressCompleted: 0, progressTotal: 0, progressPhase: null, activeGroupId: null });
  },
  clearResults: () => { if (!get().running) set({ results: [], errors: {}, progress: 'ready', progressCompleted: 0, progressTotal: 0, progressPhase: null, activeGroupId: null }); },

  run: async (casesOverride) => {
    const state = get();
    if (state.running) return;
    const cases = casesOverride ?? state.cases;
    if (cases.length === 0) { set({ errors: { experiment: 'Add at least one benchmark case.' } }); return; }
    if (cases.some((item) => !item.body.trim())) { set({ errors: { experiment: 'Every case must contain executable code.' } }); return; }
    const targets: PerformanceTargetSelection[] = [];
    const hasCaseAssignments = cases.some((item) => item.target !== undefined || item.profileIds !== undefined);
    if (hasCaseAssignments && cases.some((item) => item.target === undefined)) {
      set({ errors: { experiment: 'Assign one runtime and at least one profile to every case.' } }); return;
    }
    if (hasCaseAssignments) {
      const grouped = new Map<string, { target: PerformanceTargetRef; profileIds: Set<string> }>();
      for (const item of cases) {
        if (!item.target) continue;
        const key = performanceTargetKey(item.target);
        const current = grouped.get(key) ?? { target: item.target, profileIds: new Set<string>() };
        for (const profileId of item.profileIds ?? ['natural']) current.profileIds.add(profileId);
        grouped.set(key, current);
      }
      for (const group of grouped.values()) {
        const option = state.catalog?.targets.find((candidate) => targetRefMatches(group.target, candidate.ref));
        if (!option?.available) continue;
        const profiles = [...group.profileIds].map((id) => ({ id, label: option.profiles.find((profile) => profile.id === id)?.label ?? id })).filter((profile) => option.profiles.some((candidate) => candidate.id === profile.id && candidate.available));
        if (profiles.length) targets.push({ target: option.ref, profiles });
      }
    } else {
      for (const target of state.catalog?.targets ?? []) {
        const selected = state.selectedProfiles[performanceTargetKey(target)] ?? [];
        if (!target.available || selected.length === 0) continue;
        targets.push({ target: target.ref, profiles: selected.map((id) => ({ id, label: target.profiles.find((profile) => profile.id === id)?.label ?? id })) });
      }
    }
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
