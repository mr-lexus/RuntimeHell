/**
 * V8EngineAdapter (plan todo 17/23): six analysis types against a managed
 * d8 / d8-debug binary. Capability gates run BEFORE any process spawns;
 * per-type timeout reuses ProcessRunner (tree-kill + journaling for free).
 *
 * Registry-facing wrapper V8EngineAdapterV0 lives at the bottom (todo 23).
 */
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  AnalysisEvent,
  AnalysisRequest,
  AnalysisResult,
  AnalysisStartRequest,
  AnalysisType,
  EngineCapabilities
} from '@rh/protocol';
import { realExecutor } from './probe.js';
import { trackedProcessIsolation } from '../execution/isolation.js';
import type { IsolatedRun, IsolatedRunOptions } from '../execution/isolation.js';
import { CapabilityGateError } from './engine-adapter.js';
import type { EngineAdapter, EngineDescription, AnalysisContext } from './engine-adapter.js';
import type { EngineRegistry } from './registry.js';

export { CapabilityGateError } from './engine-adapter.js';
export type { IsolatedRun, IsolatedRunOptions, IsolatedRunResult } from '../execution/isolation.js';

/** Plain runner without cancellation registration (used by direct tests). */
function plainIsolation(options: {
  exePath: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
}): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(options.exePath, options.args, { windowsHide: true, cwd: options.cwd });
    let out = '';
    let err = '';
    child.stdout?.on('data', (c: Buffer) => {
      out += c.toString('utf8');
    });
    child.stderr?.on('data', (c: Buffer) => {
      err += c.toString('utf8');
    });
    child.on('error', (e) => resolve({ code: -1, stdout: out, stderr: e.message, timedOut: false }));
    child.on('close', (code) => resolve({ code, stdout: out, stderr: err, timedOut: false }));
  });
}

const TYPE_FLAG_MAP: Record<AnalysisType, string[]> = {
  ast: ['--print-ast'],
  bytecode: ['--print-bytecode'],
  optcode: ['--print-opt-code'],
  'ir-graph': [], // composed below: needs the artifact directory
  deopts: ['--trace-deopt'],
  gc: ['--trace-gc']
};

const CAPABILITY_KEY: Record<AnalysisType, keyof Omit<EngineCapabilities, 'notes'>> = {
  ast: 'astDump',
  bytecode: 'bytecodeDump',
  optcode: 'optCodeDisasm',
  'ir-graph': 'irGraphDump',
  deopts: 'deoptTrace',
  gc: 'gcLog'
};

function tmpRoot(): string {
  return join(
    process.env['RH_CACHE_ROOT'] ?? join(process.env['LOCALAPPDATA'] ?? '.', 'RuntimeHell'),
    'analysis-tmp'
  );
}

function buildFlags(
  type: AnalysisType,
  workDir: string,
  functionName: string | undefined,
  perFunctionFilter: boolean
): string[] {
  if (type === 'ir-graph') {
    return ['--trace-turbo', `--trace-turbo-path=${workDir}`];
  }
  const flags = [...TYPE_FLAG_MAP[type]];
  if (type === 'bytecode') {
    // Definitions-only snippets never CALL their functions; lazy compilation
    // would print nothing. Eager-compile everything.
    //
    // NOTE (drift, V8 15.x): --print-bytecode-filter=<name> no longer matches
    // eagerly-compiled functions вЂ” their SharedFunctionInfo names are still
    // empty at dump time, so the filter yields ZERO output. We dump ALL blocks
    // and let the normalized view / caller locate the relevant ones.
    flags.push('--no-lazy');
  }
  return flags;
}

async function collectJsonArtifacts(dir: string): Promise<{ name: string; path: string }[]> {
  const names = await fs.readdir(dir);
  return names
    .filter((n) => n.endsWith('.json') || n.endsWith('.cfg'))
    .map((n) => ({ name: n, path: join(dir, n) }));
}

export interface V8AdapterDeps {
  /** Isolated execution (plain runner by default). */
  readonly runIsolated?: IsolatedRun;
  /** Capability source вЂ” the sha-keyed registry cache supplies this. */
  readonly capabilitiesOf: (binaryPath: string) => Promise<EngineCapabilities>;
  /** Simple executor for metadata probes (--version). */
  readonly execute?: typeof realExecutor;
}

export class V8EngineAdapter {
  private readonly runIsolated: IsolatedRun;
  private readonly capabilitiesOf: (binaryPath: string) => Promise<EngineCapabilities>;
  private readonly execute: typeof realExecutor;

  constructor(deps: V8AdapterDeps) {
    this.runIsolated = deps.runIsolated ?? plainIsolation;
    this.capabilitiesOf = deps.capabilitiesOf;
    this.execute = deps.execute ?? realExecutor;
  }

  async engineVersion(binaryPath: string): Promise<string> {
    const r = await this.execute(binaryPath, ['--version']);
    const match = /V8 version ([^\s]+)/.exec(r.stdout);
    return match?.[1] ?? `unknown (${r.stdout.trim() || r.stderr.trim()})`;
  }

  /**
   * Fan out one AnalysisResult per requested type. Throws CapabilityGateError
   * before spawning when the binary lacks the needed capability.
   */
  async analyze(req: AnalysisRequest & { binaryPath: string; timeoutMs?: number }): Promise<AnalysisResult[]> {
    const caps = await this.capabilitiesOf(req.binaryPath);
    const engineVersion = await this.engineVersion(req.binaryPath);
    const timeoutMs = req.timeoutMs ?? 10_000;

    const results: AnalysisResult[] = [];
    for (const analysisType of req.analysisTypes) {
      const capKey = CAPABILITY_KEY[analysisType];
      if (!caps[capKey]) {
        throw new CapabilityGateError(analysisType, capKey);
      }

      const token = `${Date.now()}-${randomUUID().slice(0, 8)}`;
      const workDir = join(tmpRoot(), `v8-${token}`);
      await fs.mkdir(workDir, { recursive: true });

      const entryFile = join(workDir, 'snippet.mjs');
      await fs.writeFile(entryFile, req.code, 'utf8');

      const flags = buildFlags(analysisType, workDir, req.functionName, caps.perFunctionFilter);
      const startedAt = Date.now();
      const run = await this.runIsolated({
        exePath: req.binaryPath,
        args: [...flags, entryFile],
        cwd: workDir,
        timeoutMs
      });

      let rawOutput = run.stdout;
      if (run.stderr !== '') rawOutput += `\n[stderr]\n${run.stderr}`;
      if (run.timedOut) rawOutput += `\n[runtimehell] analysis timed out after ${timeoutMs}ms`;

      const artifacts = analysisType === 'ir-graph' ? await collectJsonArtifacts(workDir) : [];

      results.push({
        source: req.code,
        engine: 'v8',
        engineVersion,
        analysisType,
        rawOutput,
        artifacts,
        metadata: {
          flagsUsed: flags,
          durationMs: Date.now() - startedAt,
          binaryPath: req.binaryPath
        }
      });
    }
    return results;
  }
}

// ---------------------------------------------------------------------------
// EngineAdapter implementation (todo 23): registry-facing wrapper owning the
// per-type sequencing, TS strip, and cancel-aware isolation.
// ---------------------------------------------------------------------------

interface EngineDescriptionShape {
  id: string;
  version: string | null;
  binaryPath: string | null;
  capabilities: EngineCapabilities | null;
  reason: string | null;
}

/** Registry-facing V8 adapter (id 'v8' | 'd8-debug'). */
export class V8EngineAdapterV0 implements EngineAdapter {
  readonly id: 'v8' | 'd8-debug';

  constructor(
    id: 'v8' | 'd8-debug',
    private readonly registry: import('./registry.js').EngineRegistry
  ) {
    this.id = id;
  }

  describe(): Promise<EngineDescriptionShape> {
    return this.registry.describe(this.id) as Promise<EngineDescriptionShape>;
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
    const inner = new V8EngineAdapter({
      capabilitiesOf: async () => caps,
      execute: realExecutor,
      runIsolated: trackedProcessIsolation(ctx, req.requestId)
    });

    // Engine shells execute plain JS: strip TS syntax up-front (todo 22).
    let code = req.code;
    if (req.lang === 'ts') {
      try {
        const { transform } = await import('esbuild');
        const stripped = await transform(req.code, { loader: 'ts', format: 'esm', target: 'esnext' });
        code = stripped.code;
      } catch (err) {
        ctx.emit({
          t: 'error',
          requestId: req.requestId,
          message: `type-strip failed: ${err instanceof Error ? err.message : String(err)}`
        });
        ctx.emit({ t: 'done', requestId: req.requestId });
        return;
      }
    }

    for (const analysisType of req.analysisTypes) {
      if (!ctx.isLive(req.requestId)) break; // cancelled between types
      try {
        const results = await inner.analyze({
          requestId: req.requestId,
          code,
          binaryPath,
          analysisTypes: [analysisType],
          functionName: req.functionName,
          timeoutMs: req.timeoutMs ?? 10_000
        });
        for (const result of results) {
          ctx.emit({ t: 'result', requestId: req.requestId, result });
        }
      } catch (err) {
        if (err instanceof CapabilityGateError) {
          ctx.emit({ t: 'unsupported', requestId: req.requestId, analysisType, reason: err.message });
          continue;
        }
        ctx.emit({
          t: 'error',
          requestId: req.requestId,
          message: err instanceof Error ? err.message : String(err)
        });
        break;
      }
    }
    ctx.emit({ t: 'done', requestId: req.requestId });
  }
}
