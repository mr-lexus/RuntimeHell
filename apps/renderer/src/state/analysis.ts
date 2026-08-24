/**
 * Analysis drawer state (plan todo 19): per-type status machine, streamed
 * result collection, cancellation. Engine picker + capability chips are
 * fed by EnginesController via the preload bridge.
 */
import { create } from 'zustand';
import type { AnalysisEvent, AnalysisResult, AnalysisType, EngineCapabilities } from '@rh/protocol';

export type TypeStatus = 'idle' | 'running' | 'done' | 'unsupported' | 'error';

export interface TypeState {
  status: TypeStatus;
  reason: string | null;
  result: AnalysisResult | null;
}

export interface EngineChoice {
  id: string;
  version: string | null;
  binaryPath: string | null;
  capabilities: EngineCapabilities | null;
  reason: string | null;
}

const ALL_TYPES: AnalysisType[] = ['ast', 'bytecode', 'optcode', 'ir-graph', 'deopts', 'gc'];

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
  engineId: 'v8' | 'd8-debug';
  engines: EngineChoice[];
  types: Record<AnalysisType, TypeState>;
  lastError: string | null;
  cancelledNotice: boolean;
  setEngine: (id: 'v8' | 'd8-debug') => void;
  refreshEngines: () => Promise<void>;
  request: (code: string, types: AnalysisType[], functionName?: string) => void;
  cancel: () => Promise<void>;
  handleEvent: (e: AnalysisEvent) => void;
}

let seq = 0;

export const useAnalysis = create<AnalysisState>((set, get) => ({
  requestId: null,
  engineId: 'd8-debug',
  engines: [],
  types: freshTypes(),
  lastError: null,
  cancelledNotice: false,

  setEngine: (engineId) => set({ engineId }),

  refreshEngines: async () => {
    if (!window.api?.enginesList) return;
    const engines = (await window.api.enginesList()) as unknown as EngineChoice[];
    set({
      engines: engines.filter((e) => e.id === 'v8' || e.id === 'd8-debug')
    });
  },

  request: (code, types, functionName) => {
    if (!window.api?.analyze) return;
    if (types.length === 0) return;
    const requestId = `ui-${Date.now()}-${++seq}`;
    const typesState = freshTypes();
    for (const t of types) typesState[t] = { status: 'running', reason: null, result: null };
    set({ requestId, types: typesState, lastError: null, cancelledNotice: false });
    void window.api
      .analyze({
        requestId,
        engineId: get().engineId,
        code,
        analysisTypes: types,
        ...(functionName !== undefined ? { functionName } : {})
      })
      .catch(() => set({ requestId: null }));
  },

  cancel: async () => {
    const { requestId } = get();
    if (requestId === null) return;
    await window.api?.cancelAnalysis(requestId);
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
          return { types: next, requestId: null, cancelledNotice: true };
        });
        break;
      case 'error':
        set({ lastError: e.message, requestId: null });
        break;
      case 'done':
        set((s) => {
          const next = { ...s.types };
          for (const key of ALL_TYPES) {
            if (next[key].status === 'running') next[key] = { ...next[key], status: 'error', reason: 'did not finish' };
          }
          return { types: next, requestId: null };
        });
        break;
    }
  }
}));

export const ANALYSIS_ALL_TYPES: readonly AnalysisType[] = ALL_TYPES;
