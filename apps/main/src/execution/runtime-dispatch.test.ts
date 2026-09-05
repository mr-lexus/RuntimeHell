/**
 * Runtime-switching dispatch unit tests: ExecutionManager routes by
 * `req.runtimeId` — per-runtime resolver invocation, run args, report
 * transport, prelude injection, and runtime-naming error messages. All
 * against a FAKE runner; no real processes spawn here.
 */
import { promises as fs } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { RunEvent, RunResult } from '@rh/protocol';
import { ExecutionManager } from './execution-manager.js';
import type { ProcessRunner, RunHandle, RunOptions } from './process-runner.js';
import type { BrowserRuntimeRunner } from '../runtimes/browser/browser-runtime.js';
import { workspaceRoot } from '../workspace/files.js';

let homeBackup: string | undefined;
let posixHomeBackup: string | undefined;
let sandbox: string;

beforeAll(() => {
  // Redirect workspace writes (USERPROFILE drives workspaceRoot).
  homeBackup = process.env['USERPROFILE'];
  posixHomeBackup = process.env['HOME'];
  return mkdtemp(join(tmpdir(), 'rh-dispatch-')).then((dir) => {
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
    return { runId, pid: 424242, result, cancel: () => Promise.resolve() };
  }
}

type Resolver = (runtimeId: 'node' | 'deno' | 'bun' | 'browser', requestedVersion?: string) => Promise<{ exePath: string; version: string } | null>;

function makeManager(resolver: Resolver) {
  const runner = new FakeRunner();
  const emitted: RunEvent[] = [];
  const manager = new ExecutionManager({
    createRunner: () => runner as unknown as ProcessRunner,
    resolveRuntime: resolver,
    emit: (e) => emitted.push(e)
  });
  return { manager, runner, emitted };
}

const NODE = { exePath: 'C:/node/node.exe', version: '24.18.0' };
const DENO = { exePath: 'C:/deno/deno.exe', version: '2.3.4' };
const BUN = { exePath: 'C:/bun/bun.exe', version: '1.3.14' };
const BROWSER = { exePath: 'C:/electron/electron.exe', version: '13.5.0' };

const REQ = {
  workspaceId: 'default',
  relPath: 'entry.ts',
  content: 'const x = 1 + 1;\nconsole.log(x);\n',
  timeoutMs: 5000
};

describe('ExecutionManager runtime dispatch', () => {
  it('defaults to the node lane: resolver called with (node, undefined) and --require args', async () => {
    const resolver = vi.fn<Resolver>(async () => NODE);
    const { manager, runner } = makeManager(resolver);
    const response = await manager.start(REQ);
    expect(response.ok).toBe(true);

    expect(resolver).toHaveBeenCalledWith('node', undefined);
    const opts = runner.handles[0];
    expect(opts?.exePath).toBe(NODE.exePath);
    expect(opts?.args?.[0]).toBe('--require');
    expect(String(opts?.args?.[2])).toContain('.rhbuild');
    expect(opts?.reportTransport).toBeDefined();
  });

  it('dispatches deno: resolver gets (deno, undefined), args are [run, entry], stderr-only transport', async () => {
    const resolver = vi.fn<Resolver>(async () => DENO);
    const { manager, runner } = makeManager(resolver);
    const response = await manager.start({ ...REQ, runtimeId: 'deno' });
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(response.runtimeVersion).toBe('2.3.4');

    expect(resolver).toHaveBeenCalledWith('deno', undefined);
    const opts = runner.handles[0];
    expect(opts?.exePath).toBe(DENO.exePath);
    expect(opts?.args).toEqual(['run', expect.stringContaining('.rhbuild')]);
    // fd3 is Node-only: deno/bun must never open it.
    expect(opts?.reportTransport).toBe('stderr');
  });

  it('dispatches bun with requestedVersion forwarded', async () => {
    const resolver = vi.fn<Resolver>(async () => BUN);
    const { manager, runner } = makeManager(resolver);
    const response = await manager.start({ ...REQ, runtimeId: 'bun', runtimeVersion: '1.3.14' });
    expect(response.ok).toBe(true);

    expect(resolver).toHaveBeenCalledWith('bun', '1.3.14');
    const opts = runner.handles[0];
    expect(opts?.exePath).toBe(BUN.exePath);
    expect(opts?.args?.[0]).toBe('run');
    expect(opts?.reportTransport).toBe('stderr');
  });

  it('dispatches browser to the embedded runner without a Node bootstrap or Deno/Bun prelude', async () => {
    const resolver = vi.fn<Resolver>(async () => BROWSER);
    const runner = new FakeRunner();
    const manager = new ExecutionManager({
      resolveRuntime: resolver,
      createRunner: () => new FakeRunner() as unknown as ProcessRunner,
      createBrowserRunner: () => runner as unknown as BrowserRuntimeRunner,
      emit: () => undefined
    });
    const response = await manager.start({ ...REQ, runtimeId: 'browser' });
    expect(response).toMatchObject({ ok: true, runtimeVersion: BROWSER.version });
    expect(resolver).toHaveBeenCalledWith('browser', undefined);
    expect(runner.handles[0]?.args).toEqual(['run', expect.stringContaining('.rhbuild')]);
    expect(runner.handles[0]?.reportTransport).toBe('stderr');
    const entry = await readFile(join(workspaceRoot('default'), '.rhbuild', 'entry.cjs'), 'utf8');
    expect(entry).not.toContain('Runtime-agnostic result-capture prelude');
    expect(entry).toContain('__rh.console');
  });

  it('bundles a workspace CommonJS dependency before sending browser code to Chromium', async () => {
    const resolver = vi.fn<Resolver>(async () => BROWSER);
    const runner = new FakeRunner();
    const manager = new ExecutionManager({
      resolveRuntime: resolver,
      createRunner: () => new FakeRunner() as unknown as ProcessRunner,
      createBrowserRunner: () => runner as unknown as BrowserRuntimeRunner,
      emit: () => undefined
    });
    const workspaceId = `browser-package-${Date.now()}`;
    const root = workspaceRoot(workspaceId);
    const packageDir = join(root, 'node_modules', 'fixture-equal');
    await fs.mkdir(packageDir, { recursive: true });
    await fs.writeFile(join(packageDir, 'package.json'), JSON.stringify({ name: 'fixture-equal', main: 'index.js' }), 'utf8');
    await fs.writeFile(join(packageDir, 'index.js'), 'module.exports = (a, b) => JSON.stringify(a) === JSON.stringify(b);', 'utf8');
    try {
      const response = await manager.start({ ...REQ, workspaceId, relPath: 'app.js', content: "var equal = require('fixture-equal'); console.log(equal({ foo: 'bar' }, { foo: 'bar' }));", runtimeId: 'browser' });
      expect(response.ok).toBe(true);
      const entry = await readFile(join(root, '.rhbuild', 'app.js'), 'utf8');
      expect(entry).not.toContain("require('fixture-equal')");
      expect(entry).toContain('module.exports');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('prepends the capture prelude to the transpiled entry for deno', async () => {
    const resolver = vi.fn<Resolver>(async () => DENO);
    const { manager } = makeManager(resolver);
    const response = await manager.start({ ...REQ, runtimeId: 'deno' });
    expect(response.ok).toBe(true);

    const entry = await readFile(join(workspaceRoot('default'), '.rhbuild', 'entry.cjs'), 'utf8');
    expect(entry).toContain('Runtime-agnostic result-capture prelude');
    expect(entry).toContain('__rh');
    // The authored program must still be present after the prelude.
    expect(entry).toContain('const x = 1 + 1');
  });

  it('prepends the prelude to passthrough JS entries for bun', async () => {
    const resolver = vi.fn<Resolver>(async () => BUN);
    const { manager } = makeManager(resolver);
    const response = await manager.start({ ...REQ, relPath: 'app.js', runtimeId: 'bun' });
    expect(response.ok).toBe(true);

    const entry = await readFile(join(workspaceRoot('default'), '.rhbuild', 'app.js'), 'utf8');
    expect(entry).toContain('Runtime-agnostic result-capture prelude');
    // Console capture transform replaces the call — the prelude must define
    // the __rh handler the transformed program calls.
    expect(entry).toContain('__rh.console');
  });

  it('names the runtime in the unavailable message', async () => {
    const resolver = vi.fn<Resolver>(async () => null);
    const { manager, runner } = makeManager(resolver);

    const deno = await manager.start({ ...REQ, runtimeId: 'deno' });
    expect(deno).toMatchObject({ ok: false, stage: 'runtime' });
    if (!deno.ok) expect(deno.message).toContain('no Deno runtime found');

    const bun = await manager.start({ ...REQ, runtimeId: 'bun' });
    expect(bun).toMatchObject({ ok: false, stage: 'runtime' });
    if (!bun.ok) expect(bun.message).toContain('no Bun runtime found');

    const node = await manager.start(REQ);
    expect(node).toMatchObject({ ok: false, stage: 'runtime' });
    if (!node.ok) expect(node.message).toContain('no Node.js runtime found');

    expect(runner.handles.length).toBe(0);
  });

  it('keeps the node lane free of the prelude banner', async () => {
    const resolver = vi.fn<Resolver>(async () => NODE);
    const { manager } = makeManager(resolver);
    const response = await manager.start(REQ);
    expect(response.ok).toBe(true);

    const entry = await readFile(join(workspaceRoot('default'), '.rhbuild', 'entry.cjs'), 'utf8');
    expect(entry).not.toContain('Runtime-agnostic result-capture prelude');
  });
});
