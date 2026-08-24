/**
 * PackageService unit tests (plan todo 13, D6 tests-after).
 * Pure logic with an injected CliRunner — no network, no real npm.
 * Real-CLI coverage lives in package-service.net.test.ts (RH_NET_TESTS=1).
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PkgEvent } from '@rh/protocol';
import { PackageService, resolveNpm, type CliRunner, type SpawnedCli } from './package-service.js';
import { managedRuntimeDir } from '../runtimes/runtime-resolver.js';

let homeBackup: string | undefined;
let sandbox = '';

beforeEach(async () => {
  homeBackup = process.env['USERPROFILE'];
  sandbox = await mkdtemp(join(tmpdir(), 'rh-pkg-unit-'));
  process.env['USERPROFILE'] = sandbox;
});

afterEach(async () => {
  if (homeBackup !== undefined) process.env['USERPROFILE'] = homeBackup;
  await rm(sandbox, { recursive: true, force: true });
});

describe('resolveNpm (D7 order)', () => {
  const npmCliRelative = join('node_modules', 'npm', 'bin', 'npm-cli.js');

  it('prefers the managed runtime: node.exe + bundled npm-cli.js, direct execution', async () => {
    const dir = managedRuntimeDir('22.17.0');
    const probe = vi.fn(async (p: string) => p === join(dir, 'node.exe') || p === join(dir, npmCliRelative));
    const result = await resolveNpm('22.17.0', probe, async () => join(sandbox, 'path-npm.cmd'));
    if (!('kind' in result) || result.kind !== 'direct') throw new Error('expected direct managed resolution');
    expect(result.origin).toBe('managed');
    expect(result.nodeExe).toBe(join(dir, 'node.exe'));
    expect(result.cliJs).toBe(join(dir, npmCliRelative));
  });

  it('falls back to PATH-derived sibling node + cli when managed is absent', async () => {
    const pathNpm = join(sandbox, 'path-npm.cmd');
    const result = await resolveNpm(null, async (p) => p.startsWith(sandbox), async () => pathNpm);
    if (!('kind' in result) || result.kind !== 'direct') throw new Error('expected direct path resolution');
    expect(result.origin).toBe('path');
    expect(result.nodeExe).toBe(join(sandbox, 'node.exe'));
  });

  it('degrades to shell fallback when only the .cmd shim exists', async () => {
    const result = await resolveNpm(null, async () => false, async () => join(sandbox, 'weird', 'npm.cmd'));
    if (!('kind' in result)) throw new Error('expected shell resolution');
    expect(result.kind).toBe('shell');
  });

  it('returns structured guidance when neither source resolves', async () => {
    const result = await resolveNpm('22.17.0', async () => false, async () => null);
    if (!('error' in result)) throw new Error('expected error variant');
    expect(result.error).toContain('npm not found');
    expect(result.error).toContain('Runtimes panel');
  });
});

describe('PackageService ops (fake CliRunner)', () => {
  const events: PkgEvent[] = [];
  const emit = (e: PkgEvent): void => {
    events.push(e);
  };

  /** Fake runner that "npm-installs" by writing package.json like the real CLI would. */
  const fakeRunner = (exitCode: number | null, stderr = ''): CliRunner =>
    (exe, args, cwd) => {
      void exe;
      if (exitCode === 0 && args[0] === 'install') {
        const spec = args[args.length - 1] ?? '';
        const at = spec.indexOf('@', spec[0] === '@' ? 1 : 0); // scoped names: @scope/pkg@ver
        const name = at === -1 ? spec : spec.slice(0, at);
        const ver = at === -1 ? 'latest' : spec.slice(at + 1);
        return Promise.resolve().then(async (): Promise<SpawnedCli> => {
          const pkgPath = join(cwd, 'package.json');
          const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as { dependencies?: Record<string, string> };
          pkg.dependencies = { ...(pkg.dependencies ?? {}), [name]: ver };
          await writeFile(pkgPath, JSON.stringify(pkg, null, 2), 'utf8');
          return { code: 0, stdout: `added 1 package in 40ms\n`, stderr: '' };
        });
      }
      if (exitCode === 0 && args[0] === 'uninstall') {
        return Promise.resolve().then(async (): Promise<SpawnedCli> => {
          const pkgPath = join(cwd, 'package.json');
          const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as { dependencies?: Record<string, string> };
          const target = args.at(-1) ?? '';
          delete (pkg.dependencies ?? {})[target];
          await writeFile(pkgPath, JSON.stringify(pkg, null, 2), 'utf8');
          return { code: 0, stdout: 'removed 1 package\n', stderr: '' };
        });
      }
      return Promise.resolve({ code: exitCode, stdout: '', stderr });
    };

  it('creates package.json {"private":true,"type":"commonjs"} on first dep op', async () => {
    const service = new PackageService({ emit });
    const response = await service.install('default', 'left-pad', '1.3.0', true, fakeRunner(0), null);
    expect(response.ok).toBe(true);
    const raw = JSON.parse(await readFile(join(sandbox, 'RuntimeHell', 'workspaces', 'default', 'package.json'), 'utf8'));
    expect(raw).toMatchObject({ private: true, type: 'commonjs' });
  });

  it('passes --ignore-scripts by default and streams stdout lines through emit', async () => {
    const seen: { exe: string; args: string[]; cwd: string }[] = [];
    const spyRunner: CliRunner = (exe, args, cwd, onLine) => {
      seen.push({ exe, args, cwd });
      onLine('stdout', 'added 1 package');
      return fakeRunner(0)(exe, args, cwd, onLine);
    };
    const service = new PackageService({ emit });
    const response = await service.install('default', 'lodash', '4.17.21', true, spyRunner, null);
    expect(response.ok).toBe(true);
    const first = seen[0];
    if (first === undefined) throw new Error('runner never invoked');
    expect(first.args).toContain('--ignore-scripts');
    expect(first.args).toContain('--no-audit');
    expect(first.args).toContain('lodash@4.17.21');
    expect(first.cwd).toBe(join(sandbox, 'RuntimeHell', 'workspaces', 'default'));
    expect(events.some((e) => e.stream === 'stdout' && e.text === 'added 1 package')).toBe(true);
  });

  it('omits --ignore-scripts when the setting is disabled', async () => {
    const calls: string[][] = [];
    const spyRunner: CliRunner = (exe, args, cwd, onLine) => {
      calls.push(args);
      return fakeRunner(0)(exe, args, cwd, onLine);
    };
    const service = new PackageService({ emit });
    await service.install('default', 'lodash', undefined, false, spyRunner, null);
    const args0 = calls[0];
    if (args0 === undefined) throw new Error('runner never invoked');
    expect(args0).not.toContain('--ignore-scripts');
    expect(args0).toContain('lodash'); // no range → bare name
  });

  it('surfaces failures as ok:false with a stderr tail, workspace json untouched', async () => {
    const service = new PackageService({ emit });
    const root = join(sandbox, 'RuntimeHell', 'workspaces', 'default');
    await service.install('default', 'lodash', '4.17.21', true, fakeRunner(0), null);
    const before = await readFile(join(root, 'package.json'), 'utf8');

    const failed = await service.install(
      'default',
      '@rh/nope-xyz-404',
      undefined,
      true,
      fakeRunner(1, 'npm error 404 Not Found - GET https://registry.npmjs.org/@rh%2fnope-xyz-404\n'),
      null
    );
    expect(failed.ok).toBe(false);
    if (failed.ok) throw new Error('expected failure');
    expect(failed.message).toContain('npm install failed');
    expect(failed.stderrTail).toContain('404 Not Found');
    expect(await readFile(join(root, 'package.json'), 'utf8')).toBe(before);
  });

  it('uninstall removes the dependency entry', async () => {
    const service = new PackageService({ emit });
    await service.install('default', 'zod', '3.23.8', true, fakeRunner(0), null);
    const removed = await service.uninstall('default', 'zod', true, fakeRunner(0), null);
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.dependencies['zod']).toBeUndefined();
  });

  it('list returns {} without crashing when package.json is absent', async () => {
    const service = new PackageService({ emit });
    const deps = await service.list('default');
    expect(deps).toEqual({});
  });
});
