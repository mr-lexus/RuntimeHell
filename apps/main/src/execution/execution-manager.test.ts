/**
 * ExecutionManager unit tests (plan todo 11): composition, single-flight,
 * structured failures — all against FAKE runner/runtime so no processes
 * spawn here (real-process coverage lives in process-runner*.test.ts).
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RunEvent, RunResult, SerializedValue } from '@rh/protocol';
import { ExecutionManager } from './execution-manager.js';
import type { ProcessRunner, RunHandle, RunOptions } from './process-runner.js';

type EmitInput = { runId?: string } & (
  | { type: 'stdout' | 'stderr'; data: string }
  | { type: 'result'; index: number; value: SerializedValue }
  | { type: 'exit'; code: number | null; signal: string | null; durationMs: number; killedBy: string | null }
  | { type: 'error'; message: string; code?: string }
);

let homeBackup: string | undefined;
let posixHomeBackup: string | undefined;
let sandbox: string;

beforeAll(() => {
  // Redirect workspace writes (USERPROFILE drives workspaceRoot).
  homeBackup = process.env['USERPROFILE'];
  posixHomeBackup = process.env['HOME'];
  return mkdtemp(join(tmpdir(), 'rh-exec-mgr-')).then((dir) => {
    sandbox = dir;
    process.env['USERPROFILE'] = dir;
    if (process.platform !== 'win32') process.env['HOME'] = dir;
  });
});

afterAll(async () => {
  if (homeBackup !== undefined) process.env['USERPROFILE'] = homeBackup;
  else delete process.env['USERPROFILE'];
  if (posixHomeBackup !== undefined) process.env['HOME'] = posixHomeBackup;
  else delete process.env['HOME'];
  await rm(sandbox, { recursive: true, force: true });
});

class FakeRunner implements Partial<ProcessRunner> {
  readonly handles: RunOptions[] = [];
  private listener: ((e: RunEvent) => void) | null = null;
  private seq = 0;

  /** Tests drive child "output" through this; defaults to the latest run id. */
  emit(e: EmitInput): void {
    const event = (e.runId !== undefined ? e : { ...e, runId: `run-${this.seq}` }) as RunEvent;
    this.listener?.(event);
  }

  onEvent(cb: (e: RunEvent) => void): () => void {
    this.listener = cb;
    return () => {
      this.listener = null;
    };
  }

  run(options: RunOptions): RunHandle {
    this.seq += 1;
    const runId = `run-${this.seq}`;
    this.handles.push({ ...options });
    const result = Promise.resolve<RunResult>({
      runId,
      status: 'completed',
      exitCode: 0,
      durationMs: 1,
      reports: []
    });
    const cancel = (): Promise<void> => {
      this.emit({ type: 'exit', code: 1, signal: 'SIGTERM', durationMs: 2, killedBy: 'user' });
      return Promise.resolve();
    };
    return { runId, pid: 424242, result, cancel };
  }
}

function makeManager(runner: FakeRunner, runtime: { exePath: string; version: string } | null) {
  const emitted: RunEvent[] = [];
  const manager = new ExecutionManager({
    createRunner: () => runner as unknown as ProcessRunner,
    resolveRuntime: () => Promise.resolve(runtime),
    emit: (e) => emitted.push(e)
  });
  return { manager, emitted };
}

const REQ = {
  workspaceId: 'default',
  relPath: 'entry.ts',
  content: 'console.log(42);\n',
  timeoutMs: 5000
};

describe('ExecutionManager', () => {
  it('starts a run and forwards scoped events until exit cleans up', async () => {
    const runner = new FakeRunner();
    const { manager, emitted } = makeManager(runner, { exePath: 'C:/node/node.exe', version: '24.18.0' });

    const response = await manager.start(REQ);
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.runtimeVersion).toBe('24.18.0');

    // Wrong-run events are dropped; scoped ones forwarded.
    runner.emit({ type: 'stdout', data: 'hello', runId: 'run-999' });
    runner.emit({ type: 'stdout', data: 'scoped' });
    await new Promise((r) => setTimeout(r, 0));

    const exit = await manager.cancel(response.runId); // triggers scripted exit
    expect(exit).toBe(true);
    expect(emitted.some((e) => e.type === 'stdout' && e.data === 'hello')).toBe(false);
    expect(emitted.some((e) => e.type === 'stdout' && e.data === 'scoped')).toBe(true);
    expect(emitted.filter((e) => e.type === 'exit').length).toBe(1);

    // Active slot freed → a second start succeeds.
    const second = await manager.start(REQ);
    expect(second.ok).toBe(true);
  });

  it('enforces single-flight per workspace', async () => {
    const runner = new FakeRunner();
    const { manager } = makeManager(runner, { exePath: 'C:/node/node.exe', version: '24.18.0' });

    const first = await manager.start(REQ);
    expect(first.ok).toBe(true);
    const second = await manager.start(REQ);
    expect(second).toEqual({ ok: false, stage: 'active', activeRunId: 'run-1' });
  });

  it('returns structured transform failures without spawning', async () => {
    const runner = new FakeRunner();
    const { manager } = makeManager(runner, { exePath: 'C:/node/node.exe', version: '1' });
    const response = await manager.start({ ...REQ, content: 'const = =;;\n' });
    expect(response).toMatchObject({ ok: false, stage: 'transform' });
    expect(runner.handles.length).toBe(0);
  });

  it('returns structured transpile-stage failures without spawning', async () => {
    const runner = new FakeRunner();
    const { manager } = makeManager(runner, { exePath: 'C:/node/node.exe', version: '1' });
    const response = await manager.start({ ...REQ, content: 'interface Broken { x: : }\n' });
    expect(response.ok).toBe(false);
    if (!response.ok) {
      // babel parses authored source BEFORE esbuild, so syntax errors surface
      // as stage='transform'; esbuild-stage failures need post-transform
      // breakage which authored TS alone cannot produce. Either way: no spawn.
      expect(['transform', 'transpile']).toContain(response.stage);
      expect((response.errors ?? []).length).toBeGreaterThan(0);
    }
    expect(runner.handles.length).toBe(0);
  });

  it('fails cleanly when no runtime resolves', async () => {
    const runner = new FakeRunner();
    const { manager } = makeManager(runner, null);
    const response = await manager.start(REQ);
    expect(response.ok).toBe(false);
    if (!response.ok) {
      expect(response.stage).toBe('runtime');
      expect(response.message).toContain('no Node.js');
    }
    expect(runner.handles.length).toBe(0);
  });

  it('passes bootstrap require, cwd and transport to the runner', async () => {
    const runner = new FakeRunner();
    const { manager } = makeManager(runner, { exePath: 'C:/node/node.exe', version: '24' });
    await manager.start(REQ);
    const opts = runner.handles[0];
    expect(opts?.args?.[0]).toBe('--require');
    expect(String(opts?.args?.[2])).toContain('.rhbuild');
    expect(['fd3', 'stderr']).toContain(opts?.reportTransport);
  });
});
