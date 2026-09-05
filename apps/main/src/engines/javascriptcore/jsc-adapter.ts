/**
 * JavaScriptCoreAdapter (plan todo 25): env-driven JSC_* option dumps against
 * the managed jsc.exe, with the WebKitRequirements bin64 directory prepended
 * to the CHILD process PATH only (never user/system PATH).
 *
 * Supported analysis types (capability-gated):
 *   bytecode → JSC_dumpGeneratedBytecodes=true
 *   deopts   → JSC_printEachOSRExit=true
 *   gc       → JSC_logGC=2
 * AST/IR-graph remain unsupported on stock builds (honest gating).
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { AnalysisEvent, AnalysisResult, AnalysisStartRequest } from '@rh/protocol';
import type { AnalysisContext, EngineAdapter, EngineDescription } from '../engine-adapter.js';
import { trackedProcessIsolation } from '../../execution/isolation.js';
import type { EngineRegistry } from '../registry.js';
import { cacheRoot } from '../../binaries/paths.js';

const TYPE_ENV: Partial<Record<'bytecode' | 'deopts' | 'gc', Record<string, string>>> = {
  bytecode: { JSC_dumpGeneratedBytecodes: 'true' },
  deopts: { JSC_printEachOSRExit: 'true' },
  gc: { JSC_logGC: '2' }
};

export class JavaScriptCoreAdapter implements EngineAdapter {
  readonly id = 'javascriptcore' as const;
  /** Directory containing the WebKitRequirements bin64 DLLs (optional). */
  pathPrepend?: string;

  constructor(private readonly registry: EngineRegistry) {}

  describe(): Promise<EngineDescription> {
    return this.registry.describe(this.id);
  }

  async analyze(
    req: AnalysisStartRequest & { binaryPath: string },
    ctx: AnalysisContext
  ): Promise<void> {
    const description = await this.describe();
    if (!description.binaryPath || !description.capabilities) {
      ctx.emit({
        t: 'error',
        requestId: req.requestId,
        message: description.reason ?? `${this.id} unavailable`
      });
      ctx.emit({ t: 'done', requestId: req.requestId });
      return;
    }
    const binaryPath = description.binaryPath;
    const engineVersion = description.version ?? 'unknown';
    const runIsolated = trackedProcessIsolation(ctx, req.requestId);

    for (const analysisType of req.analysisTypes) {
      if (!ctx.isLive(req.requestId)) break;
      const env = TYPE_ENV[analysisType as 'bytecode' | 'deopts' | 'gc'];
      if (env === undefined) {
        ctx.emit({
          t: 'unsupported',
          requestId: req.requestId,
          analysisType,
          reason: `JSC adapter does not support '${analysisType}'`
        });
        continue;
      }

      const token = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const workDir = join(cacheRoot(), 'analysis-tmp', `jsc-${token}`);
      await fs.mkdir(workDir, { recursive: true });

      // TS strip (same policy as V8/SM adapters).
      let code = req.code;
      if (req.lang === 'ts') {
        try {
          const { transform } = await import('esbuild');
          code = (await transform(req.code, { loader: 'ts', format: 'esm', target: 'esnext' })).code;
        } catch (err) {
          ctx.emit({
            t: 'unsupported',
            requestId: req.requestId,
            analysisType,
            reason: `type-strip failed: ${err instanceof Error ? err.message : String(err)}`
          });
          continue;
        }
      }

      const snippetFile = join(workDir, 'snippet.js');
      await fs.writeFile(snippetFile, code, 'utf8');

      const startedAt = Date.now();
      const run = await runIsolated({
        exePath: binaryPath,
        args: [snippetFile],
        cwd: workDir,
        timeoutMs: req.timeoutMs ?? 10_000,
        pathPrepend: this.pathPrepend !== undefined ? [this.pathPrepend] : undefined,
        extraEnv: env
      });

      let rawOutput = run.stdout;
      if (run.stderr !== '') rawOutput += `\n[stderr]\n${run.stderr}`;
      if (run.timedOut) rawOutput += `\n[runtimehell] analysis timed out`;

      ctx.emit({
        t: 'result',
        requestId: req.requestId,
        result: {
          source: req.code,
          engine: 'javascriptcore',
          engineVersion,
          analysisType,
          rawOutput,
          artifacts: [],
          metadata: {
            flagsUsed: Object.entries(env).map(([k, v]) => `${k}=${v}`),
            durationMs: Date.now() - startedAt,
            binaryPath
          }
        }
      });
    }
    ctx.emit({ t: 'done', requestId: req.requestId });
  }
}
