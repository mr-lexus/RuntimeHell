/**
 * ExecutionManager composed-path integration (plan todo 11 QA happy):
 * REAL system node through transform → esbuild → capture → runner.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RunEvent } from '@rh/protocol';
import { ExecutionManager } from './execution-manager.js';
import { ProcessRunner } from './process-runner.js';
import { appendHistory, readHistory } from '../workspace/history.js';

let homeBackup: string | undefined;
let posixHomeBackup: string | undefined;
let cacheRootBackup: string | undefined;
let sandbox: string;
let nodeExe = '';

const DEMO_TS = [
  'interface User { id: number; name: string; active: boolean }',
  "const users: User[] = [{ id: 1, name: 'Alex', active: true }];",
  'const active = users.filter((u) => u.active);',
  "console.log('active users:', active.length);",
  'sum(40, 2);',
  'function sum(a: number, b: number): number {',
  '  return a + b;',
  '}'
].join('\n');

beforeAll(async () => {
  nodeExe = process.execPath;
  homeBackup = process.env['USERPROFILE'];
  posixHomeBackup = process.env['HOME'];
  cacheRootBackup = process.env['RH_CACHE_ROOT'];
  sandbox = await mkdtemp(join(tmpdir(), 'rh-exec-e2e-'));
  process.env['USERPROFILE'] = sandbox;
  process.env['RH_CACHE_ROOT'] = join(sandbox, 'cache');
  if (process.platform !== 'win32') process.env['HOME'] = sandbox;
});

afterAll(async () => {
  if (homeBackup !== undefined) process.env['USERPROFILE'] = homeBackup;
  else delete process.env['USERPROFILE'];
  if (posixHomeBackup !== undefined) process.env['HOME'] = posixHomeBackup;
  else delete process.env['HOME'];
  if (cacheRootBackup !== undefined) process.env['RH_CACHE_ROOT'] = cacheRootBackup;
  else delete process.env['RH_CACHE_ROOT'];
  await rm(sandbox, { recursive: true, force: true });
});

describe('ExecutionManager (composed path, real node)', () => {
  it('delivers final stderr before exit and persists the failed run by the time exit is visible', async () => {
    const emitted: RunEvent[] = [];
    const workspaceId = 'failed-script';
    const content = "process.stderr.write('first\\nlast'); process.exitCode = 1;";
    const manager = new ExecutionManager({
      resolveRuntime: async () => ({ exePath: nodeExe, version: 'test' }),
      recordRun: appendHistory,
      emit: (event) => emitted.push(event)
    });
    const response = await manager.start({ workspaceId, relPath: 'fail.js', content, timeoutMs: 5000 });
    expect(response.ok).toBe(true);
    await expect.poll(() => emitted.some((event) => event.type === 'exit'), { timeout: 10_000 }).toBe(true);
    const output = emitted.filter((event) => event.type === 'stderr' || event.type === 'exit');
    expect(output.map((event) => event.type === 'exit' ? 'exit' : event.data)).toEqual(['first\n', 'last', 'exit']);
    expect(await readHistory(workspaceId)).toMatchObject([{ contentSnapshot: content, status: 'crashed', exitCode: 1 }]);
  });

  it('runs the demo TS program producing console output and captured values', async () => {
    const emitted: RunEvent[] = [];
    const manager = new ExecutionManager({
      resolveRuntime: () => Promise.resolve({ exePath: nodeExe, version: 'test' }),
      createRunner: () => new ProcessRunner(),
      emit: (e) => emitted.push(e)
    });

    const response = await manager.start({
      workspaceId: 'default',
      relPath: 'entry.ts',
      content: DEMO_TS,
      timeoutMs: 10000
    });
    expect(response.ok).toBe(true);
    if (!response.ok) return;

    // Wait for the run to finish via the manager's own single-flight state.
    for (let i = 0; i < 200 && manager.activeRunId('default') !== null; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(manager.activeRunId('default')).toBeNull();

    const stdoutText = emitted
      .filter((e) => e.type === 'stdout')
      .map((e) => ('data' in e ? e.data : ''))
      .join('');
    expect(stdoutText).toContain('active users: 1');

    // ResultCapture reported bindings and top-level expressions:
    // idx0 users, idx1 active, idx2 sum(40,2); console has its own frame.
    const results = emitted.filter((e) => e.type === 'result');
    expect(results.length).toBeGreaterThanOrEqual(3);
    const sumReport = results.find((e) => e.type === 'result' && e.index === 2);
    if (sumReport === undefined || sumReport.type !== 'result') {
      throw new Error('missing sum(40,2) capture at index 2');
    }
    expect(sumReport.value.t).toBe('number');
    expect(sumReport.value.prim).toBe('42');
  });
});
