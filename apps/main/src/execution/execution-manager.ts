/**
 * ExecutionManager (plan todo 11): composes ResultCapture transform →
 * TranspileService → ProcessRunner for a single workspace file, enforcing
 * ONE active run per workspace (auto-run debouncing must never stack runs).
 *
 * Pure of electron imports: event delivery is an injected sink so the class
 * is unit-testable; index.ts binds the sink to webContents.send.
 */
import { join } from 'node:path';
import type { RunEvent, RunStartRequest, RunStartResponse } from '@rh/protocol';
import { probeFd3Support } from './fd3-probe.js';
import { injectCapture } from './result-capture.js';
import { ProcessRunner, type RunHandle } from './process-runner.js';
import { StackLineRemapper } from './stack-remapper.js';
import { needsTranspile, passthroughTo, transpileTo } from '../transpile/transpile-service.js';
import { detectSystemNode } from '../runtimes/node/node-runtime.js';
import { workspaceRoot } from '../workspace/files.js';

export interface ExecutionManagerDeps {
  /** Runtime executable resolution; default = cached system-node detection. */
  readonly resolveRuntime?: () => Promise<{ exePath: string; version: string } | null>;
  /** Runner factory; default = one shared ProcessRunner. */
  readonly createRunner?: () => ProcessRunner;
  /** Event delivery into the renderer. */
  readonly emit: (event: RunEvent) => void;
}

interface ActiveRun {
  readonly runId: string;
  readonly handle: RunHandle;
  readonly unsubscribe: () => void;
}

type RuntimeResolver = () => Promise<{ exePath: string; version: string } | null>;

let systemNodeCache: Promise<{ exePath: string; version: string } | null> | null = null;

function defaultResolveRuntime(): Promise<{ exePath: string; version: string } | null> {
  systemNodeCache ??= detectSystemNode();
  return systemNodeCache;
}

export class ExecutionManager {
  private readonly runner: ProcessRunner;
  private readonly resolveRuntime: RuntimeResolver;
  private readonly activeByWorkspace = new Map<string, ActiveRun>();
  private readonly activeByRunId = new Map<string, ActiveRun>();

  constructor(private readonly deps: ExecutionManagerDeps) {
    this.runner = deps.createRunner?.() ?? new ProcessRunner();
    this.resolveRuntime = deps.resolveRuntime ?? defaultResolveRuntime;
  }

  activeRunId(workspaceId: string): string | null {
    return this.activeByWorkspace.get(workspaceId)?.runId ?? null;
  }

  async start(req: RunStartRequest): Promise<RunStartResponse> {
    const existing = this.activeByWorkspace.get(req.workspaceId);
    if (existing) return { ok: false, stage: 'active', activeRunId: existing.runId };

    // Runtime first: fail before touching disk when no Node is available.
    const runtime = await this.resolveRuntime();
    if (!runtime) {
      return {
        ok: false,
        stage: 'runtime',
        message: 'no Node.js runtime found — install or manage one from the Runtimes panel'
      };
    }

    // Transform on AUTHORED source; retainLines keeps positions stable so the
    // esbuild sourcemap still points at original .ts lines.
    const captured = injectCapture(req.content);
    if (!captured.ok) return { ok: false, stage: 'transform', errors: [{ text: captured.error }] };

    let root: string;
    try {
      root = workspaceRoot(req.workspaceId); // validates + normalizes the id
    } catch (err) {
      return { ok: false, stage: 'runtime', message: err instanceof Error ? err.message : String(err) };
    }
    const buildDir = join(root, '.rhbuild');

    let entryPath: string;
    let mapPath: string | null = null;
    if (needsTranspile(req.relPath)) {
      const result = await transpileTo(buildDir, req.relPath, captured.code);
      if (!result.ok) return { ok: false, stage: 'transpile', errors: result.errors };
      entryPath = result.outputPath;
      mapPath = result.mapPath;
    } else {
      const result = await passthroughTo(buildDir, req.relPath, captured.code);
      entryPath = result.outputPath;
      mapPath = result.mapPath;
    }

    const bootstrap = join(__dirname, 'templates', 'bootstrap.cjs');
    const reportTransport = (await probeFd3Support(runtime.exePath)) ? ('fd3' as const) : ('stderr' as const);

    // stderr text flows through the remapper line-by-line (order-stable);
    // `currentRunId` is set as soon as the runner hands us the handle.
    let currentRunId = '';
    const remapper = new StackLineRemapper(mapPath, entryPath, (line, terminated) => {
      if (!currentRunId) return;
      this.deps.emit({ type: 'stderr', runId: currentRunId, data: terminated ? `${line}\n` : line });
    });

    const handle = this.runner.run({
      exePath: runtime.exePath,
      args: ['--require', bootstrap, entryPath],
      cwd: buildDir,
      timeoutMs: req.timeoutMs,
      reportTransport
    });
    currentRunId = handle.runId;

    // Subscribe AFTER spawn: the runner emits asynchronously (IO ticks), never
    // synchronously inside run(), and every event is filtered to THIS run so
    // concurrent workspaces sharing the runner cannot cross-talk.
    const unsubscribe = this.runner.onEvent((event) => {
      if (event.runId !== handle.runId) return;
      if (event.type === 'stderr') {
        // User stderr only: protocol frames were split out by the runner's
        // sentinel router before reaching this point.
        remapper.push(event.data);
        return;
      }
      this.deps.emit(event);
      if (event.type === 'exit') {
        remapper.flush();
        const run = this.activeByRunId.get(handle.runId);
        if (run) {
          this.activeByRunId.delete(handle.runId);
          this.activeByWorkspace.delete(req.workspaceId);
          run.unsubscribe();
        }
      }
    });

    const active: ActiveRun = { runId: handle.runId, handle, unsubscribe };
    this.activeByRunId.set(handle.runId, active);
    this.activeByWorkspace.set(req.workspaceId, active);

    return { ok: true, runId: handle.runId, runtimeVersion: runtime.version };
  }

  async cancel(runId: string): Promise<boolean> {
    const run = this.activeByRunId.get(runId);
    if (!run) return false;
    await run.handle.cancel();
    return true;
  }
}
