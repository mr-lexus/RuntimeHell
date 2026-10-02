/**
 * EngineAdapter (plan todo 23): abstraction extracted from the proven V8
 * implementation. SpiderMonkey/JSC adapters (todos 24/25) register here;
 * AnalysisManager dispatches through the registry — never concrete classes.
 */
import type { AnalysisEngineId, AnalysisEvent, AnalysisStartRequest, AnalysisType, EngineDescriptor } from '@rh/protocol';

export type EngineDescription = EngineDescriptor;

/** Per-request services the manager hands to every adapter. */
export interface AnalysisContext {
  emit: (e: AnalysisEvent) => void;
  /** Register a kill-hook for the currently running engine process. */
  registerCancel: (fn: () => Promise<void>) => void;
  /** False once the request was cancelled — adapters stop between types. */
  isLive: (requestId: string) => boolean;
}

/**
 * Run one analysis request against this adapter's own binary.
 * Implementations throw CapabilityGateError for unsupported types and
 * MUST emit a terminal 'done' event.
 */
export interface EngineAdapter {
  readonly id: AnalysisEngineId;
  describe(): Promise<EngineDescription>;
  analyze(
    req: AnalysisStartRequest & { binaryPath: string },
    ctx: AnalysisContext
  ): Promise<void>;
}

export class AdapterNotFoundError extends Error {
  constructor(readonly engineId: string) {
    super(`no engine adapter registered for '${engineId}'`);
  }
}

export class CapabilityGateError extends Error {
  constructor(
    readonly analysisType: AnalysisType,
    readonly requiredCapability: string
  ) {
    super(`binary lacks ${requiredCapability} for '${analysisType}' (capability gate)`);
  }
}
