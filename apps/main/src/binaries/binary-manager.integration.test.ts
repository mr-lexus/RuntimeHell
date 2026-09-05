/**
 * Integration test (plan todo 7 QA): REAL download of a pinned Node LTS zip
 * from nodejs.org, sha256 verification against SHASUMS256.txt, atomic extract,
 * spawn of the downloaded exe, then removal.
 *
 * Gated by RH_NET_TESTS=1 so clean CI machines skip; dev machines prove reality.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ManifestEntry } from '@rh/protocol';
import {
  installArtifact,
  readManifest,
  removeEntry,
  targetDirFor
} from './binary-manager.js';
import { buildNodeInstall } from '../runtimes/node/node-runtime.js';
import { executableName } from '../platform.js';

const execFileP = promisify(execFile);
const RUN = process.env['RH_NET_TESTS'] === '1';
const NODE_VERSION = '22.17.0';

let dir: string;
let installed: ManifestEntry | null = null;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'rh-net-'));
  process.env['RH_CACHE_ROOT'] = dir;
});

afterAll(async () => {
  delete process.env['RH_CACHE_ROOT'];
  await rm(dir, { recursive: true, force: true });
});

describe.skipIf(!RUN)('node runtime install (network)', () => {
  it('downloads, verifies, extracts, spawns and removes a real Node LTS', async () => {
    const built = await buildNodeInstall(NODE_VERSION);
    expect(built.sha256).toMatch(/^[a-f0-9]{64}$/);

    let lastProgress = { received: 0, total: null as number | null };
    const entry = await installArtifact({
      entry: built.entry,
      source: { url: built.url, sha256: built.sha256 },
      archive: built.archive,
      onProgress: (p) => {
        lastProgress = { received: p.receivedBytes, total: p.totalBytes };
      }
    });
    installed = entry;

    expect(entry.installedPath).toBeTruthy();
    expect(lastProgress.received).toBeGreaterThan(10_000_000); // ~30MB zip

    // Spawn the downloaded binary for real.
    const exe = join(targetDirFor(entry), executableName('node'));
    const { stdout } = await execFileP(exe, ['--version']);
    expect(stdout.trim()).toBe(`v${NODE_VERSION}`);

    // Manifest reflects the install.
    const manifest = await readManifest();
    expect(manifest.entries.some((e) => e.kind === 'runtime' && e.id === 'node' && e.version === NODE_VERSION)).toBe(true);

    // Removal deletes the dir + manifest row.
    await removeEntry('runtime', 'node', NODE_VERSION);
    const after = await readManifest();
    expect(after.entries.some((e) => e.id === 'node' && e.version === NODE_VERSION)).toBe(false);
    installed = null;
  }, 300000);

  it('rejects corrupted downloads (sha mismatch) without mutating the manifest', async () => {
    const built = await buildNodeInstall(NODE_VERSION);
    const bad = { ...built, sha256: 'f'.repeat(64) };
    await expect(
      installArtifact({ entry: bad.entry, source: { url: bad.url, sha256: bad.sha256 } })
    ).rejects.toThrow(/sha256 mismatch/);
    const manifest = await readManifest();
    expect(manifest.entries.length).toBe(0);
  }, 300000);
});
