import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import type { PkgEvent, PkgSearchRow } from '@rh/protocol';
import { useRuntimes } from './runtimes';

interface PackagesState {
  installed: Record<string, string>;
  results: PkgSearchRow[];
  searching: boolean;
  busy: boolean;
  log: string[];
  query: string;
  setQuery: (q: string) => void;
  refresh: () => Promise<void>;
  search: () => Promise<void>;
  install: (name: string) => Promise<void>;
  remove: (name: string) => Promise<void>;
  bindEvents: () => (() => void) | undefined;
}

const MAX_LOG = 400;

export const usePackages = create<PackagesState>((set, get) => ({
  installed: {},
  results: [],
  searching: false,
  busy: false,
  log: [],
  query: '',

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
    if (!window.api?.pkgInstall || get().busy) return;
    set({ busy: true });
    const response = await window.api.pkgInstall({ workspaceId: 'default', name, managedNodeVersion: useRuntimes.getState().selectedVersion ?? undefined });
    set({ busy: false });
    if (response.ok) {
      await get().refresh();
      window.dispatchEvent(new CustomEvent('rh:packages-changed'));
    }
  },

  remove: async (name) => {
    if (!window.api?.pkgRemove || get().busy) return;
    set({ busy: true });
    const response = await window.api.pkgRemove({ workspaceId: 'default', name, managedNodeVersion: useRuntimes.getState().selectedVersion ?? undefined });
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
