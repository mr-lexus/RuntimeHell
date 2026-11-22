/**
 * Analysis drawer state (plan todo 19): per-type status machine, streamed
 * result collection, cancellation. Engine picker + capability chips are
 * fed by EnginesController via the preload bridge.
 */
import { create } from 'zustand';
import type { AnalysisEngineId, AnalysisEvent, AnalysisResult, AnalysisType, EngineCapabilities, EngineDescriptor } from '@rh/protocol';
import { buildAnalysisSnippet } from '../editor/wrapping';
import type { SelectionInfo } from '../editor/selection-service';
import { getActiveFile } from './ui';

export type TypeStatus = 'idle' | 'running' | 'done' | 'unsupported' | 'error';

export interface TypeState {
  status: TypeStatus;
  reason: string | null;
  result: AnalysisResult | null;
}

export type EngineChoice = EngineDescriptor;
export type { AnalysisEngineId } from '@rh/protocol';

const ALL_TYPES: AnalysisType[] = ['ast', 'bytecode', 'optcode', 'ir-graph', 'deopts', 'gc'];

export const CAPABILITY_FOR_TYPE: Record<AnalysisType, keyof Omit<EngineCapabilities, 'notes'>> = {
  ast: 'astDump',
  bytecode: 'bytecodeDump',
  optcode: 'optCodeDisasm',
  'ir-graph': 'irGraphDump',
  deopts: 'deoptTrace',
  gc: 'gcLog'
};

function freshTypes(): Record<AnalysisType, TypeState> {
  return {
    ast: { status: 'idle', reason: null, result: null },
    bytecode: { status: 'idle', reason: null, result: null },
    optcode: { status: 'idle', reason: null, result: null },
    'ir-graph': { status: 'idle', reason: null, result: null },
    deopts: { status: 'idle', reason: null, result: null },
    gc: { status: 'idle', reason: null, result: null }
  };
}

interface AnalysisState {
  requestId: string | null;
  engineId: AnalysisEngineId;
  engines: EngineChoice[];
  types: Record<AnalysisType, TypeState>;
  selectedAnalysisType: AnalysisType | null;
  selectType: (type: AnalysisType) => void;
  lastError: string | null;
  cancelledNotice: boolean;
  /** Exact snippet that will run — powers the "show generated wrapper" toggle. */
  generatedCode: string | null;
  /** Function the current request targets — filters the bytecode viewer. */
  focusFunction: string | null;
  setEngine: (id: AnalysisEngineId) => void;
  /** Clear displayed results without starting a new analysis request. */
  reset: () => void;
  refreshEngines: () => Promise<void>;
  requestFromSelection: (
    info: SelectionInfo | null,
    fullText: string,
    types: AnalysisType[],
    sampleInvocation?: boolean,
    lang?: 'js' | 'ts',
    focusName?: string | null
  ) => void;
  cancel: () => Promise<void>;
  handleEvent: (e: AnalysisEvent) => void;
}

export const useAnalysis = create<AnalysisState>((set, get) => ({
  requestId: null,
  engineId: 'd8-debug',
  engines: [],
  generatedCode: null,
  focusFunction: null,
  types: freshTypes(),
  selectedAnalysisType: null,
  selectType: (selectedAnalysisType) => set({ selectedAnalysisType }),
  lastError: null,
  cancelledNotice: false,

  setEngine: (engineId) => set({ engineId }),

  reset: () => set({
    requestId: null,
    selectedAnalysisType: null,
    types: freshTypes(),
    lastError: null,
    cancelledNotice: false,
    generatedCode: null,
    focusFunction: null
  }),

  refreshEngines: async () => {
    if (!window.api?.enginesList) return;
    try {
      const engines = await window.api.enginesList();
      // The main-process registry is the source of truth. It includes every
      // engine with an Analytics adapter (V8, SpiderMonkey, JSC, ...), so do
      // not keep a renderer-side allow-list that silently hides new engines.
      const available = engines;
      const current = get().engineId;
      // Keep the user's current choice when it is usable; otherwise select a
      // concrete installed engine instead of leaving the drawer pointed at a
      // missing d8-debug entry.
      const preferred =
        available.find((e) => e.id === current && e.binaryPath !== null && e.capabilities !== null) ??
        available.find((e) => e.binaryPath !== null && e.capabilities !== null) ??
        available.find((e) => e.binaryPath !== null) ??
        available[0];
      set({
        engines: available,
        ...(preferred !== undefined ? { engineId: preferred.id } : {})
      });
    } catch (error) {
      // A missing local engine must not turn an optional analysis probe into
      // an unhandled rejection that makes the workbench feel frozen.
      set({ engines: [], lastError: error instanceof Error ? error.message : String(error) });
    }
  },

  requestFromSelection: (info, fullText, types, sampleInvocation = false, lang, focusName = null) => {
    if (!window.api?.analyze) return;
    if (types.length === 0) return;
    if (get().requestId !== null) return; // single analysis at a time
    const kind = info?.kind ?? 'module';
    const text = info?.text ?? fullText;
    const snippet = buildAnalysisSnippet({ kindGuess: kind, text, sampleInvocation, targetName: focusName });
    const requestId = crypto.randomUUID();
    const typesState = freshTypes();
    for (const t of types) typesState[t] = { status: 'running', reason: null, result: null };
    const selectedType = get().selectedAnalysisType;
    set({
      requestId,
      selectedAnalysisType: selectedType !== null && types.includes(selectedType) ? selectedType : types[0]!,
      types: typesState,
      lastError: null,
      cancelledNotice: false,
      generatedCode: snippet.code,
      focusFunction: snippet.functionName
    });
    void window.api
      .analyze({
        requestId,
        engineId: get().engineId,
        code: snippet.code,
        analysisTypes: types,
        ...(snippet.functionName !== null ? { functionName: snippet.functionName } : {}),
        workspaceId: getActiveFile()?.workspaceId ?? 'default',
        ...(lang !== undefined ? { lang } : {})
      })
      .catch((error: unknown) => {
        get().handleEvent({
          t: 'error', requestId, message: error instanceof Error ? error.message : String(error)
        });
      });
  },

  cancel: async () => {
    const { requestId } = get();
    if (requestId === null) return;
    try {
      const response = await window.api.cancelAnalysis(requestId);
      if (!response.ok) throw new Error('The engine did not acknowledge cancellation');
    } catch (error) {
      if (get().requestId === requestId) {
        set({ lastError: `Could not stop analysis: ${error instanceof Error ? error.message : String(error)}` });
      }
    }
  },

  handleEvent: (e) => {
    if (get().requestId !== e.requestId) return;
    switch (e.t) {
      case 'result': {
        const t = e.result.analysisType;
        set((s) => ({
          types: { ...s.types, [t]: { status: 'done', reason: null, result: e.result } }
        }));
        break;
      }
      case 'unsupported':
        set((s) => ({
          types: {
            ...s.types,
            [e.analysisType]: { status: 'unsupported', reason: e.reason, result: s.types[e.analysisType].result }
          }
        }));
        break;
      case 'cancelled':
        set((s) => {
          const next = { ...s.types };
          for (const key of ALL_TYPES) {
            if (next[key].status === 'running') next[key] = { ...next[key], status: 'idle' };
          }
          return { types: next, requestId: null, cancelledNotice: true, lastError: null };
        });
        break;
      case 'error':
      case 'done':
        set((s) => {
          const next = { ...s.types };
          for (const key of ALL_TYPES) {
            if (next[key].status === 'running') {
              next[key] = { ...next[key], status: 'error', reason: e.t === 'error' ? e.message : 'did not finish' };
            }
          }
          return { types: next, requestId: null, lastError: e.t === 'error' ? e.message : null };
        });
        break;
    }
  }
}));

export const ANALYSIS_ALL_TYPES: readonly AnalysisType[] = ALL_TYPES;
