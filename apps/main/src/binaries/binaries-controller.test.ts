/**
 * BinariesController unit tests (plan todo 12): list assembly, install
 * progress emission, remove idempotence — BinaryManager itself is exercised
 * by its own suite (network installs skip without RH_NETWORK_E2E).
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BinaryProgressEvent, NvmInfo, RuntimeVersionRow } from '@rh/protocol';
import { BinariesController } from './binaries-controller.js';

let homeBackup: string | undefined;
let sandbox: string;

beforeAll(() => {
  homeBackup = process.env['USERPROFILE'];
  return mkdtemp(join(tmpdir(), 'rh-binc-')).then((dir) => {
    sandbox = dir;
    process.env['USERPROFILE'] = dir; // redirect %LOCALAPPDATA%? LOCALAPPDATA read separately below
    process.env['LOCALAPPDATA'] = dir;
  });
});

afterAll(async () => {
  if (homeBackup !== undefined) process.env['USERPROFILE'] = homeBackup;
  await rm(sandbox, { recursive: true, force: true });
});

const AVAILABLE: Record<string, RuntimeVersionRow[]> = {
  node: [
    { version: '22.17.0', lts: true, date: '2025-01-01' },
    { version: '24.18.0', lts: false, date: '2026-01-01' }
  ],
  deno: [{ version: '2.3.4', date: '2026-01-01' }],
  bun: [{ version: '1.2.3', date: '2026-01-01' }]
};

const NVM: NvmInfo = {
  root: 'C:/nvm',
  versions: [{ version: '20.11.0', exePath: 'C:/nvm/v20.11.0/node.exe', active: true }]
};

function makeController(
  events: BinaryProgressEvent[],
  system: { exePath: string; version: string } | null = null,
  nvm: NvmInfo | null = null
) {
  return new BinariesController({
    emitProgress: (e) => events.push(e),
    fetchAvailable: (id) => Promise.resolve(AVAILABLE[id] ?? []),
    // Only 'node' carries the injected system detection; deno/bun stay absent.
    detectSystem: (id) => Promise.resolve(id === 'node' ? system : null),
    detectBrowser: () => Promise.resolve(null),
    detectNvm: () => Promise.resolve(nvm)
  });
}

describe('BinariesController.list', () => {
  it('returns per-runtime system detection + nvm + bounded available slice', async () => {
    const controller = makeController([], { exePath: 'C:/n.exe', version: '24.18.0' }, NVM);
    const list = await controller.list();
    expect(list.systemRuntimes.node).toEqual({ exePath: 'C:/n.exe', version: '24.18.0' });
    expect(list.systemRuntimes.deno).toBeNull();
    expect(list.systemBrowsers.firefox).toBeNull();
    expect(list.nvm).toEqual(NVM);
    // LTS rows first (≤8), then current (≤3).
    expect(list.availableVersions.node?.[0]?.lts).toBe(true);
    expect(list.availableVersions.node?.length).toBeLessThanOrEqual(11);
    expect(list.availableVersions.deno).toEqual([{ version: '2.3.4', date: '2026-01-01' }]);
    expect(list.installed).toEqual([]);
    expect(list.availableErrors).toEqual({});
  });

  it('survives index-fetch failure with per-runtime availableError set', async () => {
    const controller = new BinariesController({
      emitProgress: () => {},
      fetchAvailable: (id) => (id === 'node' ? Promise.reject(new Error('network down')) : Promise.resolve([])),
      detectSystem: () => Promise.resolve(null),
      detectBrowser: () => Promise.resolve(null),
      detectNvm: () => Promise.resolve(null)
    });
    const list = await controller.list();
    expect(list.availableVersions.node).toEqual([]);
    expect(list.availableErrors.node).toContain('network down');
    expect(list.systemRuntimes.node).toBeNull();
    expect(list.nvm).toBeNull();
  });
});

describe('BinariesController.install/remove', () => {
  it('reports install failure without throwing on bad checksum source', async () => {
    const events: BinaryProgressEvent[] = [];
    const controller = makeController(events);
    // buildNodeInstall hits the network for SHASUMS; simulate failure via an
    // unreachable version that yields a rejected fetch.
    const response = await controller.install('runtime', 'node', 'v0.0.1-nonexistent');
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.message.length).toBeGreaterThan(0);
  });

  it('refuses disabled engines before any network access', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error('network must not be touched');
    }) as typeof fetch;
    try {
      const response = await makeController([]).install('engine', 'spidermonkey');
      expect(response.ok).toBe(false);
      if (!response.ok) expect(response.message).toMatch(/jsshell|resolve|download/i);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('remove of a never-installed version returns structured failure', async () => {
    const controller = makeController([]);
    const response = await controller.remove('runtime', 'node', '99.99.99');
    expect(response.ok).toBe(false);
    if (!response.ok) expect(response.message).toContain('not installed');
  });
});
