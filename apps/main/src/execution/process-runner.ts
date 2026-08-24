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
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { RunEvent, RunResult } from '@rh/protocol';
import { cacheRoot } from '../binaries/paths.js';

export interface RunOptions {
  exePath: string;
  args?: string[];
  cwd: string;
  timeoutMs: number;
  extraEnv?: Record<string, string>;
}

export interface RunHandle {
  runId: string;
  pid: number | null;
  result: Promise<RunResult>;
  cancel: () => Promise<void>;
}

function sanitizedEnv(exePath: string, extraEnv?: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    SystemRoot: process.env['SystemRoot'],
    windir: process.env['windir'],
    TEMP: process.env['TEMP'],
    TMP: process.env['TMP'],
    PROCESSOR_ARCHITECTURE: process.env['PROCESSOR_ARCHITECTURE'],
    NUMBER_OF_PROCESSORS: process.env['NUMBER_OF_PROCESSORS'],
    PATH: join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32') + ';' + dirname(exePath),
    ...(extraEnv ?? {})
  };
  return env;
}

function treeKill(pid: number): Promise<void> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      try {
        process.kill(pid);
      } catch {
        /* already dead */
      }
      resolve();
      return;
    }
    const tk = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
    tk.on('error', () => resolve());
    tk.on('close', () => resolve());
  });
}

async function isAlive(pid: number): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      process.kill(pid, 0);
      resolve(true);
    } catch {
      resolve(false);
    }
  });
}

// ---------------------------------------------------------------------------
// Run journal (orphan sweep support)
// ---------------------------------------------------------------------------

function journalPath(): string {
  return join(cacheRoot(), 'run-journal.json');
}

interface JournalEntry {
  runId: string;
  pid: number;
  startedAt: string;
  exited: boolean;
}

export async function readJournal(): Promise<JournalEntry[]> {
  try {
    return JSON.parse(await fs.readFile(journalPath(), 'utf8')) as JournalEntry[];
  } catch {
    return [];
  }
}

export async function writeJournal(entries: JournalEntry[]): Promise<void> {
  await fs.mkdir(cacheRoot(), { recursive: true });
  await fs.writeFile(journalPath(), JSON.stringify(entries, null, 2), 'utf8');
}

/** Kill any journaled processes that never reported exit (crash recovery). */
export async function sweepOrphans(): Promise<number> {
  const entries = await readJournal();
  let killed = 0;
  for (const entry of entries) {
    if (!entry.exited && (await isAlive(entry.pid))) {
      await treeKill(entry.pid);
      killed++;
    }
    entry.exited = true;
  }
  await writeJournal([]);
  return killed;
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

    let resolveResult!: (r: RunResult) => void;
    const result = new Promise<RunResult>((resolve) => {
      resolveResult = resolve;
    });

    const finish = (status: RunResult['status'], code: number | null, signal: string | null): void => {
      if (settled) return;
      settled = true;
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
      resolveResult({ runId, status, exitCode: code, durationMs, reports: [] });
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
      const child = spawn(options.exePath, options.args ?? [], {
        cwd: options.cwd,
        env: sanitizedEnv(options.exePath, options.extraEnv),
        windowsHide: true
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
      child.stderr?.on('data', (c: Buffer) => stderrPump.push(c));
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
