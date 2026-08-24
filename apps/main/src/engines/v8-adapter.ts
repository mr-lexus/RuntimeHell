/**
 * V8EngineAdapter (plan todo 17): six analysis types against a managed d8 /
 * d8-debug binary. Capability gates run BEFORE any process spawns; per-type
 * timeout reuses ProcessRunner (tree-kill + journaling for free).
 *
 * Raw output policy: stdout is authoritative and preserved verbatim; stderr,
 * when non-empty, is appended after a labeled separator so nothing is lost.
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AnalysisEvent, AnalysisRequest, AnalysisResult, AnalysisStartRequest, AnalysisType, EngineCapabilities } from '@rh/protocol';
import { realExecutor } from './probe.js';
import type { AnalysisContext, EngineAdapter, EngineDescription } from './engine-adapter.js';
import type { EngineRegistry } from './registry.js';

export interface V8AdapterDeps {
  /** Isolated execution (ProcessRunner-backed by default). */
  readonly runIsolated?: IsolatedRun;
  /** Capability source вЂ” the sha-keyed registry cache supplies this. */
  readonly capabilitiesOf: (binaryPath: string) => Promise<EngineCapabilities>;
  /** Simple executor for metadata probes (--version). */
  readonly execute?: typeof realExecutor;
}

export interface IsolatedRunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export type IsolatedRun = (options: {
  exePath: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
}) => Promise<IsolatedRunResult>;

/** ProcessRunner-backed isolation: journaling + tree-kill reused here. */
export const processRunnerIsolation: IsolatedRun = async (options) => {
  const { ProcessRunner } = await import('../execution/process-runner.js');
  const runner = new ProcessRunner();
  const out: string[] = [];
  const err: string[] = [];
  let timedOut = false;
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
  const result = await handle.result;
  off();
  timedOut = result.status === 'timeout';
  return { code: result.exitCode, stdout: out.join(''), stderr: err.join(''), timedOut };
};

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

export class CapabilityGateError extends Error {
  constructor(
    readonly analysisType: AnalysisType,
    readonly requiredCapability: string
  ) {
    super(`binary lacks ${requiredCapability} for '${analysisType}' (capability gate)`);
  }
}

export class V8EngineAdapter {
  private readonly runIsolated: IsolatedRun;
  private readonly capabilitiesOf: NonNullable<V8AdapterDeps['capabilitiesOf']>;
  private readonly execute: NonNullable<V8AdapterDeps['execute']>;

  constructor(deps: V8AdapterDeps) {
    this.runIsolated = deps.runIsolated ?? processRunnerIsolation;
    this.capabilitiesOf = deps.capabilitiesOf;
    this.execute = deps.execute ?? realExecutor;
  }

  /**
   * Full per-type orchestration for one request (moved here from
   * AnalysisManager in todo 23 so ALL engine-specific sequencing lives in
   * the adapter layer): TS strip в†’ per-type gate/run в†’ partial-success
   * events в†’ done.
   */
  async runAll(
    req: AnalysisStartRequest,
    binaryPath: string,
    caps: EngineCapabilities,
    emit: (e: AnalysisEvent) => void,
    live: { has(id: string): boolean }
  ): Promise<void> {
    // Engine shells execute plain JS: strip TS syntax up-front (todo 22).
    let code = req.code;
    if (req.lang === 'ts') {
      try {
        const { transform } = await import('esbuild');
        const stripped = await transform(req.code, { loader: 'ts', format: 'esm', target: 'esnext' });
        code = stripped.code;
      } catch (err) {
        emit({
          t: 'error',
          requestId: req.requestId,
          message: `type-strip failed: ${err instanceof Error ? err.message : String(err)}`
        });
        emit({ t: 'done', requestId: req.requestId });
        return;
      }
    }

    for (const analysisType of req.analysisTypes) {
      if (!live.has(req.requestId)) break; // cancelled between types
      try {
        const results = await this.analyze({
          requestId: req.requestId,
          code,
          binaryPath,
          analysisTypes: [analysisType],
          functionName: req.functionName,
          timeoutMs: req.timeoutMs ?? 10_000
        });
        for (const result of results) {
          emit({ t: 'result', requestId: req.requestId, result });
        }
      } catch (err) {
        if (err instanceof CapabilityGateError) {
          emit({ t: 'unsupported', requestId: req.requestId, analysisType, reason: err.message });
          continue;
        }
        emit({
          t: 'error',
          requestId: req.requestId,
          message: err instanceof Error ? err.message : String(err)
        });
        break;
      }
    }
    emit({ t: 'done', requestId: req.requestId });
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
  async analyze(
    req: AnalysisRequest & { binaryPath: string; timeoutMs?: number }
  ): Promise<AnalysisResult[]> {
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

function tmpRoot(): string {
  return join(process.env['RH_CACHE_ROOT'] ?? join(process.env['LOCALAPPDATA'] ?? '.', 'RuntimeHell'), 'analysis-tmp');
}

function buildFlags(
  type: AnalysisType,
  workDir: string,
  functionName: string | undefined,
  perFunctionFilter: boolean
): string[] {
  if (type === 'ir-graph') {
    return [`--trace-turbo`, `--trace-turbo-path=${workDir}`];
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

// ---------------------------------------------------------------------------
// EngineAdapter implementation (todo 23): registry-facing wrapper owning the
// per-type sequencing, TS strip, and cancel-aware isolation.
// ---------------------------------------------------------------------------

/** ProcessRunner-backed isolation that registers its kill-hook via ctx. */
export function trackedProcessIsolation(ctx: AnalysisContext, requestId: string): IsolatedRun {
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
    ctx.registerCancel(async () => {
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
    }
  };
}

/** Registry-facing V8 adapter (id 'v8' | 'd8-debug'). */
export class V8EngineAdapterV0 implements EngineAdapter {
  constructor(
    readonly id: 'v8' | 'd8-debug',
    private readonly registry: EngineRegistry
  ) {}

  async describe(): Promise<EngineDescription> {
    return this.registry.describe(this.id);
  }

  async analyze(
    req: AnalysisStartRequest & { binaryPath: string },
    ctx: AnalysisContext
  ): Promise<void> {
    const description = await this.registry.describe(this.id);
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
