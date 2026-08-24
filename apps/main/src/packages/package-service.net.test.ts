/**
 * PackageService network integration (plan todo 13 QA happy).
 * Gated by RH_NET_TESTS=1. Real npm install/uninstall inside a sandbox
 * workspace; verifies package.json mutation and node_modules presence.
 */
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PkgEvent } from '@rh/protocol';
import { PackageService } from './package-service.js';

const RUN = process.env['RH_NET_TESTS'] === '1';

let homeBackup: string | undefined;
let sandbox = '';

beforeAll(() => {
  homeBackup = process.env['USERPROFILE'];
  return mkdtemp(join(tmpdir(), 'rh-pkg-net-')).then((dir) => {
    sandbox = dir;
    process.env['USERPROFILE'] = dir;
  });
});

afterAll(async () => {
  if (homeBackup !== undefined) process.env['USERPROFILE'] = homeBackup;
  await rm(sandbox, { recursive: true, force: true });
});

describe.skipIf(!RUN)('workspace npm cycle (network)', () => {
  const events: PkgEvent[] = [];
  // Tiny, stable package for fast deterministic evidence.
  const service = new PackageService({ emit: (e) => events.push(e) });

  it('installs a real package into the workspace', async () => {
    const response = await service.install('default', 'left-pad', '1.3.0', true);
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    // npm's default save prefix applies (^1.3.0).
    expect(response.dependencies['left-pad']).toBe('^1.3.0');

    const root = join(sandbox, 'RuntimeHell', 'workspaces', 'default');
    await access(join(root, 'node_modules', 'left-pad'));
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> };
    expect(pkg.dependencies?.['left-pad']).toBe('^1.3.0');

    // Failure scenario (plan): nonexistent package → verbatim stderr surfaced,
    // package.json unchanged.
    const before = await readFile(join(root, 'package.json'), 'utf8');
    const failed = await service.install('default', '@rh/nope-xyz-404', undefined, true);
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.stderrTail).toContain('404');
    const after = await readFile(join(root, 'package.json'), 'utf8');
    expect(after).toBe(before);

    const removed = await service.uninstall('default', 'left-pad', true);
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.dependencies['left-pad']).toBeUndefined();

    // Success path streamed real npm stdout through the sink.
    expect(events.some((e) => e.stream === 'stdout' && e.text.includes('added 1 package'))).toBe(true);
  }, 120_000);
});
