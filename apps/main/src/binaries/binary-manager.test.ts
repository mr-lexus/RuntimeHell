import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { access, chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { downloadTo, extractZipArchive, installArtifact, validateTarListings } from './binary-manager.js';
import { hostArch, hostPlatform } from '../platform.js';

let sandbox = '';
const execFileAsync = promisify(execFile);

function emptyZip(fileName: string, unixMode = 0o100644): Buffer {
  const name = Buffer.from(fileName, 'utf8');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(name.length, 26);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE((3 << 8) | 20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE((unixMode << 16) >>> 0, 38);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(46 + name.length, 12);
  end.writeUInt32LE(30 + name.length, 16);
  return Buffer.concat([local, name, central, name, end]);
}

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'rh-safe-zip-'));
});

afterEach(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

describe('safe zip extraction', () => {
  it('extracts regular files into the staging directory', async () => {
    const archive = join(sandbox, 'safe.zip');
    const output = join(sandbox, 'out');
    await writeFile(archive, emptyZip('bin/runtime.exe'));

    await extractZipArchive(archive, output);

    await expect(access(join(output, 'bin', 'runtime.exe'))).resolves.toBeUndefined();
  });

  it('rejects entries that traverse outside the staging directory', async () => {
    const archive = join(sandbox, 'traversal.zip');
    await writeFile(archive, emptyZip('../escaped.exe'));

    await expect(extractZipArchive(archive, join(sandbox, 'out'))).rejects.toThrow(/unsafe|invalid relative path|invalid file name/i);
    await expect(access(join(sandbox, 'escaped.exe'))).rejects.toThrow();
  });

  it('rejects symlink entries instead of materialising links from an untrusted archive', async () => {
    const archive = join(sandbox, 'symlink.zip');
    await writeFile(archive, emptyZip('runtime-link', 0o120777));

    await expect(extractZipArchive(archive, join(sandbox, 'out'))).rejects.toThrow(/symlink entries are not allowed/i);
  });
});

describe('safe tar extraction preflight', () => {
  it('accepts only regular files and directories with contained paths', () => {
    expect(() => validateTarListings(
      'runtime/\nruntime/bin/node\n',
      'drwxr-xr-x user/group 0 2026-01-01 00:00 runtime/\n-rwxr-xr-x user/group 1 2026-01-01 00:00 runtime/bin/node\n'
    )).not.toThrow();
  });

  it('rejects traversal and link entries before extraction', () => {
    expect(() => validateTarListings(
      '../outside\n',
      '-rw-r--r-- user/group 1 2026-01-01 00:00 ../outside\n'
    )).toThrow(/unsafe|escapes/i);
    expect(() => validateTarListings(
      'runtime-link\n',
      'lrwxrwxrwx user/group 0 2026-01-01 00:00 runtime-link -> /tmp/outside\n'
    )).toThrow(/type is not allowed/i);
  });

  it.skipIf(process.platform === 'win32')('installs a real POSIX Node tar.gz and restores executable mode', async () => {
    const payload = join(sandbox, 'payload', 'runtime', 'bin');
    const archive = join(sandbox, 'node.tar.gz');
    const executable = join(payload, 'node');
    await mkdir(payload, { recursive: true });
    await writeFile(executable, '#!/bin/sh\necho runtimehell\n', 'utf8');
    await chmod(executable, 0o755);
    await execFileAsync(process.platform === 'darwin' ? '/usr/bin/tar' : 'tar', [
      '-czf', archive, '-C', join(sandbox, 'payload'), 'runtime'
    ]);
    const bytes = await readFile(archive);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const originalFetch = globalThis.fetch;
    const originalCache = process.env['RH_CACHE_ROOT'];
    globalThis.fetch = async () => new Response(bytes);
    process.env['RH_CACHE_ROOT'] = join(sandbox, 'cache');
    try {
      const installed = await installArtifact({
        entry: {
          kind: 'runtime', id: 'node', platform: hostPlatform(), arch: hostArch(), version: 'test-posix',
          url: 'https://example.test/node.tar.gz', sha256, license: 'MIT', source: 'official-dist', customBuildRequired: false
        },
        source: { url: 'https://example.test/node.tar.gz', sha256 },
        archive: 'tar.gz'
      });
      const installedExecutable = join(installed.installedPath ?? '', 'bin', 'node');
      expect(await readFile(installedExecutable, 'utf8')).toContain('runtimehell');
      expect((await stat(installedExecutable)).mode & 0o111).not.toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalCache === undefined) delete process.env['RH_CACHE_ROOT'];
      else process.env['RH_CACHE_ROOT'] = originalCache;
    }
  });
});

describe('streaming downloads', () => {
  it('streams chunks to disk while calculating the checksum and progress', async () => {
    const originalFetch = globalThis.fetch;
    const chunks = [Buffer.from('runtime-'), Buffer.from('archive')];
    const expected = Buffer.concat(chunks);
    globalThis.fetch = async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      }
    }), { headers: { 'content-length': String(expected.length) } });
    const progress: number[] = [];
    const destination = join(sandbox, 'download.zip');
    try {
      const sha256 = await downloadTo(
        { url: 'https://example.test/runtime.zip' },
        destination,
        (event) => progress.push(event.receivedBytes)
      );
      expect(await readFile(destination)).toEqual(expected);
      expect(sha256).toBe(createHash('sha256').update(expected).digest('hex'));
      expect(progress.at(-1)).toBe(expected.length);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('removes a partial download when the response stream fails', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Buffer.from('partial'));
        controller.error(new Error('network interrupted'));
      }
    }));
    const destination = join(sandbox, 'partial.zip');
    try {
      await expect(downloadTo({ url: 'https://example.test/runtime.zip' }, destination)).rejects.toThrow(/network interrupted/i);
      await expect(access(destination)).rejects.toThrow();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
