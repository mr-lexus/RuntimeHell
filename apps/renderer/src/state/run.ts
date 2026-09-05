/**
 * Run state (plan todo 11): binds renderer UI to the main-process
 * ExecutionManager over the typed preload bridge. Console lines are capped;
 * reports are last-wins per index (promise settlements overwrite
 * placeholders). Auto-run debounces at 800ms and never stacks runs — the
 * main process additionally enforces single-flight per workspace.
 */
import { create } from 'zustand';
import type { RunEvent, RuntimeId, SerializedValue } from '@rh/protocol';
import { detectSourceLanguage, type DetectedLanguage } from '../editor/language-detection';
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

/** Language mode for the run pipeline. Automatic derives a concrete language from the active source. */
export type RunLang = 'auto' | DetectedLanguage;
export type ResolvedRunLang = DetectedLanguage;

export function resolveRunLanguage(mode: RunLang, file: Pick<OpenFile, 'relPath' | 'content'> | null): ResolvedRunLang {
  if (mode !== 'auto') return mode;
  return file === null ? 'js' : detectSourceLanguage(file.content, file.relPath);
}

interface RunState {
  phase: RunPhase;
  runId: string | null;
  /** Source file that produced the current inline output/result maps. */
  runFileId: string | null;
  runtimeVersion: string | null;
  /** Runtime id that executed the last run (runtime switching). */
  lastRuntimeId: RuntimeId | null;
  timeoutMs: number;
  lines: ConsoleLine[];
  reports: { index: number; value: SerializedValue }[];
  inlineConsole: InlineConsoleEntry[];
  inlineByLine: Record<number, InlineConsoleEntry[]>;
  resultByLine: Record<number, SerializedValue>;
  lastExit: LastExit | null;
  autoRun: boolean;
  notice: string | null;
  /** Events can arrive before the startRun IPC response (notably the fast
   * hidden Chromium lane). Hold them until the response gives us the runId. */
  pendingEvents: RunEvent[];
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
  runFileId: null,
  runtimeVersion: null,
  lastRuntimeId: null,
  timeoutMs: 5000,
  lines: [],
  reports: [],
  inlineConsole: [],
  inlineByLine: {},
  resultByLine: {},
  lastExit: null,
  autoRun: false,
  notice: null,
  pendingEvents: [],
  lang: 'auto',

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
    const bridge = api();
    if (!bridge) {
      set({ notice: 'runtime bridge unavailable' });
      return;
    }
    if (get().phase !== 'idle') {
      return;
    }
    const file: OpenFile | null = getActiveFile();
    if (!file) {
      set({ notice: 'no file open' });
      return;
    }
    set({ phase: 'running', runId: null, runFileId: file.id, lines: [], reports: [], inlineConsole: [], inlineByLine: {}, resultByLine: {}, lastExit: null, notice: null, pendingEvents: [] });
    const rt = useRuntimes.getState();
    const language = resolveRunLanguage(get().lang, file);
    const response = await bridge.startRun({
      workspaceId: 'default',
      relPath: file.relPath,
      content: file.content,
      timeoutMs: get().timeoutMs,
      // Active runtime dispatch (node/deno/bun); version = per-runtime selection,
      // falls back to system/newest-managed resolution in main when undefined.
      runtimeId: rt.activeRuntime,
      runtimeVersion: rt.selected[rt.activeRuntime] ?? undefined,
      // The protocol receives a concrete language; Automatic is resolved from
      // the latest source snapshot immediately before the IPC call.
      lang: language
    });
    if (!response.ok) {
      set({ phase: 'idle', pendingEvents: [] });
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
    const pendingEvents = get().pendingEvents.filter((event) => event.runId === response.runId);
    set({ runId: response.runId, runtimeVersion: response.runtimeVersion, lastRuntimeId: rt.activeRuntime, pendingEvents: [] });
    // Replay in arrival order after correlation is established. This prevents
    // a short browser run from losing its console/result/exit events while the
    // renderer is still awaiting the startRun IPC response.
    for (const event of pendingEvents) get().handleEvent(event);
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
    if (state.runId !== e.runId) {
      if (state.runId === null && state.phase === 'running') {
        const pending = state.pendingEvents.length >= 256
          ? [...state.pendingEvents.slice(-255), e]
          : [...state.pendingEvents, e];
        set({ pendingEvents: pending });
      }
      return;
    }
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
        // Keep the correlation id until the matching exit event arrives; the
        // runner emits both for process/browser failures and exit carries the
        // final duration/code for the status bar.
        set({ lines: pushLine(state.lines, 'stderr', `[runner error] ${e.message}`), phase: 'idle' });
        break;
    }
  },

  clearConsole: () => set({ lines: [], inlineConsole: [], inlineByLine: {}, notice: null })
}));
