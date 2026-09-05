/**
 * ExecutionManager (plan todo 11): composes ResultCapture transform →
 * TranspileService → ProcessRunner for a single workspace file, enforcing
 * ONE active run per workspace (auto-run debouncing must never stack runs).
 *
 * Runtime switching: `RunStartRequest.runtimeId` ('node' | 'deno' | 'bun' | 'browser')
 * selects the execution lane; omitting it (or 'node') keeps the exact
 * historical flow (`node --require bootstrap.cjs entry`).
 *
 * Pure of electron imports: event delivery is an injected sink so the class
 * is unit-testable; index.ts binds the sink to webContents.send.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ManifestEntry, NvmInfo, RunEvent, RunStartRequest, RunStartResponse, RuntimeId } from '@rh/protocol';
import { probeFd3Support } from './fd3-probe.js';
import { injectCapture } from './result-capture.js';
import { ProcessRunner, type RunHandle } from './process-runner.js';
import { StackLineRemapper } from './stack-remapper.js';
import { bundleBrowserTo, needsTranspile, passthroughTo, transpileTo } from '../transpile/transpile-service.js';
import { detectSystemNode } from '../runtimes/node/node-runtime.js';
import { detectNvmNode } from '../runtimes/runtime-detection.js';
import { resolveRuntimeChoice } from '../runtimes/runtime-resolver.js';
import { DenoBunRuntimeAdapter, type ResolvedRuntime } from '../runtimes/runtime-adapter.js';
import { EmbeddedBrowserRuntime, type BrowserRuntimeRunner } from '../runtimes/browser/browser-runtime.js';
import { readManifest } from '../binaries/binary-manager.js';
import { workspaceRoot } from '../workspace/files.js';

export interface ExecutionManagerDeps {
  /**
   * Runtime executable resolution. Receives the REQUESTED runtime id so tests
   * (and future callers) can stub per-runtime resolution; defaults to the
   * resolver chain for 'node' and system+managed detection for deno/bun.
   * Zero-argument injectors remain valid — they simply ignore both params.
   */
  readonly resolveRuntime?: (runtimeId: RuntimeId, requestedVersion?: string) => Promise<ResolvedRuntime | null>;
  /** Runner factory; default = one shared ProcessRunner. */
  readonly createRunner?: () => ProcessRunner;
  /** Browser lane runner; injected in tests to avoid starting Electron. */
  readonly createBrowserRunner?: () => BrowserRuntimeRunner;
  /** Event delivery into the renderer. */
  readonly emit: (event: RunEvent) => void;
  /** History recorder (todo 21); injected so tests stay filesystem-free. */
  readonly recordRun?: (record: {
    workspaceId: string;
    runId: string;
    startedAt: string;
    finishedAt: string;
    relPath: string;
    contentSnapshot: string;
    status: string;
    exitCode: number | null;
    durationMs: number;
    killedBy: string | null;
  }) => void;
}

interface RunnerLike {
  onEvent(cb: (event: RunEvent) => void): () => void;
  run(options: import('./process-runner.js').RunOptions): RunHandle;
}

interface ActiveRun {
  readonly runId: string;
  readonly handle: RunHandle;
  readonly unsubscribe: () => void;
}

type RuntimeResolver = (runtimeId: RuntimeId, requestedVersion?: string) => Promise<ResolvedRuntime | null>;

let systemNodeCache: Promise<{ exePath: string; version: string } | null> | null = null;
let nvmCache: Promise<NvmInfo | null> | null = null;

/** Browser pages have no Node module loader. Bundle only module-bearing source
 * so ordinary script snippets (including the existing top-level `return`
 * convenience) keep the browser lane's original evaluation semantics. */
function needsBrowserBundle(source: string): boolean {
  return /\brequire\s*\(\s*['"]|^\s*(?:import|export)\b/m.test(source);
}

function ensureSystemDetected(): Promise<{ exePath: string; version: string } | null> {
  systemNodeCache ??= detectSystemNode();
  return systemNodeCache;
}

function ensureNvmDetected(): Promise<NvmInfo | null> {
  nvmCache ??= detectNvmNode();
  return nvmCache;
}

/**
 * Runtime-unavailable message naming the requested runtime, so the Runtimes
 * panel hint stays actionable for every lane.
 */
export function runtimeUnavailableMessage(runtimeId: RuntimeId): string {
  const name = runtimeId === 'node' ? 'Node.js' : runtimeId === 'deno' ? 'Deno' : runtimeId === 'bun' ? 'Bun' : 'Chromium Browser';
  return `no ${name} runtime found — install or manage one from the Runtimes panel`;
}

/**
 * Displayed resolution order (todo 12): requested managed version → native nvm
 * version → system installation → 'none' (UI offers a managed download). The
 * manifest is read per call: installs/uninstalls mutate it between runs.
 * Deno/Bun skip the nvm lane entirely (DenoBunRuntimeAdapter).
 */
async function defaultResolveRuntime(runtimeId: RuntimeId, requestedVersion?: string): Promise<ResolvedRuntime | null> {
  if (runtimeId === 'browser') {
    return { exePath: process.execPath, version: process.versions.v8 ?? process.versions.chrome ?? 'embedded' };
  }
  if (runtimeId !== 'node') {
    return new DenoBunRuntimeAdapter(runtimeId).resolveExecutable(requestedVersion);
  }
  const [manifest, system, nvm] = await Promise.all([readManifest(), ensureSystemDetected(), ensureNvmDetected()]);
  const entries: ManifestEntry[] = manifest.entries;
  const picked = resolveRuntimeChoice(requestedVersion, entries, system, nvm);
  return picked.kind === 'none' ? null : { exePath: picked.exePath, version: picked.version };
}

/**
 * Deno/Bun capture prelude, PREPENDED to the entry file. Chosen over
 * --preload/--require because neither runtime guarantees those flags under a
 * sanitized Windows env, while prepending works everywhere: esbuild `banner`
 * for transpiled sources (banner lines stay OUT of the source map — verified
 * empirically — so stack remapping of the real program remains
 * offset-correct) and plain string prefix for passthrough files.
 * Loaded lazily and cached: the Node lane never touches this file.
 */
let capturePreludeCache: string | null = null;
function capturePrelude(): string {
  capturePreludeCache ??= readFileSync(join(__dirname, 'templates', 'capture-prelude.cjs'), 'utf8');
  return capturePreludeCache;
}

export class ExecutionManager {
  private readonly runner: RunnerLike;
  private readonly browserRunner: RunnerLike;
  private readonly resolveRuntime: RuntimeResolver;
  private readonly activeByWorkspace = new Map<string, ActiveRun>();
  private readonly activeByRunId = new Map<string, ActiveRun>();

  constructor(private readonly deps: ExecutionManagerDeps) {
    this.runner = deps.createRunner?.() ?? new ProcessRunner();
    this.browserRunner = deps.createBrowserRunner?.() ?? new EmbeddedBrowserRuntime();
    this.resolveRuntime = deps.resolveRuntime ?? defaultResolveRuntime;
  }

  activeRunId(workspaceId: string): string | null {
    return this.activeByWorkspace.get(workspaceId)?.runId ?? null;
  }

  async start(req: RunStartRequest): Promise<RunStartResponse> {
    const existing = this.activeByWorkspace.get(req.workspaceId);
    if (existing) return { ok: false, stage: 'active', activeRunId: existing.runId };

    // Runtime dispatch: runtimeId defaults to 'node' so pre-runtime-switching
    // renderers behave exactly as before.
    const runtimeId: RuntimeId = req.runtimeId ?? 'node';
    const isNode = runtimeId === 'node';
    const isBrowser = runtimeId === 'browser';

    // Runtime first: fail before touching disk when no runtime is available.
    const runtime = await this.resolveRuntime(runtimeId, req.runtimeVersion);
    if (!runtime) {
      return {
        ok: false,
        stage: 'runtime',
        message: runtimeUnavailableMessage(runtimeId)
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

    // Deno/Bun: inject the self-contained capture prelude into the entry.
    // Node/browser: use their native host hooks, no banner.
    const prelude = isNode || isBrowser ? '' : capturePrelude();

    let entryPath: string;
    let mapPath: string | null = null;
    // `lang === 'js'` forces passthrough even for .ts/.tsx/.mts so Node 22+
    // can `--experimental-strip-types` the source unchanged. `undefined`/`'ts'`
    // preserves the original esbuild-on-extension behavior.
    // Deno/Bun KEEP the esbuild transpile: the capture transform emits plain
    // JS (babel strips types) but JSX and module interop still need a real
    // transform, and the esbuild banner carries the prelude with an
    // offset-correct source map. Skipping esbuild (native TS) would cost
    // capture parity for no benefit — documented decision.
    const forcePassthrough = req.lang === 'js';
    const shouldTranspile = !forcePassthrough && needsTranspile(req.relPath);
    if (isBrowser && needsBrowserBundle(captured.code)) {
      const result = await bundleBrowserTo(buildDir, root, req.relPath, captured.code);
      if (!result.ok) return { ok: false, stage: 'transpile', errors: result.errors };
      entryPath = result.outputPath;
      mapPath = result.mapPath;
    } else if (shouldTranspile) {
      const result = await transpileTo(buildDir, req.relPath, captured.code, isNode || isBrowser ? {} : { banner: prelude });
      if (!result.ok) return { ok: false, stage: 'transpile', errors: result.errors };
      entryPath = result.outputPath;
      mapPath = result.mapPath;
    } else {
      const result = await passthroughTo(buildDir, req.relPath, isNode || isBrowser ? captured.code : `${prelude}\n${captured.code}`);
      entryPath = result.outputPath;
      mapPath = result.mapPath;
    }

    const bootstrap = join(__dirname, 'templates', 'bootstrap.cjs');
    // fd3 transport is Node-only: Deno/Bun run stderr-only and NEVER open fd3.
    const reportTransport = isNode && (await probeFd3Support(runtime.exePath)) ? ('fd3' as const) : ('stderr' as const);
    const startedAt = Date.now();

    // stderr text flows through the remapper line-by-line (order-stable);
    // `currentRunId` is set as soon as the runner hands us the handle.
    let currentRunId = '';
    const remapper = new StackLineRemapper(mapPath, entryPath, (line, terminated) => {
      if (!currentRunId) return;
      this.deps.emit({ type: 'stderr', runId: currentRunId, data: terminated ? `${line}\n` : line });
    });

    // Per-runtime invocation:
    //   node → `node --require bootstrap.cjs <entry>` (unchanged flow)
    //   deno → `deno run <entry>` · bun → `bun run <entry>`
    //   browser → hidden Chromium page (the BrowserRuntimeRunner consumes the entry)
    // Capture frames arrive via the prepended prelude on stderr, which
    // ProcessRunner routes/deduplicates exactly like the Node lane.
    const selectedRunner = isBrowser ? this.browserRunner : this.runner;
    const handle = selectedRunner.run({
      exePath: runtime.exePath,
      args: isNode ? ['--require', bootstrap, entryPath] : ['run', entryPath],
      cwd: buildDir,
      timeoutMs: req.timeoutMs,
      reportTransport
    });
    currentRunId = handle.runId;

    // Subscribe AFTER spawn: the runner emits asynchronously (IO ticks), never
    // synchronously inside run(), and every event is filtered to THIS run so
    // concurrent workspaces sharing the runner cannot cross-talk.
    const unsubscribe = selectedRunner.onEvent((event) => {
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
        // History ring (todo 21): request snapshot + result summary.
        try {
          this.deps.recordRun?.({
            workspaceId: req.workspaceId,
            runId: handle.runId,
            startedAt: new Date(startedAt).toISOString(),
            finishedAt: new Date().toISOString(),
            relPath: req.relPath,
            contentSnapshot: req.content,
            status: event.killedBy === 'timeout' ? 'timeout' : event.killedBy === 'user' ? 'cancelled' : 'completed',
            exitCode: event.code,
            durationMs: event.durationMs,
            killedBy: event.killedBy
          });
        } catch {
          /* history is best-effort */
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
