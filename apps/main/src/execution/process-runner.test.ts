/**
 * ProcessRunner integration tests (plan todo 8 QA): REAL child processes.
 * Uses the current Node executable as the spawned binary.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProcessRunner, sweepOrphans } from './process-runner.js';
import { isRecentJournalEntry } from './run-journal.js';

let dir: string;
let nodeExe: string;
let cacheRootBackup: string | undefined;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'rh-runner-'));
  nodeExe = process.execPath;
  cacheRootBackup = process.env['RH_CACHE_ROOT'];
  process.env['RH_CACHE_ROOT'] = join(dir, 'cache');
});

afterAll(async () => {
  if (cacheRootBackup === undefined) delete process.env['RH_CACHE_ROOT'];
  else process.env['RH_CACHE_ROOT'] = cacheRootBackup;
  await rm(dir, { recursive: true, force: true });
});

function script(name: string, code: string): Promise<string> {
  return writeFile(join(dir, name), code, 'utf8').then(() => join(dir, name));
}

describe('ProcessRunner (real processes)', () => {
  it('streams stdout and completes', async () => {
    const entry = await script('ok.cjs', "console.log('hello from child');\n");
    const runner = new ProcessRunner();
    const events: string[] = [];
    runner.onEvent((e) => events.push(e.type + ':' + ('data' in e ? e.data : '')));
    const handle = runner.run({ exePath: nodeExe, args: [entry], cwd: dir, timeoutMs: 5000 });
    const result = await handle.result;
    expect(result.status).toBe('completed');
    expect(result.exitCode).toBe(0);
    expect(events.some((e) => e.startsWith('stdout:') && e.includes('hello from child'))).toBe(true);
    expect(events.some((e) => e.startsWith('exit:'))).toBe(true);
  });

  it('cancel() kills an infinite loop and the process disappears', async () => {
    const entry = await script('loop.cjs', 'setInterval(()=>{},10);\n');
    const runner = new ProcessRunner();
    const handle = runner.run({ exePath: nodeExe, args: [entry], cwd: dir, timeoutMs: 60000 });
    await new Promise((r) => setTimeout(r, 400)); // let it start
    expect(handle.pid).not.toBeNull();
    await handle.cancel();
    const result = await handle.result;
    expect(result.status).toBe('cancelled');

    // Process must be gone (kill(pid,0) throws ESRCH).
    const alive = await new Promise<boolean>((resolve) => {
      try {
        process.kill(handle.pid!, 0);
        resolve(true);
      } catch {
        resolve(false);
      }
    });
    expect(alive).toBe(false);
  });

  it('timeout kills a slow run with killedBy=timeout', async () => {
    const entry = await script('slow.cjs', 'setTimeout(()=>{},60000);\n');
    const runner = new ProcessRunner();
    const handle = runner.run({ exePath: nodeExe, args: [entry], cwd: dir, timeoutMs: 250 });
    const result = await handle.result;
    expect(result.status).toBe('timeout');
    expect(result.durationMs).toBeLessThan(5000);
  });

  it('missing executable produces structured error event, no throw', async () => {
    const runner = new ProcessRunner();
    const errors: string[] = [];
    runner.onEvent((e) => {
      if (e.type === 'error') errors.push(e.code ?? '');
    });
    const handle = runner.run({
      exePath: join(dir, 'definitely-missing'),
      cwd: dir,
      timeoutMs: 2000
    });
    const result = await handle.result;
    expect(result.status).toBe('error');
    expect(errors.length).toBe(1);
  });

  it('sanitizes the environment (parent secrets not inherited)', async () => {
    process.env['RH_SECRET_CANARY'] = 'super-secret-value';
    const entry = await script('env.cjs', 'console.log(JSON.stringify(process.env));\n');
    const runner = new ProcessRunner();
    const handle = runner.run({ exePath: nodeExe, args: [entry], cwd: dir, timeoutMs: 5000 });
    const chunks: string[] = [];
    runner.onEvent((e) => {
      if (e.type === 'stdout') chunks.push(e.data);
    });
    await handle.result;
    delete process.env['RH_SECRET_CANARY'];
    const env = JSON.parse(chunks.join('')) as Record<string, string>;
    expect(env['RH_SECRET_CANARY']).toBeUndefined();
    expect(env['PATH']).toBeTruthy();
  });

  it('sweepOrphans clears the journal without throwing', async () => {
    // Journal a pid that is already dead. NOTE: Windows cannot reliably probe
    // pid liveness via kill(pid,0), so we assert journal semantics only.
    const { writeJournal } = await import('./process-runner.js');
    await writeJournal([{ runId: 'dead-beef-dead-beef', pid: 999999999, startedAt: new Date().toISOString(), exited: false }]);
    const killed = await sweepOrphans();
    expect(killed).toBeGreaterThanOrEqual(0);
    const journal = await readJournalSafe();
    expect(journal.length).toBe(0);
  });

  it('does not consider stale journal entries safe to kill after PID reuse is possible', () => {
    const now = Date.now();
    expect(isRecentJournalEntry({ runId: 'recent-run', pid: 123, startedAt: new Date(now - 1_000).toISOString(), exited: false }, now)).toBe(true);
    expect(isRecentJournalEntry({ runId: 'stale-run', pid: 123, startedAt: new Date(now - 48 * 60 * 60 * 1_000).toISOString(), exited: false }, now)).toBe(false);
  });

  it('filters malformed journal records before orphan processing', async () => {
    const cacheRoot = process.env['RH_CACHE_ROOT'];
    if (!cacheRoot) throw new Error('test cache root is missing');
    await mkdir(cacheRoot, { recursive: true });
    await writeFile(join(cacheRoot, 'run-journal.json'), JSON.stringify([
      { runId: 'valid-run', pid: 123, startedAt: new Date().toISOString(), exited: true },
      { runId: 'invalid-run', pid: '123', startedAt: 'yesterday', exited: false }
    ]), 'utf8');

    await expect(readJournalSafe()).resolves.toEqual([
      expect.objectContaining({ runId: 'valid-run', pid: 123, exited: true })
    ]);
  });
});

async function readJournalSafe(): Promise<unknown[]> {
  const mod = await import('./process-runner.js');
  return mod.readJournal();
}
