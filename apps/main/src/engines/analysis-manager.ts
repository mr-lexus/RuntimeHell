/**
 * AnalysisManager (plan todo 23 refactor): thin dispatcher over the
 * EngineAdapter registry. Owns cancellation + live-request tracking; ALL
 * engine-specific sequencing (TS strip, per-type gates, partial success)
 * lives inside the registered adapter.
 */
import type { AnalysisEvent, AnalysisStartRequest } from '@rh/protocol';
import type { AnalysisContext } from '../engines/engine-adapter.js';
import type { EngineRegistry } from '../engines/registry.js';

export interface AnalysisManagerDeps {
  readonly registry: EngineRegistry;
  readonly emit: (event: AnalysisEvent) => void;
}

export class AnalysisManager {
  private readonly cancelByRequest = new Map<string, () => Promise<void>>();
  /** Requests currently allowed to keep running; delete on cancel. */
  private readonly live = new Set<string>();

  constructor(private readonly deps: AnalysisManagerDeps) {}

  async start(req: AnalysisStartRequest): Promise<void> {
    this.live.add(req.requestId);
    // Placeholder cancel so early cancellations are acknowledged even before
    // the adapter registers the real engine-process kill hook.
    this.cancelByRequest.set(req.requestId, async () => {});
    const ctx: AnalysisContext = {
      emit: (event) => {
        if (this.live.has(req.requestId)) this.deps.emit(event);
      },
      registerCancel: (fn) => this.cancelByRequest.set(req.requestId, fn),
      isLive: (id) => this.live.has(id)
    };
    try {
      await this.deps.registry.analyze(req, ctx);
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)) || 'Engine analysis failed';
      ctx.emit({ t: 'error', requestId: req.requestId, message });
    } finally {
      this.live.delete(req.requestId);
      this.cancelByRequest.delete(req.requestId);
    }
  }

  async cancel(requestId: string): Promise<boolean> {
    const cancel = this.cancelByRequest.get(requestId);
    if (!cancel || !this.live.has(requestId)) return false;
    this.live.delete(requestId); // stops subsequent types before they start
    try {
      await cancel();
    } catch (error) {
      this.deps.emit({ t: 'error', requestId, message: `Could not stop analysis: ${error instanceof Error ? error.message : String(error)}` });
      return false;
    }
    this.deps.emit({ t: 'cancelled', requestId });
    return true;
  }
}
