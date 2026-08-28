import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import type { PkgEvent, PkgSearchRow } from '@rh/protocol';
import { useRuntimes } from './runtimes';
import { useSettings } from './settings';

interface PackagesState {
  installed: Record<string, string>;
  results: PkgSearchRow[];
  searching: boolean;
  busy: boolean;
  log: string[];
  query: string;
  /** Registry metadata per package (lazy, cached). */
  meta: Record<string, { latest: string; versions: string[]; majors: string[] }>;
  /** Latest version when newer than installed, else null. */
  outdated: Record<string, string | null>;
  checking: boolean;
  setQuery: (q: string) => void;
  refresh: () => Promise<void>;
  search: () => Promise<void>;
  install: (name: string) => Promise<void>;
  installVersioned: (name: string, range?: string) => Promise<void>;
  remove: (name: string) => Promise<void>;
  bindEvents: () => (() => void) | undefined;
  fetchMeta: (name: string) => Promise<void>;
  checkUpdates: () => Promise<void>;
}

const MAX_LOG = 400;

/** Minimal semver comparison sufficient for update badges. */
export function isNewer(installedRange: string, latest: string): boolean {
  const base = installedRange.replace(/[\^~>=<\s]/g, '').split('||')[0]?.trim() ?? '';
  const pa = base.split('.').map((n) => parseInt(n, 10));
  const pb = latest.replace(/^v/, '').split('.').map((n) => parseInt(n, 10));
  if (pa.length !== 3 || pb.length !== 3 || pa.some(Number.isNaN) || pb.some(Number.isNaN)) return false;
  for (let i = 0; i < 3; i++) {
    const a = pa[i] as number;
    const b = pb[i] as number;
    if (b > a) return true;
    if (b < a) return false;
  }
  return false;
}

interface RegistryDoc {
  'dist-tags'?: { latest?: string };
  versions?: Record<string, unknown>;
}

export const usePackages = create<PackagesState>((set, get) => ({
  installed: {},
  results: [],
  searching: false,
  busy: false,
  log: [],
  query: '',
  meta: {},
  outdated: {},
  checking: false,

  setQuery: (query) => set({ query }),

  refresh: async () => {
    if (!window.api?.pkgList) return;
    const response = await window.api.pkgList('default');
    if (response.ok) set({ installed: response.dependencies });
  },

  search: async () => {
    const { query } = get();
    if (!window.api?.pkgSearch || query.trim() === '') return;
    set({ searching: true });
    const response = await window.api.pkgSearch(query.trim(), 20);
    // Stale-response guard: only apply if the query hasn't changed.
    if (get().query.trim() === query.trim()) {
      set({
        searching: false,
        results: response.ok ? response.results : [],
        log: response.ok ? get().log : [...get().log, `search failed: ${response.message}`].slice(-MAX_LOG)
      });
    }
  },

  install: async (name) => {
    await get().installVersioned(name, undefined);
  },

  installVersioned: async (name, range) => {
    if (!window.api?.pkgInstall || get().busy) return;
    set({ busy: true });
    const response = await window.api.pkgInstall({
      workspaceId: 'default',
      name,
      ...(range !== undefined && range.trim() !== '' ? { versionRange: range.trim() } : {}),
      managedNodeVersion: useRuntimes.getState().selected['node'] ?? undefined,
      ignoreScripts: useSettings.getState().settings.prefs.ignoreScripts
    });
    set({ busy: false });
    if (response.ok) {
      await get().refresh();
      window.dispatchEvent(new CustomEvent('rh:packages-changed'));
    } else {
      set({ log: [...get().log, `install failed: ${response.message}`].slice(-MAX_LOG) });
    }
  },

  fetchMeta: async (name) => {
    if (get().meta[name] !== undefined) return;
    try {
      const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`registry ${res.status}`);
      const doc = (await res.json()) as RegistryDoc;
      const versions = Object.keys(doc.versions ?? {});
      const latest = doc['dist-tags']?.latest ?? versions[versions.length - 1] ?? '';
      const majors = Array.from(new Set(versions.map((v) => v.split('.')[0] ?? '0'))).sort((a, b) => Number(b) - Number(a));
      set({ meta: { ...get().meta, [name]: { latest, versions, majors } } });
    } catch (err) {
      set({ log: [...get().log, `meta failed (${name}): ${err instanceof Error ? err.message : String(err)}`].slice(-MAX_LOG) });
    }
  },

  checkUpdates: async () => {
    const names = Object.keys(get().installed);
    if (names.length === 0) return;
    set({ checking: true });
    const outdated: Record<string, string | null> = {};
    for (const name of names) {
      try {
        const res = await fetch(`https://registry.npmjs.org/-/package/${encodeURIComponent(name)}/dist-tags`, {
          signal: AbortSignal.timeout(10_000)
        });
        if (!res.ok) throw new Error(`registry ${res.status}`);
        const tags = (await res.json()) as { latest?: string };
        const latest = tags.latest ?? null;
        const installedRange = get().installed[name] ?? '';
        outdated[name] = latest !== null && isNewer(installedRange, latest) ? latest : null;
      } catch {
        outdated[name] = null;
      }
    }
    set({ checking: false, outdated });
  },

  remove: async (name) => {
    if (!window.api?.pkgRemove || get().busy) return;
    set({ busy: true });
    const response = await window.api.pkgRemove({ workspaceId: 'default', name, managedNodeVersion: useRuntimes.getState().selected['node'] ?? undefined, ignoreScripts: useSettings.getState().settings.prefs.ignoreScripts });
    set({ busy: false });
    if (response.ok) {
      await get().refresh();
      window.dispatchEvent(new CustomEvent('rh:packages-changed'));
    }
  },

  bindEvents: () => {
    if (!window.api?.onPkgEvent) return undefined;
    return window.api.onPkgEvent((event: PkgEvent) => {
      const prefix = event.stream === 'stderr' ? '[npm err] ' : '';
      const log = [...get().log, `${prefix}${event.text}`].slice(-MAX_LOG);
      set({ log });
    });
  }
}));

/** Debounced search effect shared by the panel. */
export function useDebouncedSearch(): void {
  const query = usePackages((s) => s.query);
  const search = usePackages((s) => s.search);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => void search(), 350);
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);
}
