/**
 * AnalysisManager (plan todo 19): orchestrates adapter fan-out per analysis
 * type, streams per-type results/errors over the injected sink, and tracks
 * cancellation handles so the drawer can kill a live engine process.
 *
 * Per-type sequencing: one gated failure emits 'unsupported' for THAT type
 * and continues with the remaining requested types (partial success).
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { AnalysisEvent, AnalysisStartRequest } from '@rh/protocol';
import { CapabilityGateError, V8EngineAdapter, type IsolatedRun } from './v8-adapter.js';
import type { EngineRegistry } from './registry.js';

export interface AnalysisManagerDeps {
  readonly registry: EngineRegistry;
  readonly emit: (event: AnalysisEvent) => void;
  /** Test seam: override concrete adapter construction. */
  readonly createAdapter?: (binaryPath: string) => Pick<V8EngineAdapter, 'analyze'>;
}

export class AnalysisManager {
  private readonly cancelByRequest = new Map<string, () => Promise<void>>();
  /** Requests currently allowed to keep running; delete on cancel. */
  private readonly live = new Set<string>();

  constructor(private readonly deps: AnalysisManagerDeps) {}

  /** Tracked isolation: registers a cancel hook for the life of one run. */
  private trackedIsolation(requestId: string): IsolatedRun {
    return async (options) => {
      const { ProcessRunner } = await import('../execution/process-runner.js');
      const runner = new ProcessRunner();
      const out: string[] = [];
      const err: string[] = [];
      const off = runner.onEvent((e) => {
        if (e.type === 'stdout') out.push(e.data);
        else if (e.type === 'stderr') err.push(e.data);
      });
      const handle = runner.run({
        exePath: options.exePath,
        args: options.args,
        cwd: options.cwd,
        timeoutMs: options.timeoutMs
      });
      this.cancelByRequest.set(requestId, async () => {
        await handle.cancel();
      });
      try {
        const result = await handle.result;
        return {
          code: result.exitCode,
          stdout: out.join(''),
          stderr: err.join(''),
          timedOut: result.status === 'timeout'
        };
      } finally {
        off();
        this.cancelByRequest.delete(requestId);
      }
    };
  }

  async start(req: AnalysisStartRequest): Promise<void> {
    this.live.add(req.requestId);
    // Placeholder cancel so early cancellations are acknowledged even before
    // the real ProcessRunner handle exists.
    this.cancelByRequest.set(req.requestId, async () => {});
    // Transparency (todo 20): persist the EXACT snippet that will run.
    if (req.workspaceId !== undefined) {
      try {
        const { workspaceRoot } = await import('../workspace/files.js');
        const dir = join(workspaceRoot(req.workspaceId), '.rhbuild', 'analysis');
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(join(dir, `${req.requestId}.mjs`), req.code, 'utf8');
      } catch {
        /* persistence is best-effort; analysis proceeds regardless */
      }
    }
    const description = await this.deps.registry.describe(req.engineId);
    if (!description.binaryPath || !description.capabilities) {
      this.deps.emit({
        t: 'error',
        requestId: req.requestId,
        message: description.reason ?? `${req.engineId} unavailable`
      });
      this.deps.emit({ t: 'done', requestId: req.requestId });
      return;
    }
    const binaryPath = description.binaryPath;
    const caps = await this.deps.registry.capabilities(binaryPath);

    // Engine shells execute plain JS: strip TS syntax up-front (todo 22).
    let code = req.code;
    if (req.lang === 'ts') {
      try {
        const { transform } = await import('esbuild');
        const stripped = await transform(req.code, { loader: 'ts', format: 'esm', target: 'esnext' });
        code = stripped.code;
      } catch (err) {
        this.deps.emit({
          t: 'error',
          requestId: req.requestId,
          message: `type-strip failed: ${err instanceof Error ? err.message : String(err)}`
        });
        this.deps.emit({ t: 'done', requestId: req.requestId });
        return;
      }
    }

    const adapter =
      this.deps.createAdapter?.(binaryPath) ??
      new V8EngineAdapter({
        capabilitiesOf: async () => caps,
        runIsolated: this.trackedIsolation(req.requestId)
      });

    // One type at a time: capability-gate failures degrade to 'unsupported'
    // for that type while remaining requested types still run.
    for (const analysisType of req.analysisTypes) {
      if (!this.live.has(req.requestId)) break; // cancelled between types
      try {
        const results = await adapter.analyze({
          requestId: req.requestId,
          code,
          binaryPath,
          analysisTypes: [analysisType],
          functionName: req.functionName,
          timeoutMs: req.timeoutMs ?? 10_000
        });
        for (const result of results) {
          this.deps.emit({ t: 'result', requestId: req.requestId, result });
        }
      } catch (err) {
        if (err instanceof CapabilityGateError) {
          this.deps.emit({
            t: 'unsupported',
            requestId: req.requestId,
            analysisType,
            reason: err.message
          });
          continue;
        }
        this.deps.emit({
          t: 'error',
          requestId: req.requestId,
          message: err instanceof Error ? err.message : String(err)
        });
        break;
      }
    }

    this.live.delete(req.requestId);
    this.cancelByRequest.delete(req.requestId);
    this.deps.emit({ t: 'done', requestId: req.requestId });
  }

  async cancel(requestId: string): Promise<boolean> {
    const cancel = this.cancelByRequest.get(requestId);
    if (!cancel) return false;
    this.live.delete(requestId);
    this.cancelByRequest.delete(requestId);
    this.deps.emit({ t: 'cancelled', requestId });
    return true;
  }
}
