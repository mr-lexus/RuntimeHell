import { useEffect } from 'react';
import { create } from 'zustand';
import type { PkgEvent, PkgSearchRow } from '@rh/protocol';
import { useRuntimes } from './runtimes';
import { useSettings } from './settings';

interface PackagesState {
  workspaceId: string;
  selectWorkspace: (id: string) => Promise<void>;
  installed: Record<string, string>;
  results: PkgSearchRow[];
  searching: boolean;
  searchError: string | null;
  busy: boolean;
  log: string[];
  query: string;
  /** Registry metadata per package (lazy, cached). */
  meta: Record<string, { latest: string; versions: string[]; majors: string[] }>;
  metaErrors: Record<string, string | undefined>;
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
let searchRevision = 0;
let listRevision = 0;
let updatesRevision = 0;
const pendingMetadata = new Map<string, Promise<void>>();

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function changePackage(operation: 'install' | 'remove', name: string, range?: string): Promise<void> {
  if (usePackages.getState().busy || !window.api) return;
  const { workspaceId } = usePackages.getState();
  const request = {
    workspaceId, name, managedNodeVersion: useRuntimes.getState().selected.node,
    ignoreScripts: useSettings.getState().settings.prefs.ignoreScripts
  };
  usePackages.setState({ busy: true });
  try {
    const versionRange = range?.trim();
    const response = operation === 'remove'
      ? await window.api.pkgRemove(request)
      : await window.api.pkgInstall({ ...request, ...(versionRange && { versionRange }) });
    if (!response.ok) throw new Error(response.message);
    if (usePackages.getState().workspaceId !== workspaceId) return;
    ++listRevision;
    usePackages.setState({ installed: response.dependencies });
    window.dispatchEvent(new CustomEvent('rh:packages-changed'));
  } catch (error) {
    if (usePackages.getState().workspaceId !== workspaceId) return;
    usePackages.setState(({ log }) => ({ log: [...log, `${operation} failed: ${messageOf(error)}`].slice(-MAX_LOG) }));
  } finally {
    usePackages.setState({ busy: false });
  }
}

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

async function fetchRegistryMetadata(name: string) {
  const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`registry ${res.status}`);
  const doc = await res.json() as RegistryDoc;
  const versions = Object.keys(doc.versions ?? {});
  const latest = doc['dist-tags']?.latest ?? versions.at(-1) ?? '';
  const majors = Array.from(new Set(versions.map((v) => v.split('.')[0] ?? '0'))).sort((a, b) => Number(b) - Number(a));
  return { latest, versions, majors };
}

export const usePackages = create<PackagesState>((set, get) => ({
  workspaceId: 'default',
  selectWorkspace: async (workspaceId) => {
    if (get().workspaceId === workspaceId) return;
    ++updatesRevision;
    set({ workspaceId, installed: {}, outdated: {}, log: [], checking: false });
    await get().refresh();
  },
  installed: {},
  results: [],
  searching: false,
  searchError: null,
  busy: false,
  log: [],
  query: '',
  meta: {},
  metaErrors: {},
  outdated: {},
  checking: false,

  setQuery: (query) => {
    ++searchRevision;
    set({ query, results: [], searchError: null, searching: query.trim() !== '' });
  },

  refresh: async () => {
    if (!window.api?.pkgList) return;
    const revision = ++listRevision;
    try {
      const response = await window.api.pkgList(get().workspaceId);
      if (revision !== listRevision) return;
      if (!response.ok) throw new Error(response.message);
      set({ installed: response.dependencies });
    } catch (error) {
      if (revision !== listRevision) return;
      set(({ log }) => ({ log: [...log, `list failed: ${messageOf(error)}`].slice(-MAX_LOG) }));
    }
  },

  search: async () => {
    const { query } = get();
    if (query.trim() === '') return;
    const revision = ++searchRevision;
    set({ searching: true, searchError: null });
    try {
      const response = await window.api.pkgSearch(query.trim(), 20);
      if (revision !== searchRevision) return;
      if (!response.ok) throw new Error(response.message);
      set({ results: response.results, searching: false });
    } catch (error) {
      if (revision === searchRevision) set({ searching: false, results: [], searchError: messageOf(error) });
    }
  },

  install: (name) => changePackage('install', name),
  installVersioned: (name, range) => changePackage('install', name, range),
  remove: (name) => changePackage('remove', name),

  fetchMeta: async (name) => {
    if (Object.hasOwn(get().meta, name)) return;
    const pending = pendingMetadata.get(name);
    if (pending) return pending;
    set(({ metaErrors }) => ({ metaErrors: { ...metaErrors, [name]: undefined } }));
    const request = fetchRegistryMetadata(name)
      .then((metadata) => set(({ meta }) => ({ meta: { ...meta, [name]: metadata } })))
      .catch((error: unknown) => set(({ metaErrors }) => ({ metaErrors: { ...metaErrors, [name]: messageOf(error) } })))
      .finally(() => { pendingMetadata.delete(name); });
    pendingMetadata.set(name, request);
    return request;
  },

  checkUpdates: async () => {
    const revision = ++updatesRevision;
    const names = Object.keys(get().installed);
    if (names.length === 0) {
      set({ checking: false, outdated: {} });
      return;
    }
    set({ checking: true });
    const outdated: Record<string, string | null> = {};
    for (const name of names) {
      if (revision !== updatesRevision) return;
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
    if (revision === updatesRevision) set({ checking: false, outdated });
  },

  bindEvents: () => {
    if (!window.api?.onPkgEvent) return undefined;
    return window.api.onPkgEvent((event: PkgEvent) => {
      if (event.workspaceId !== get().workspaceId) return;
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
  useEffect(() => {
    if (!query.trim()) return;
    const timer = setTimeout(() => void search(), 350);
    return () => clearTimeout(timer);
  }, [query, search]);
}
