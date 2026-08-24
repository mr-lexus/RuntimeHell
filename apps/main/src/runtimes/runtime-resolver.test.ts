/**
 * Runtime resolution-order unit tests (plan todo 12).
 * Displayed order: managed selected version → system installation → none.
 */
import { describe, expect, it } from 'vitest';
import type { ManifestEntry } from '@rh/protocol';
import { installedNodeVersions, resolveRuntimeChoice } from './runtime-resolver.js';

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

describe('resolveRuntimeChoice', () => {
  const normalize = (p: string): string => p.replace(/\\/g, '/');

  it('prefers the requested managed version over system', () => {
    const choice = resolveRuntimeChoice('22.17.0', [managedEntry('22.17.0')], SYSTEM);
    if (choice.kind !== 'managed') throw new Error(`expected managed, got ${choice.kind}`);
    expect(choice.version).toBe('22.17.0');
    // join() yields platform separators; compare normalized.
    expect(normalize(choice.exePath)).toBe('C:/cache/runtimes/node/22.17.0/node.exe');
  });

  it('falls back to system when the requested version is not installed', () => {
    const choice = resolveRuntimeChoice('99.0.0', [managedEntry('22.17.0')], SYSTEM);
    expect(choice).toEqual({ kind: 'system', exePath: SYSTEM.exePath, version: SYSTEM.version });
  });

  it('uses system when nothing is requested', () => {
    expect(resolveRuntimeChoice(undefined, [managedEntry('22.17.0')], SYSTEM)).toMatchObject({ kind: 'system' });
    expect(resolveRuntimeChoice('', [], SYSTEM)).toMatchObject({ kind: 'system' });
  });

  it('returns none when neither managed nor system exists', () => {
    expect(resolveRuntimeChoice(undefined, [], null)).toEqual({ kind: 'none' });
    expect(resolveRuntimeChoice('22.17.0', [], null)).toEqual({ kind: 'none' });
  });

  it('ignores manifest rows without an installedPath (partial installs)', () => {
    const partial = { ...managedEntry('20.0.0'), installedPath: undefined };
    const choice = resolveRuntimeChoice('20.0.0', [partial], null);
    expect(choice).toEqual({ kind: 'none' });
  });

  it('sorts newest-first for display', () => {
    expect(installedNodeVersions([managedEntry('20.11.0'), managedEntry('22.17.0')])).toEqual(['22.17.0', '20.11.0']);
  });
});
