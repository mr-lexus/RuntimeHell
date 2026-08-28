/**
 * Runtime switching integration (net test): the FULL composed path
 * (transform → esbuild → prelude → ProcessRunner) under the REAL Bun and
 * Deno executables when they are installed on this machine. Absent binaries
 * skip their lane with an explicit SKIPPED marker so clean CI stays green.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RunEvent } from '@rh/protocol';
import { ExecutionManager } from './execution-manager.js';
import { ProcessRunner } from './process-runner.js';

const execFileP = promisify(execFile);

let homeBackup: string | undefined;
let sandbox: string;
let denoExe: string | null = null;
let bunExe: string | null = null;

async function findExe(name: string): Promise<string | null> {
  try {
    const { stdout } = await execFileP('where.exe', [name]);
    const found = stdout.split(/\r?\n/).find((l) => l.trim().toLowerCase().endsWith('.exe'));
    return found !== undefined ? found.trim() : null;
  } catch {
    return null;
  }
}

beforeAll(async () => {
  [denoExe, bunExe] = await Promise.all([findExe('deno'), findExe('bun')]);
  if (denoExe === null) console.warn('[SKIPPED] deno.exe not found on PATH — Deno integration lane skipped');
  if (bunExe === null) console.warn('[SKIPPED] bun.exe not found on PATH — Bun integration lane skipped');

  homeBackup = process.env['USERPROFILE'];
  sandbox = await mkdtemp(join(tmpdir(), 'rh-switch-e2e-'));
  process.env['USERPROFILE'] = sandbox;
});

afterAll(async () => {
  if (homeBackup !== undefined) process.env['USERPROFILE'] = homeBackup;
  await rm(sandbox, { recursive: true, force: true });
});

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

async function runUnderRuntime(exePath: string, runtimeId: 'deno' | 'bun'): Promise<RunEvent[]> {
  const emitted: RunEvent[] = [];
  const manager = new ExecutionManager({
    resolveRuntime: () => Promise.resolve({ exePath, version: 'test' }),
    createRunner: () => new ProcessRunner(),
    emit: (e) => emitted.push(e)
  });

  const response = await manager.start({
    workspaceId: 'default',
    relPath: 'entry.ts',
    content: DEMO_TS,
    timeoutMs: 15000,
    runtimeId
  });
  expect(response.ok).toBe(true);
  if (!response.ok) return emitted;

  for (let i = 0; i < 300 && manager.activeRunId('default') !== null; i++) {
    await new Promise((r) => setTimeout(r, 50));
  }
  expect(manager.activeRunId('default')).toBeNull();
  return emitted;
}

function assertDemoCaptured(emitted: RunEvent[]): void {
  // Console output arrives as a console event (stderr sentinel), not stdout.
  const consoles = emitted.filter((e) => e.type === 'console');
  const text = consoles.map((e) => (e.type === 'console' ? e.text : '')).join(' ');
  expect(text).toContain('active users: 1');

  // ResultCapture: idx0 users, idx1 active, idx2 console call, idx3 sum(40,2).
  const results = emitted.filter((e) => e.type === 'result');
  expect(results.length).toBeGreaterThanOrEqual(4);
  const sumReport = results.find((e) => e.type === 'result' && e.index === 3);
  if (sumReport === undefined || sumReport.type !== 'result') {
    throw new Error('missing sum(40,2) capture at index 3');
  }
  expect(sumReport.value).toEqual({ t: 'number', prim: '42' });
}

/**
 * Runs one lane under the real runtime. Binary absence is checked INSIDE the
 * test (skipIf evaluates at collection time, before beforeAll detection) and
 * reported with an explicit SKIPPED marker so the run stays green on clean
 * machines.
 */
async function runLane(runtimeId: 'deno' | 'bun', exePath: string | null): Promise<void> {
  if (exePath === null) {
    console.warn(`[SKIPPED] ${runtimeId}.exe not found on PATH — ${runtimeId} integration lane skipped`);
    return;
  }
  const emitted = await runUnderRuntime(exePath, runtimeId);
  assertDemoCaptured(emitted);
}

describe('runtime switching (real runtimes when installed)', () => {
  it('runs the demo under real Bun with capture intact', async () => {
    await runLane('bun', bunExe);
  });

  it('runs the demo under real Deno with capture intact', async () => {
    await runLane('deno', denoExe);
  });
});
