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

export interface InlineConsoleEntry {
  readonly line: number;
  readonly column?: number;
  readonly level: 'log' | 'error' | 'warn' | 'info' | 'debug' | 'table' | 'dir' | 'trace';
  readonly text: string;
  readonly args?: SerializedValue[];
}

/** Language override for the run pipeline. 'ts' transpiles via esbuild (default);
 * 'js' forces passthrough so Node 22+ can `--experimental-strip-types` the source. */
export type RunLang = 'js' | 'ts';

interface RunState {
  phase: RunPhase;
  runId: string | null;
  runtimeVersion: string | null;
  timeoutMs: number;
  lines: ConsoleLine[];
  reports: { index: number; value: SerializedValue }[];
  inlineConsole: InlineConsoleEntry[];
  inlineByLine: Record<number, InlineConsoleEntry[]>;
  resultByLine: Record<number, SerializedValue>;
  lastExit: LastExit | null;
  autoRun: boolean;
  notice: string | null;
  lang: RunLang;
  setAutoRun: (v: boolean) => void;
  setTimeoutMs: (ms: number) => void;
  setLang: (lang: RunLang) => void;
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
  timeoutMs: 5000,
  lines: [],
  reports: [],
  inlineConsole: [],
  inlineByLine: {},
  resultByLine: {},
  lastExit: null,
  autoRun: false,
  notice: null,
  // Default 'ts' preserves the historical behavior (esbuild for .ts/.tsx/.mts).
  // The toggle in App.tsx overrides this; auto-detect from file extension runs
  // when a different file is opened.
  lang: 'ts',

  setTimeoutMs: (ms) => set({ timeoutMs: ms }),

  setAutoRun: (v) => {
    if (!v && debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    set({ autoRun: v });
  },

  setLang: (lang) => set({ lang }),

  requestStart: async () => {
    console.log('[run] requestStart enter', { phase: get().phase, hasBridge: !!api(), file: getActiveFile()?.relPath, hasContent: !!getActiveFile()?.content });
    const bridge = api();
    if (!bridge) {
      console.log('[run] no bridge');
      set({ notice: 'runtime bridge unavailable' });
      return;
    }
    if (get().phase !== 'idle') {
      console.log('[run] not idle', get().phase);
      return;
    }
    const file: OpenFile | null = getActiveFile();
    if (!file) {
      set({ notice: 'no file open' });
      return;
    }
    set({ phase: 'running', lines: [], reports: [], inlineConsole: [], inlineByLine: {}, resultByLine: {}, lastExit: null, notice: null });
    const response = await bridge.startRun({
      workspaceId: 'default',
      relPath: file.relPath,
      content: file.content,
      timeoutMs: 5000,
      // Per-workspace override (todo 12); falls back to system node in main.
      runtimeVersion: useRuntimes.getState().selectedVersion ?? undefined,
      // Language override ('js' skips TS transpile in the main process).
      lang: get().lang
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
      case 'console': {
        const entry: InlineConsoleEntry = {
          line: e.line,
          column: e.column,
          level: e.level,
          text: e.text,
          args: e.args
        };
        const byLine = { ...state.inlineByLine };
        const existing = byLine[entry.line] ?? [];
        byLine[entry.line] = [...existing, entry];
        set({ inlineConsole: [...state.inlineConsole, entry], inlineByLine: byLine });
        // Classic console text arrives via the normal stdout pump (bootstrap
        // echoes 'L{line}: {text}'), so no duplicate push here.
        break;
      }
      case 'result': {
        const nextReports = upsertReport(state.reports, e.index, e.value);
        const nextByLine = { ...state.resultByLine };
        if (typeof e.line === 'number' && e.line > 0) {
          nextByLine[e.line] = e.value;
        }
        set({ reports: nextReports, resultByLine: nextByLine });
        break;
      }
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

  clearConsole: () => set({ lines: [], inlineConsole: [], inlineByLine: {}, notice: null })
}));
