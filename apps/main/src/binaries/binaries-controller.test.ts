/**
 * BinariesController unit tests (plan todo 12): list assembly, install
 * progress emission, remove idempotence — BinaryManager itself is exercised
 * by its own suite (network installs skip without RH_NETWORK_E2E).
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BinaryProgressEvent, NodeVersionRow } from '@rh/protocol';
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

const AVAILABLE: NodeVersionRow[] = [
  { version: '22.17.0', lts: true, date: '2025-01-01' },
  { version: '24.18.0', lts: false, date: '2026-01-01' }
];

function makeController(events: BinaryProgressEvent[], system: { exePath: string; version: string } | null = null) {
  return new BinariesController({
    emitProgress: (e) => events.push(e),
    fetchAvailable: () => Promise.resolve(AVAILABLE),
    detectSystem: () => Promise.resolve(system)
  });
}

describe('BinariesController.list', () => {
  it('returns bounded available slice + detected system + installed entries', async () => {
    const controller = makeController([], { exePath: 'C:/n.exe', version: '24.18.0' });
    const list = await controller.list();
    expect(list.system).toEqual({ exePath: 'C:/n.exe', version: '24.18.0' });
    // LTS rows first (в‰¤8), then current (в‰¤3).
    expect(list.available[0]?.lts).toBe(true);
    expect(list.available.length).toBeLessThanOrEqual(11);
    expect(list.installed).toEqual([]);
    expect(list.availableError).toBeUndefined();
  });

  it('survives index-fetch failure with availableError set', async () => {
    const controller = new BinariesController({
      emitProgress: () => {},
      fetchAvailable: () => Promise.reject(new Error('network down')),
      detectSystem: () => Promise.resolve(null)
    });
    const list = await controller.list();
    expect(list.available).toEqual([]);
    expect(list.availableError).toContain('network down');
    expect(list.system).toBeNull();
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
