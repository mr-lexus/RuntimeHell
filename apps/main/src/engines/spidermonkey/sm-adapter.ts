/**
 * SpiderMonkeyAdapter (plan todo 24): capability-probed js-shell adapter.
 *
 * VERIFIED reality (real jsshell 140.14.0esr): stock shells expose
 * Reflect.parse (AST) but NO bytecode dumping (dis() removed; dumpStencil is
 * a no-op without an internal build). The adapter therefore supports:
 *   - ast      → Reflect.parse JSON via driver script
 *   - bytecode → CapabilityGateError (C-lane: needs custom/debug build)
 * Deopt/JIT spew stays gated off (debug-build IONFLAGS territory).
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { AnalysisEvent, AnalysisResult, AnalysisStartRequest } from '@rh/protocol';
import type { AnalysisContext, EngineAdapter, EngineDescription } from '../engine-adapter.js';
import { CapabilityGateError } from '../v8-adapter.js';
import { trackedProcessIsolation } from '../../execution/isolation.js';
import type { EngineRegistry } from '../registry.js';
import { cacheRoot } from '../../binaries/paths.js';

const SUPPORTED: Partial<Record<'ast' | 'bytecode', keyof import('@rh/protocol').EngineCapabilities>> = {
  ast: 'astDump',
  bytecode: 'bytecodeDump'
};

export class SpiderMonkeyAdapter implements EngineAdapter {
  readonly id = 'spidermonkey' as const;

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
    const caps = await this.registry.capabilities(binaryPath);
    const engineVersion = description.version ?? 'unknown';
    const runIsolated = trackedProcessIsolation(ctx, req.requestId);

    for (const analysisType of req.analysisTypes) {
      if (!ctx.isLive(req.requestId)) break;
      const capKey = SUPPORTED[analysisType as 'ast' | 'bytecode'];
      if (capKey === undefined || !caps[capKey]) {
        ctx.emit({
          t: 'unsupported',
          requestId: req.requestId,
          analysisType,
          reason: `SpiderMonkey adapter does not support '${analysisType}' on this binary`
        });
        continue;
      }

      const token = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const workDir = join(cacheRoot(), 'analysis-tmp', `sm-${token}`);
      await fs.mkdir(workDir, { recursive: true });

      // TS strip (same policy as the V8 adapter).
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
      const driverFile = join(workDir, 'driver-ast.js');
      await fs.writeFile(
        driverFile,
        `print(JSON.stringify(Reflect.parse(read(${JSON.stringify(snippetFile)}), { loc: true })));\n`,
        'utf8'
      );

      const startedAt = Date.now();
      const run = await runIsolated({
        exePath: binaryPath,
        args: [driverFile],
        cwd: workDir,
        timeoutMs: req.timeoutMs ?? 10_000
      });

      let rawOutput = run.stdout;
      if (run.stderr !== '') rawOutput += `\n[stderr]\n${run.stderr}`;
      if (run.timedOut) rawOutput += `\n[runtimehell] analysis timed out`;

      ctx.emit({
        t: 'result',
        requestId: req.requestId,
        result: {
          source: req.code,
          engine: 'spidermonkey',
          engineVersion,
          analysisType,
          rawOutput,
          artifacts: [],
          metadata: { flagsUsed: [], durationMs: Date.now() - startedAt, binaryPath }
        }
      });
    }
    ctx.emit({ t: 'done', requestId: req.requestId });
  }
}
