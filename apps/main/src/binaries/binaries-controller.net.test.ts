/**
 * BinariesController network integration (plan todo 12 QA happy).
 * Gated by RH_NET_TESTS=1 so clean CI machines skip; dev machines prove
 * reality: real nodejs.org download → sha verify → install → spawn → remove.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BinaryProgressEvent } from '@rh/protocol';
import { BinariesController } from './binaries-controller.js';

const RUN = process.env['RH_NET_TESTS'] === '1';
const execFileP = promisify(execFile);

let dir = '';

beforeAll(() => {
  return mkdtemp(join(tmpdir(), 'rh-binc-net-')).then((d) => {
    dir = d;
    process.env['RH_CACHE_ROOT'] = d;
  });
});

afterAll(async () => {
  delete process.env['RH_CACHE_ROOT'];
  if (dir !== '') await rm(dir, { recursive: true, force: true });
});

describe.skipIf(!RUN)('runtimes panel install cycle (network)', () => {
  // Pinned LTS for reproducibility (plan t12 example).
  const VERSION = process.env['RH_NET_NODE_VERSION'] ?? 'v22.17.0';

  it('installs a real pinned LTS with progress, spawns it, then removes it', async () => {
    const events: BinaryProgressEvent[] = [];
    const controller = new BinariesController({ emitProgress: (e) => events.push(e) });

    const list = await controller.list();
    expect(list.system === null || typeof list.system.version === 'string').toBe(true);
    expect(list.available.length).toBeGreaterThan(0);

    const install = await controller.install('runtime', 'node', VERSION);
    expect(install.ok).toBe(true);
    if (!install.ok) return;

    expect(events.some((e) => e.receivedBytes > 1_000_000)).toBe(true); // real bytes flowed
    expect(events.at(-1)?.done).toBe(true);

    const exe = join(install.entry.installedPath ?? '', 'node.exe');
    const { stdout } = await execFileP(exe, ['--version']);
    expect(stdout.trim()).toBe(VERSION);

    const removed = await controller.remove('runtime', 'node', VERSION.replace(/^v/, ''));
    expect(removed.ok).toBe(true);

    const afterRemove = await controller.list();
    expect(afterRemove.installed.some((e) => e.version === VERSION.replace(/^v/, ''))).toBe(false);
  }, 300_000);
});
