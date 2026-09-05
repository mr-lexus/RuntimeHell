/**
 * Runtime resolution-order unit tests (plan todo 12).
 * Explicit selections pin managed/nvm/system; auto prefers global and falls
 * back to the newest managed sandbox version.
 */
import { describe, expect, it } from 'vitest';
import type { ManifestEntry, NvmInfo } from '@rh/protocol';
import { installedNodeVersions, resolveRuntimeChoice } from './runtime-resolver.js';
import { executableName } from '../platform.js';

function managedEntry(version: string): ManifestEntry {
  return {
    kind: 'runtime',
    id: 'node',
    platform: 'win64',
    arch: 'x64',
    version,
    url: `https://nodejs.org/dist/v${version}/node-v${version}-win-x64.zip`,
    sha256: 'a'.repeat(64),
    license: 'MIT',
    source: 'official-dist',
    installedPath: `C:/cache/runtimes/node/${version}`,
    addedAt: new Date().toISOString(),
    customBuildRequired: false
  };
}

const SYSTEM = { exePath: 'C:/Windows/system-node.exe', version: '24.18.0' };

const NVM: NvmInfo = {
  root: 'C:/nvm',
  versions: [
    { version: '20.11.0', exePath: 'C:/nvm/v20.11.0/node.exe', active: false },
    { version: '22.17.0', exePath: 'C:/nvm/v22.17.0/node.exe', active: true }
  ]
};

describe('resolveRuntimeChoice', () => {
  const normalize = (p: string): string => p.replace(/\\/g, '/');

  it('prefers the requested managed version over system', () => {
    const choice = resolveRuntimeChoice('22.17.0', [managedEntry('22.17.0')], SYSTEM, null);
    if (choice.kind !== 'managed') throw new Error(`expected managed, got ${choice.kind}`);
    expect(choice.version).toBe('22.17.0');
    // join() yields platform separators; compare normalized.
    expect(normalize(choice.exePath)).toBe(`C:/cache/runtimes/node/22.17.0/${executableName('node')}`);
  });

  it('falls back to system when the requested version is not installed', () => {
    const choice = resolveRuntimeChoice('99.0.0', [managedEntry('22.17.0')], SYSTEM, null);
    expect(choice).toEqual({ kind: 'system', exePath: SYSTEM.exePath, version: SYSTEM.version });
  });

  it('uses system when nothing is requested and no nvm is present', () => {
    expect(resolveRuntimeChoice(undefined, [managedEntry('22.17.0')], SYSTEM, null)).toMatchObject({ kind: 'system' });
    expect(resolveRuntimeChoice('', [], SYSTEM, null)).toMatchObject({ kind: 'system' });
  });

  it('supports an explicit global system selection', () => {
    expect(resolveRuntimeChoice('system', [managedEntry('22.17.0')], SYSTEM, NVM)).toEqual({
      kind: 'system',
      exePath: SYSTEM.exePath,
      version: SYSTEM.version
    });
  });

  it('falls back to the newest managed sandbox version without a global runtime', () => {
    const choice = resolveRuntimeChoice(undefined, [managedEntry('20.11.0'), managedEntry('22.17.0')], null, null);
    expect(choice.kind).toBe('managed');
    if (choice.kind === 'managed') expect(choice.version).toBe('22.17.0');
  });

  it('returns none when neither managed, nvm, nor system exists', () => {
    expect(resolveRuntimeChoice(undefined, [], null, null)).toEqual({ kind: 'none' });
    expect(resolveRuntimeChoice('22.17.0', [], null, null)).toEqual({ kind: 'none' });
  });

  it('ignores manifest rows without an installedPath (partial installs)', () => {
    const partial = { ...managedEntry('20.0.0'), installedPath: undefined };
    const choice = resolveRuntimeChoice('20.0.0', [partial], null, null);
    expect(choice).toEqual({ kind: 'none' });
  });

  it('sorts newest-first for display', () => {
    expect(installedNodeVersions([managedEntry('20.11.0'), managedEntry('22.17.0')])).toEqual(['22.17.0', '20.11.0']);
  });

  // --- native nvm integration ---------------------------------------------

  it('resolves an explicit nvm: selection to the nvm executable', () => {
    const choice = resolveRuntimeChoice('nvm:20.11.0', [], SYSTEM, NVM);
    expect(choice).toEqual({ kind: 'nvm', exePath: 'C:/nvm/v20.11.0/node.exe', version: '20.11.0' });
  });

  it('falls back to system when the nvm: selection is not installed', () => {
    const choice = resolveRuntimeChoice('nvm:99.0.0', [], SYSTEM, NVM);
    expect(choice).toEqual({ kind: 'system', exePath: SYSTEM.exePath, version: SYSTEM.version });
  });

  it('prefers the nvm-active version over system when nothing is requested', () => {
    const choice = resolveRuntimeChoice(undefined, [], SYSTEM, NVM);
    expect(choice).toEqual({ kind: 'nvm', exePath: 'C:/nvm/v22.17.0/node.exe', version: '22.17.0' });
  });

  it('falls back to a plain version in nvm when the managed install vanished', () => {
    const choice = resolveRuntimeChoice('20.11.0', [], SYSTEM, NVM);
    expect(choice).toEqual({ kind: 'nvm', exePath: 'C:/nvm/v20.11.0/node.exe', version: '20.11.0' });
  });

  it('prefers managed over nvm for the same plain version', () => {
    const choice = resolveRuntimeChoice('22.17.0', [managedEntry('22.17.0')], SYSTEM, NVM);
    expect(choice.kind).toBe('managed');
  });
});
