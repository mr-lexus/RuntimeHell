import { create } from 'zustand';
import type { HistoryRecord } from '@rh/protocol';
import { detectSourceLanguage } from '../editor/language-detection';

export interface OpenFile {
  id: string;
  workspaceId?: string;
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
  closeFile: (id: string) => Promise<void>;
  moveFile: (id: string, targetId: string, after: boolean) => void;
  renameFile: (id: string, relPath: string) => Promise<boolean>;
  setActive: (id: string) => void;
  updateContent: (id: string, content: string) => void;
  saveFile: (id: string) => Promise<boolean>;
  saveErrors: Record<string, string>;
  setDrawerTab: (tab: DrawerTab) => void;
  setDrawerRatio: (ratio: number) => void;
}

const LAYOUT_KEY = 'rh.ui.drawerRatio';
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const pendingWrites = new Map<string, { file: OpenFile; result: Promise<boolean> }>();
const pendingRenames = new Map<string, Promise<boolean>>();

export function needsFileSave(file: OpenFile): boolean {
  return file.dirty || pendingRenames.has(file.id);
}

function scheduleSave(id: string): void {
  clearTimeout(saveTimers.get(id));
  saveTimers.set(id, setTimeout(() => { void useUi.getState().saveFile(id); }, 500));
}

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
  saveErrors: {},
  openFile: (file) => {
    if (get().files.some((f) => f.id === file.id)) {
      set({ activeFileId: file.id });
      return;
    }
    set((s) => ({ files: [...s.files, file], activeFileId: file.id }));
    if (file.dirty) scheduleSave(file.id);
  },
  closeFile: async (id) => {
    const file = get().files.find((f) => f.id === id);
    if (file && needsFileSave(file) && !await get().saveFile(id)) return;
    set((s) => {
      const closedIndex = s.files.findIndex((f) => f.id === id);
      if (closedIndex === -1 || s.files[closedIndex]?.dirty) return s;
      const files = s.files.filter((f) => f.id !== id);
      const nextActive = s.activeFileId === id
        ? (files[Math.min(closedIndex, files.length - 1)]?.id ?? null)
        : s.activeFileId;
      return { files, activeFileId: nextActive };
    });
  },
  moveFile: (id, targetId, after) =>
    set((s) => {
      const fromIndex = s.files.findIndex((f) => f.id === id);
      const targetIndex = s.files.findIndex((f) => f.id === targetId);
      if (fromIndex === -1 || targetIndex === -1 || fromIndex === targetIndex) return s;
      const files = [...s.files];
      const [moved] = files.splice(fromIndex, 1);
      const adjustedTargetIndex = files.findIndex((f) => f.id === targetId);
      if (moved === undefined || adjustedTargetIndex === -1) return s;
      files.splice(adjustedTargetIndex + (after ? 1 : 0), 0, moved);
      return { files };
    }),
  renameFile: (id, relPath) => {
    if (pendingRenames.has(id)) return Promise.resolve(false);
    const result = (pendingWrites.get(id)?.result ?? Promise.resolve()).then(async () => {
      const source = get().files.find((f) => f.id === id);
      if (!source) return false;
      if (source.relPath === relPath) return true;
      try {
        const workspaceId = source.workspaceId ?? 'default';
        if (get().files.some((f) => f.id !== id && (f.workspaceId ?? 'default') === workspaceId && f.relPath.toLowerCase() === relPath.toLowerCase())) {
          throw new Error(`A tab named ${relPath} is already open.`);
        }
        await window.api.saveFile({ workspaceId, relPath, content: source.content, createOnly: true });
        set((s) => {
          const saveErrors = { ...s.saveErrors };
          delete saveErrors[id];
          return { files: s.files.map((f) => f.id === id ? { ...f, relPath, dirty: f.content !== source.content } : f), saveErrors };
        });
        return true;
      } catch (error) {
        set((s) => ({ saveErrors: { ...s.saveErrors, [id]: `Could not rename ${source.relPath}: ${String(error)}` } }));
        if (get().files.find((f) => f.id === id)?.dirty) scheduleSave(id);
        return false;
      }
    }).finally(() => { pendingRenames.delete(id); });
    pendingRenames.set(id, result);
    return result;
  },
  setActive: (id) => set({ activeFileId: id }),
  updateContent: (id, content) => {
    set((s) => ({ files: s.files.map((f) => (f.id === id ? { ...f, content, dirty: true } : f)) }));
    scheduleSave(id);
  },
  saveFile: (id) => {
    clearTimeout(saveTimers.get(id));
    saveTimers.delete(id);
    const renaming = pendingRenames.get(id);
    if (renaming) return renaming.then((saved) => {
      if (!saved) return false;
      const latest = get().files.find((f) => f.id === id);
      return latest?.dirty ? get().saveFile(id) : true;
    });
    const file = get().files.find((f) => f.id === id);
    if (!file) return Promise.resolve(false);
    const pending = pendingWrites.get(id);
    if (pending?.file === file) return pending.result;
    // Finish the previous write before publishing a newer snapshot to disk.
    const result = (pending?.result ?? Promise.resolve()).then(async () => {
      try {
        await window.api.saveFile({ workspaceId: file.workspaceId ?? 'default', relPath: file.relPath, content: file.content });
        set((s) => {
          const saveErrors = { ...s.saveErrors };
          delete saveErrors[id];
          return { files: s.files.map((f) => f === file ? { ...f, dirty: false } : f), saveErrors };
        });
        return true;
      } catch (error) {
        set((s) => ({ saveErrors: { ...s.saveErrors, [id]: `Could not save ${file.relPath}: ${String(error)}` } }));
        return false;
      }
    }).finally(() => {
      if (pendingWrites.get(id)?.file === file) pendingWrites.delete(id);
    });
    pendingWrites.set(id, { file, result });
    return result;
  },
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

export function restoreRunSnapshot(workspaceId: string, snapshot: Pick<HistoryRecord, 'relPath' | 'contentSnapshot' | 'snapshotTruncated'>): void {
  if (snapshot.snapshotTruncated) return;
  const ui = useUi.getState();
  const file = ui.files.find((item) => (item.workspaceId ?? 'default') === workspaceId && item.relPath === snapshot.relPath);
  if (file) {
    if (file.content !== snapshot.contentSnapshot) {
      if ((file.dirty || file.id !== ui.activeFileId) && !window.confirm(`Replace the current contents of ${file.relPath} with this run snapshot?`)) return;
      ui.updateContent(file.id, snapshot.contentSnapshot);
    }
    ui.setActive(file.id);
    return;
  }
  if (!window.confirm(`Restore this run snapshot to ${snapshot.relPath}? This replaces the file's saved contents.`)) return;
  const pathId = `${workspaceId}:${snapshot.relPath}`;
  ui.openFile({
    id: ui.files.some((item) => item.id === pathId) ? crypto.randomUUID() : pathId,
    workspaceId,
    relPath: snapshot.relPath,
    language: detectSourceLanguage(snapshot.contentSnapshot, snapshot.relPath) === 'ts' ? 'typescript' : 'javascript',
    content: snapshot.contentSnapshot,
    dirty: true
  });
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
