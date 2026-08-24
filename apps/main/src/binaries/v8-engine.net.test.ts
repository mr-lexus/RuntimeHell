/**
 * V8 engine install network integration (plan todo 15 QA happy).
 * Gated by RH_NET_TESTS=1: real -latest.json discovery → real canary download
 * (record-mode sha) → d8-debug.exe --version executes → manifest row present.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const RUN = process.env['RH_NET_TESTS'] === '1';
const execFileP = promisify(execFile);

let dir = '';

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'rh-v8-net-'));
  process.env['RH_CACHE_ROOT'] = dir;
});

afterAll(() => {
  delete process.env['RH_CACHE_ROOT'];
  // Keep the downloaded binary for inspection on dev machines; CI temp cleans itself.
  void existsSync;
});

describe.skipIf(!RUN)('v8 canary install (network)', () => {
  it('discovers latest dbg, downloads, and executes d8 --version', async () => {
    const { fetchLatestV8Version, installEngine } = await import('./engine-downloader.js');
    const { readManifest } = await import('./binary-manager.js');

    const latest = await fetchLatestV8Version('dbg');
    expect(latest).toMatch(/^\d+\.\d+\.\d+/);

    const outcome = await installEngine({ engineId: 'd8-debug' });
    expect(outcome.entry.version).toBe(latest);
    expect(outcome.entry.sha256).toMatch(/^[a-f0-9]{64}$/); // recorded digest

    const exe = join(outcome.entry.installedPath ?? '', 'd8.exe');
    expect(existsSync(exe)).toBe(true);
    const { stdout } = await execFileP(exe, ['--version']);
    expect(stdout).toContain('V8 version');

    const manifest = await readManifest();
    expect(manifest.entries.some((e) => e.kind === 'engine' && e.id === 'd8-debug')).toBe(true);
  }, 600_000);
});
