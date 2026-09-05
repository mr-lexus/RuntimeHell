import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { importLocalArtifact, readManifest, removeEntry, targetDirFor } from './binary-manager.js';
import { executableName, managedRuntimeExecutablePath } from '../platform.js';

let sandbox: string;
let previousCache: string | undefined;

beforeAll(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'rh-local-import-'));
  previousCache = process.env['RH_CACHE_ROOT'];
  process.env['RH_CACHE_ROOT'] = join(sandbox, 'cache');
});

afterAll(async () => {
  if (previousCache === undefined) delete process.env['RH_CACHE_ROOT'];
  else process.env['RH_CACHE_ROOT'] = previousCache;
  await rm(sandbox, { recursive: true, force: true });
});

describe('importLocalArtifact', () => {
  it('copies a native executable into the private runtime cache and records it', async () => {
    const source = join(sandbox, 'node.exe');
    await writeFile(source, 'fake node executable');

    const entry = await importLocalArtifact('runtime', 'node', source, 'local-test-1');
    expect(entry.source).toBe('local-import');
    expect(entry.installedPath).toBeTruthy();
    expect(await readFile(managedRuntimeExecutablePath(targetDirFor(entry), 'node'), 'utf8')).toBe('fake node executable');
    expect((await readManifest()).entries).toContainEqual(entry);

    await removeEntry('runtime', 'node', 'local-test-1');
    expect((await readManifest()).entries).toEqual([]);
  });

  it('copies a complete engine directory without touching the source', async () => {
    const source = join(sandbox, 'quickjs');
    await mkdir(source, { recursive: true });
    await writeFile(join(source, executableName('qjs')), 'fake qjs executable');

    const entry = await importLocalArtifact('engine', 'quickjs', source, 'local-test-2');
    expect(await readFile(join(targetDirFor(entry), executableName('qjs')), 'utf8')).toBe('fake qjs executable');
    expect(await readFile(join(source, executableName('qjs')), 'utf8')).toBe('fake qjs executable');
    await removeEntry('engine', 'quickjs', 'local-test-2');
  });
});
