/**
 * ProcessRunner (plan todo 8): isolated child-process execution.
 *
 * Environment policy (documented per plan): children receive a MINIMAL
 * environment — SystemRoot/windir/TEMP/TMP/PROCESSOR_* plus a trimmed PATH
 * (System32 + the executable's own directory). Caller may extend via
 * `extraEnv` (used e.g. for JSC_* option overrides later). User secrets in the
 * parent environment are never inherited.
 *
 * Cancellation uses `taskkill /pid <pid> /T /F` on Windows so the whole tree
 * dies; idempotent; every run is journaled for startup orphan sweeps.
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import type { RunEvent, RunResult, SerializedValue } from '@rh/protocol';
import { SentinelLineSplitter, parseReportFrame } from './report-transport.js';
import type { ReportTransport } from './report-transport.js';
import { isAlive, readJournal, treeKill, writeJournal } from './run-journal.js';

// Compatibility surface: existing consumers import these from process-runner.
export { readJournal, sweepOrphans, writeJournal } from './run-journal.js';
export type { JournalEntry } from './run-journal.js';

export interface RunOptions {
  exePath: string;
  args?: string[];
  cwd: string;
  timeoutMs: number;
  extraEnv?: Record<string, string>;
  /** Directories prepended to the child PATH (e.g. WebKitRequirements bin64). */
  pathPrepend?: string[];
  /**
   * Carrier for ResultCapture frames. Children ALWAYS emit sentinel lines on
   * stderr (fd3 is never load-bearing); 'fd3' additionally pipes a dedicated
   * stdio[3] channel and the runner deduplicates by frame nonce.
   */
  reportTransport?: ReportTransport;
}

export interface RunHandle {
  runId: string;
  pid: number | null;
  result: Promise<RunResult>;
  cancel: () => Promise<void>;
}

function sanitizedEnv(
  exePath: string,
  extraEnv?: Record<string, string>,
  pathPrepend?: string[]
): NodeJS.ProcessEnv {
  const basePATH = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32') + ';' + dirname(exePath);
  const env: NodeJS.ProcessEnv = {
    SystemRoot: process.env['SystemRoot'],
    windir: process.env['windir'],
    TEMP: process.env['TEMP'],
    TMP: process.env['TMP'],
    PROCESSOR_ARCHITECTURE: process.env['PROCESSOR_ARCHITECTURE'],
    NUMBER_OF_PROCESSORS: process.env['NUMBER_OF_PROCESSORS'],
    PATH: pathPrepend !== undefined && pathPrepend.length > 0 ? [...pathPrepend, basePATH].join(';') : basePATH,
    ...(extraEnv ?? {})
  };
  return env;
}

// ---------------------------------------------------------------------------

export class ProcessRunner {
  private readonly listeners = new Set<(event: RunEvent) => void>();

  onEvent(cb: (event: RunEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(event: RunEvent): void {
    for (const cb of this.listeners) cb(event);
  }

  /** Coalescing stream pump: batches chunks ≥16ms to keep IPC cheap. */
  private makePump(runId: string, type: 'stdout' | 'stderr'): {
    push: (chunk: Buffer) => void;
    flush: () => void;
    dispose: () => void;
  } {
    let buffer = '';
    let timer: NodeJS.Timeout | null = null;
    const send = (): void => {
      if (!buffer) return;
      const data = buffer;
      buffer = '';
      this.emit({ type, runId, data });
    };
    timer = null;
    return {
      push: (chunk) => {
        buffer += chunk.toString('utf8');
        if (timer === null) {
          timer = setTimeout(() => {
            timer = null;
            send();
          }, 16);
        }
      },
      flush: () => {
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
        send();
      },
      dispose: () => {
        if (timer !== null) clearTimeout(timer);
      }
    };
  }

  run(options: RunOptions): RunHandle {
    const runId = randomUUID();
    const startedAt = Date.now();
    let cancelled: 'user' | 'timeout' | null = null;
    let settled = false;
    let childRef: ReturnType<typeof spawn> | null = null;

    const stdoutPump = this.makePump(runId, 'stdout');
    const stderrPump = this.makePump(runId, 'stderr');

    // --- ResultCapture frame plumbing (plan todo 10) -------------------------
    const reports = new Map<number, SerializedValue>();
    const seenNonces = new Set<number>();
    const handleFrameJson = (jsonPayload: string): void => {
      const frame = parseReportFrame(jsonPayload);
      if (frame === null) return;
      // Dual-channel delivery (stderr + fd3) is deduplicated by nonce.
      if (frame.nonce !== undefined) {
        if (seenNonces.has(frame.nonce)) return;
        seenNonces.add(frame.nonce);
      }
      if (frame.phase === 'error' || frame.value === undefined) return;
      reports.set(frame.index, frame.value);
      this.emit({ type: 'result', runId, index: frame.index, value: frame.value });
    };
    const stderrRouter = new SentinelLineSplitter({
      onSentinel: handleFrameJson,
      onText: (text) => stderrPump.push(Buffer.from(text, 'utf8'))
    });
    let fd3Router: SentinelLineSplitter | null = null;

    let resolveResult!: (r: RunResult) => void;
    const result = new Promise<RunResult>((resolve) => {
      resolveResult = resolve;
    });

    const finish = (status: RunResult['status'], code: number | null, signal: string | null): void => {
      if (settled) return;
      settled = true;
      stderrRouter.flush();
      fd3Router?.flush();
      stdoutPump.flush();
      stderrPump.flush();
      const durationMs = Date.now() - startedAt;
      this.emit({
        type: 'exit',
        runId,
        code,
        signal,
        durationMs,
        killedBy: cancelled
      });
      resolveResult({
        runId,
        status,
        exitCode: code,
        durationMs,
        // Last frame per index wins (promise settlement overwrites the
        // placeholder), ordered by index.
        reports: [...reports.entries()].sort((a, b) => a[0] - b[0]).map(([index, value]) => ({ index, value }))
      });
      // Mark journal entry exited.
      void readJournal().then((entries) => {
        const entry = entries.find((e) => e.runId === runId);
        if (entry) entry.exited = true;
        return writeJournal(entries);
      });
    };

    const handle: RunHandle = {
      runId,
      pid: null,
      result,
      cancel: async () => {
        if (cancelled === null) cancelled = 'user';
        const pid = handle.pid;
        if (pid !== null && (await isAlive(pid))) await treeKill(pid);
      }
    };

    try {
      const env = sanitizedEnv(options.exePath, options.extraEnv, options.pathPrepend);
      // The runner owns the transport decision; callers must not set this.
      env['RH_REPORT_TRANSPORT'] = options.reportTransport === 'fd3' ? 'fd3' : 'stderr';
      const stdio: ('pipe' | 'ignore')[] | undefined =
        options.reportTransport === 'fd3' ? ['pipe', 'pipe', 'pipe', 'pipe'] : undefined;

      const child = spawn(options.exePath, options.args ?? [], {
        cwd: options.cwd,
        env,
        windowsHide: true,
        stdio
      });
      childRef = child;
      handle.pid = child.pid ?? null;

      // Journal for orphan sweep.
      if (child.pid) {
        void readJournal().then((entries) =>
          writeJournal([...entries, { runId, pid: child.pid as number, startedAt: new Date(startedAt).toISOString(), exited: false }])
        );
      }

      child.stdout?.on('data', (c: Buffer) => stdoutPump.push(c));
      // stderr carries user output AND sentinel frames; the router separates them.
      child.stderr?.on('data', (c: Buffer) => stderrRouter.push(c.toString('utf8')));
      if (options.reportTransport === 'fd3') {
        fd3Router = new SentinelLineSplitter({ onSentinel: handleFrameJson, onText: () => undefined });
        const fd3 = child.stdio[3];
        fd3?.on('data', (c: Buffer) => fd3Router?.push(c.toString('utf8')));
      }
      child.on('error', (err: NodeJS.ErrnoException) => {
        stdoutPump.dispose();
        stderrPump.dispose();
        this.emit({ type: 'error', runId, message: err.message, code: err.code });
        finish('error', null, null);
      });
      child.on('close', (code, signal) => {
        stdoutPump.dispose();
        stderrPump.dispose();
        finish(cancelled === 'timeout' ? 'timeout' : cancelled === 'user' ? 'cancelled' : 'completed', code, signal);
      });

      // Timeout watchdog.
      setTimeout(() => {
        if (settled || cancelled !== null) return;
        cancelled = 'timeout';
        if (handle.pid !== null) void treeKill(handle.pid);
      }, options.timeoutMs);
    } catch (err) {
      this.emit({ type: 'error', runId, message: err instanceof Error ? err.message : String(err) });
      finish('error', null, null);
    }

    void childRef;
    return handle;
  }
}
