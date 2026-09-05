/**
 * DenoBunRuntimeAdapter unit tests (runtime switching): resolution precedence
 * — requested managed version → system → (auto) newest managed → none — with
 * detectSystemRuntime mocked so no native command-lookup spawns happen here.
 */
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { ManifestEntry } from '@rh/protocol';
import { DenoBunRuntimeAdapter } from './runtime-adapter.js';
import { detectSystemRuntime } from './runtime-detection.js';
import { executableName } from '../platform.js';
import { join } from 'node:path';

vi.mock('./runtime-detection.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./runtime-detection.js')>();
  return { ...actual, detectSystemRuntime: vi.fn() };
});

const systemMock = detectSystemRuntime as Mock;

function managedEntry(id: 'deno' | 'bun' | 'node', version: string, installedPath: string): ManifestEntry {
  return {
    kind: 'runtime',
    id,
    platform: 'win64',
    arch: 'x64',
    version,
    url: `https://example.com/${id}-${version}.zip`,
    sha256: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
    license: 'MIT',
    source: 'official-dist',
    customBuildRequired: false,
    installedPath
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('DenoBunRuntimeAdapter', () => {
  it('prefers a matching managed version when one is requested', async () => {
    systemMock.mockResolvedValue(null);
    const adapter = new DenoBunRuntimeAdapter('deno');
    const resolved = await adapter.resolveExecutable('2.3.4', [managedEntry('deno', '2.3.4', 'C:/cache/deno/2.3.4')]);
    expect(resolved).toEqual({ exePath: join('C:/cache/deno/2.3.4', executableName('deno')), version: '2.3.4' });
    expect(systemMock).not.toHaveBeenCalled();
  });

  it('resolves bun.exe for bun managed entries', async () => {
    systemMock.mockResolvedValue(null);
    const adapter = new DenoBunRuntimeAdapter('bun');
    const resolved = await adapter.resolveExecutable('1.2.3', [managedEntry('bun', '1.2.3', 'C:/cache/bun/1.2.3')]);
    expect(resolved).toEqual({ exePath: join('C:/cache/bun/1.2.3', executableName('bun')), version: '1.2.3' });
  });

  it('falls back to the system install when the named version vanished', async () => {
    systemMock.mockResolvedValue({ exePath: 'C:/deno/deno.exe', version: '2.4.0' });
    const adapter = new DenoBunRuntimeAdapter('deno');
    const resolved = await adapter.resolveExecutable('2.3.4', [managedEntry('deno', '2.3.0', 'C:/cache/deno/2.3.0')]);
    expect(resolved).toEqual({ exePath: 'C:/deno/deno.exe', version: '2.4.0' });
  });

  it('auto-resolution prefers system, then the newest managed version', async () => {
    systemMock.mockResolvedValue({ exePath: 'C:/bun/bun.exe', version: '1.4.0' });
    const adapter = new DenoBunRuntimeAdapter('bun');
    const resolved = await adapter.resolveExecutable(undefined, [
      managedEntry('bun', '1.2.0', 'C:/cache/bun/1.2.0'),
      managedEntry('bun', '1.3.0', 'C:/cache/bun/1.3.0')
    ]);
    expect(resolved).toEqual({ exePath: 'C:/bun/bun.exe', version: '1.4.0' });

    systemMock.mockResolvedValue(null);
    const managed = await adapter.resolveExecutable(undefined, [
      managedEntry('bun', '1.2.0', 'C:/cache/bun/1.2.0'),
      managedEntry('bun', '1.3.0', 'C:/cache/bun/1.3.0')
    ]);
    expect(managed).toEqual({ exePath: join('C:/cache/bun/1.3.0', executableName('bun')), version: '1.3.0' });
  });

  it('resolves null when neither a system nor a managed runtime exists', async () => {
    systemMock.mockResolvedValue(null);
    const adapter = new DenoBunRuntimeAdapter('deno');
    expect(await adapter.resolveExecutable(undefined, [])).toBeNull();
    expect(await adapter.resolveExecutable('2.3.4', [managedEntry('deno', '2.3.0', 'C:/cache/deno/2.3.0')])).toBeNull();
  });

  it('lists managed versions newest first and ignores other runtimes', async () => {
    const adapter = new DenoBunRuntimeAdapter('deno');
    const versions = await adapter.installedVersions([
      managedEntry('deno', '2.1.0', 'C:/cache/deno/2.1.0'),
      managedEntry('deno', '2.4.0', 'C:/cache/deno/2.4.0'),
      managedEntry('node', '24.18.0', 'C:/cache/node/24.18.0'),
      managedEntry('deno', '2.2.0', 'C:/cache/deno/2.2.0')
    ]);
    expect(versions).toEqual(['2.4.0', '2.2.0', '2.1.0']);
  });
});
