import { create } from 'zustand';

export interface OpenFile {
  id: string;
  relPath: string;
  language: string;
  content: string;
  dirty: boolean;
}

export type DrawerTab = 'console' | 'inspector' | 'analysis' | 'packages' | 'runtimes' | 'performance';

interface UiState {
  files: OpenFile[];
  activeFileId: string | null;
  drawerTab: DrawerTab;
  drawerRatio: number; // 0..1 height fraction of the bottom drawer
  openFile: (file: OpenFile) => void;
  closeFile: (id: string) => void;
  renameFile: (id: string, relPath: string) => void;
  setActive: (id: string) => void;
  updateContent: (id: string, content: string) => void;
  markSaved: (id: string) => void;
  setDrawerTab: (tab: DrawerTab) => void;
  setDrawerRatio: (ratio: number) => void;
}

const LAYOUT_KEY = 'rh.ui.drawerRatio';

function loadRatio(): number {
  const raw = localStorage.getItem(LAYOUT_KEY);
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0.05 && n < 0.9 ? n : 0.35;
}

/**
 * INTERIM (documented): layout proportions persist to localStorage until the
 * settings store lands in todo 21, which will migrate this key.
 */
export const useUi = create<UiState>((set, get) => ({
  files: [],
  activeFileId: null,
  drawerTab: 'console',
  drawerRatio: loadRatio(),
  openFile: (file) =>
    set((s) => ({
      files: s.files.some((f) => f.id === file.id) ? s.files : [...s.files, file],
      activeFileId: file.id
    })),
  closeFile: (id) =>
    set((s) => {
      const files = s.files.filter((f) => f.id !== id);
      return { files, activeFileId: s.activeFileId === id ? (files[0]?.id ?? null) : s.activeFileId };
    }),
  renameFile: (id, relPath) => set((s) => ({ files: s.files.map((f) => (f.id === id ? { ...f, relPath, dirty: true } : f)) })),
  setActive: (id) => set({ activeFileId: id }),
  updateContent: (id, content) =>
    set((s) => ({ files: s.files.map((f) => (f.id === id ? { ...f, content, dirty: true } : f)) })),
  markSaved: (id) => set((s) => ({ files: s.files.map((f) => (f.id === id ? { ...f, dirty: false } : f)) })),
  setDrawerTab: (drawerTab) => set({ drawerTab }),
  setDrawerRatio: (ratio) => {
    localStorage.setItem(LAYOUT_KEY, String(ratio));
    set({ drawerRatio: ratio });
  }
}));

/** Active file convenience selector. */
export function useActiveFile(): OpenFile | null {
  return useUi((s) => s.files.find((f) => f.id === s.activeFileId) ?? null);
}

export function getActiveFile(): OpenFile | null {
  const s = useUi.getState();
  return s.files.find((f) => f.id === s.activeFileId) ?? null;
}

/** Placeholder run-request bus (todo 11 replaces with real executor wiring). */
type RunListener = () => void;
const runListeners = new Set<RunListener>();
export function onRunRequested(cb: RunListener): () => void {
  runListeners.add(cb);
  return () => runListeners.delete(cb);
}
export function emitRunRequested(): void {
  for (const cb of runListeners) cb();
}
