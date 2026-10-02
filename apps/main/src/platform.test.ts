import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { managedRuntimeExecutableRelativePath, normalizePathForComparison, sameFilesystemPath } from './platform.js';

describe('managed runtime executable layout', () => {
  it('uses the POSIX Node archive layout', () => {
    expect(managedRuntimeExecutableRelativePath('node', 'darwin').replace(/\\/g, '/')).toBe('bin/node');
    expect(managedRuntimeExecutableRelativePath('node', 'linux').replace(/\\/g, '/')).toBe('bin/node');
  });

  it('keeps non-Node managed binaries at the archive root', () => {
    expect(managedRuntimeExecutableRelativePath('deno', 'darwin')).toBe('deno');
    expect(managedRuntimeExecutableRelativePath('deno', 'win32')).toBe('deno.exe');
  });

  it('keeps Windows Node archives flat', () => {
    expect(managedRuntimeExecutableRelativePath('node', 'win32')).toBe('node.exe');
  });
});

describe('normalizePathForComparison', () => {
  it('folds case and separators only on Windows', () => {
    expect(normalizePathForComparison('C:\\Users\\Dev\\FILE.cjs', 'win32')).toBe('c:/users/dev/file.cjs');
    expect(normalizePathForComparison('/Users/Dev/FILE.cjs', 'darwin')).toBe('/Users/Dev/FILE.cjs');
    expect(normalizePathForComparison('/Users/Dev/FILE.cjs', 'darwin'))
      .not.toBe(normalizePathForComparison('/users/dev/file.cjs', 'darwin'));
  });

  it('decodes file URLs and preserves POSIX case', () => {
    expect(normalizePathForComparison('file:///Users/Dev/My%20Project/entry.cjs', 'darwin'))
      .toBe('/Users/Dev/My Project/entry.cjs');
  });

  it('recognizes a file URL and native path as the same file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rh-path-'));
    const file = join(dir, 'Project With Spaces', 'entry.cjs');
    try {
      await mkdir(join(dir, 'Project With Spaces'));
      await writeFile(file, '');
      await expect(sameFilesystemPath(pathToFileURL(file).toString(), file)).resolves.toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
