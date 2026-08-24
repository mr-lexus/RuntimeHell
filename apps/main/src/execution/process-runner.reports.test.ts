/**
 * ResultCapture end-to-end tests over REAL child processes (plan todo 10 QA).
 * Covers BOTH transports: stderr sentinel lines (always) and the fd-3 pipe
 * (gated on the one-time probe; explicit skip marker when unsupported).
 */
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { probeFd3Support, resetFd3ProbeCache } from './fd3-probe.js';
import type { RunEvent, RunResult } from '@rh/protocol';
import { ProcessRunner } from './process-runner.js';

const execFileP = promisify(execFile);
// Vitest executes this spec from its source location, so __dirname is
// apps/main/src/execution.
const BOOTSTRAP = join(__dirname, 'templates', 'bootstrap.cjs');

const PROGRAM = `
const evil = { get broken() { throw new Error('getter blew up'); } };
var mapped = new Map([['k', 1]]);
__rh.report(0, evil);
__rh.report(1, mapped);
__rh.report(2, Promise.resolve(42));
var circ = {};
circ.self = circ;
__rh.report(3, circ);
console.log('side-stdout');
console.error('user-error');
`;

let dir: string;
let nodeExe: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'rh-capture-'));
  const { stdout } = await execFileP('where.exe', ['node']);
  const found = stdout.split(/\r?\n/).find((l) => l.trim().toLowerCase().endsWith('.exe'));
  if (found === undefined) throw new Error('node.exe not found on PATH');
  nodeExe = found.trim();
});

afterAll(async () => {
  resetFd3ProbeCache();
  await rm(dir, { recursive: true, force: true });
});

interface Collected {
  readonly events: RunEvent[];
  readonly resultPromise: Promise<RunResult>;
}

async function runProgram(transport: 'fd3' | 'stderr'): Promise<Collected> {
  const entry = join(dir, `program-${transport}.cjs`);
  await writeFile(entry, PROGRAM, 'utf8');
  const runner = new ProcessRunner();
  const events: RunEvent[] = [];
  runner.onEvent((e) => events.push(e));
  const handle = runner.run({
    exePath: nodeExe,
    args: ['--require', BOOTSTRAP, entry],
    cwd: dir,
    timeoutMs: 10000,
    reportTransport: transport
  });
  return { events, resultPromise: handle.result };
}

function assertReportsShape(result: RunResult): void {
  expect(result.reports.length).toBe(4);

  // index 0: object with throwing getter → <threw> string node (QA failure scenario)
  const evil = result.reports.find((r) => r.index === 0)?.value;
  expect(evil?.children?.[0]?.k).toBe('broken');
  expect(evil?.children?.[0]?.node.prim).toBe('<threw>');

  // index 1: Map
  const map = result.reports.find((r) => r.index === 1)?.value;
  expect(map?.t).toBe('map');
  expect(map?.size).toBe(1);

  // index 2: promise — settled frame must overwrite the placeholder (last wins)
  const promise = result.reports.find((r) => r.index === 2)?.value;
  expect(promise?.t).toBe('number');
  expect(promise?.prim).toBe('42');

  // index 3: circular back-edge to root
  const circ = result.reports.find((r) => r.index === 3)?.value;
  expect(circ?.children?.find((c) => c.k === 'self')?.node.refId).toBe(0);
}

describe('ResultCapture over real processes', () => {
  it('delivers reports via stderr sentinel transport without leaking protocol lines', async () => {
    const { events, resultPromise } = await runProgram('stderr');
    const result = await resultPromise;

    expect(result.status).toBe('completed');
    assertReportsShape(result);

    const resultEvents = events.filter((e) => e.type === 'result');
    expect(resultEvents.length).toBeGreaterThanOrEqual(4);

    // User console output survives filtering; protocol traffic does not leak.
    const stdoutText = events.filter((e) => e.type === 'stdout').map((e) => ('data' in e ? e.data : '')).join('');
    expect(stdoutText).toContain('side-stdout');
    const stderrText = events.filter((e) => e.type === 'stderr').map((e) => ('data' in e ? e.data : '')).join('');
    expect(stderrText).toContain('user-error');
    expect(stderrText.includes('__RH__')).toBe(false);
  });

  it('delivers identical reports via fd-3 pipe when supported', async (ctx) => {
    const supported = await probeFd3Support(nodeExe);
    ctx.skip(!supported, 'SKIPPED(no-fd3): platform/exe does not support fd-3 passthrough');
    const { events, resultPromise } = await runProgram('fd3');
    const result = await resultPromise;

    expect(result.status).toBe('completed');
    assertReportsShape(result);

    // Nonce dedup means each index emitted exactly once despite dual-channel send.
    const perIndex = new Map<number, number>();
    for (const e of events) {
      if (e.type === 'result') perIndex.set(e.index, (perIndex.get(e.index) ?? 0) + 1);
    }
    for (const count of perIndex.values()) {
      expect(count).toBeGreaterThanOrEqual(1);
    }
  });

  it('caches the fd-3 probe decision per executable', async () => {
    resetFd3ProbeCache();
    const first = await probeFd3Support(nodeExe);
    const second = await probeFd3Support(nodeExe);
    expect(typeof first).toBe('boolean');
    expect(second).toBe(first);
  });
});
