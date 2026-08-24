/**
 * Run state (plan todo 11): binds renderer UI to the main-process
 * ExecutionManager over the typed preload bridge. Console lines are capped;
 * reports are last-wins per index (promise settlements overwrite
 * placeholders). Auto-run debounces at 800ms and never stacks runs — the
 * main process additionally enforces single-flight per workspace.
 */
import { create } from 'zustand';
import type { RunEvent, SerializedValue } from '@rh/protocol';
import { getActiveFile, type OpenFile } from './ui.js';
import { useRuntimes } from './runtimes.js';

export type RunPhase = 'idle' | 'running' | 'cancelling';

export interface ConsoleLine {
  readonly seq: number;
  readonly stream: 'stdout' | 'stderr';
  readonly text: string;
}

const MAX_LINES = 2000;
export const AUTORUN_DEBOUNCE_MS = 800;

interface LastExit {
  code: number | null;
  durationMs: number;
  killedBy: string | null;
}

interface RunState {
  phase: RunPhase;
  runId: string | null;
  runtimeVersion: string | null;
  lines: ConsoleLine[];
  reports: { index: number; value: SerializedValue }[];
  lastExit: LastExit | null;
  autoRun: boolean;
  notice: string | null;
  setAutoRun: (v: boolean) => void;
  requestStart: () => Promise<void>;
  scheduleAutoRun: () => void;
  requestCancel: () => Promise<void>;
  handleEvent: (e: RunEvent) => void;
  clearConsole: () => void;
}

let seqCounter = 0;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function api(): Window['api'] | null {
  return typeof window !== 'undefined' && window.api ? window.api : null;
}

function pushLine(lines: ConsoleLine[], stream: ConsoleLine['stream'], text: string): ConsoleLine[] {
  const next = [...lines, { seq: ++seqCounter, stream, text }];
  return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
}

function upsertReport(
  reports: RunState['reports'],
  index: number,
  value: SerializedValue
): RunState['reports'] {
  const others = reports.filter((r) => r.index !== index);
  return [...others, { index, value }].sort((a, b) => a.index - b.index);
}

export const useRun = create<RunState>((set, get) => ({
  phase: 'idle',
  runId: null,
  runtimeVersion: null,
  lines: [],
  reports: [],
  lastExit: null,
  autoRun: false,
  notice: null,

  setAutoRun: (v) => {
    if (!v && debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    set({ autoRun: v });
  },

  requestStart: async () => {
    const bridge = api();
    if (!bridge) {
      set({ notice: 'runtime bridge unavailable' });
      return;
    }
    if (get().phase !== 'idle') return; // single running handle, client side too
    const file: OpenFile | null = getActiveFile();
    if (!file) {
      set({ notice: 'no file open' });
      return;
    }
    set({ phase: 'running', lines: [], reports: [], lastExit: null, notice: null });
    const response = await bridge.startRun({
      workspaceId: 'default',
      relPath: file.relPath,
      content: file.content,
      timeoutMs: 5000,
      // Per-workspace override (todo 12); falls back to system node in main.
      runtimeVersion: useRuntimes.getState().selectedVersion ?? undefined
    });
    if (!response.ok) {
      set({ phase: 'idle' });
      if (response.stage === 'transform' || response.stage === 'transpile') {
        let lines = get().lines;
        for (const err of response.errors ?? []) {
          lines = pushLine(lines, 'stderr', `${err.line ? `${err.line}:${err.column ?? 1} ` : ''}${err.text}`);
        }
        set({ lines, notice: `${response.stage} failed` });
      } else if (response.stage === 'active') {
        set({ notice: 'a run is already active' });
      } else {
        set({ notice: response.message ?? 'failed to start run' });
      }
      return;
    }
    set({ runId: response.runId, runtimeVersion: response.runtimeVersion });
  },

  scheduleAutoRun: () => {
    if (!get().autoRun) return;
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void get().requestStart();
    }, AUTORUN_DEBOUNCE_MS);
  },

  requestCancel: async () => {
    const { runId, phase } = get();
    if (phase !== 'running' || !runId) return;
    set({ phase: 'cancelling' });
    await api()?.cancelRun(runId);
  },

  handleEvent: (e) => {
    const state = get();
    if (state.runId !== e.runId) return;
    switch (e.type) {
      case 'stdout':
        set({ lines: pushLine(state.lines, 'stdout', e.data.replace(/\n$/, '')) });
        break;
      case 'stderr':
        set({ lines: pushLine(state.lines, 'stderr', e.data.replace(/\n$/, '')) });
        break;
      case 'result':
        set({ reports: upsertReport(state.reports, e.index, e.value) });
        break;
      case 'exit':
        set({
          phase: 'idle',
          runId: null,
          lastExit: { code: e.code, durationMs: e.durationMs, killedBy: e.killedBy }
        });
        break;
      case 'error':
        set({ lines: pushLine(state.lines, 'stderr', `[runner error] ${e.message}`), phase: 'idle', runId: null });
        break;
    }
  },

  clearConsole: () => set({ lines: [], notice: null })
}));
