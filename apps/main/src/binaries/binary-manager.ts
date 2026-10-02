/**
 * BinaryManager (plan todo 7/15): manifest-driven download → checksum verify →
 * atomic extract → cache install, plus removal. Runtime- and engine-agnostic;
 * sources describe WHERE to fetch + HOW to verify; the manager does the rest.
 *
 * All artifacts land only after sha256 verification; staging dirs are removed
 * on any failure so a failed install never mutates the manifest or cache.
 */
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import { dirname, isAbsolute, join, basename, relative, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { openPromise, type Entry } from 'yauzl';
import {
  BinaryManifestSchema,
  ManifestEntrySchema,
  type BinaryManifest,
  type ManifestEntry
} from '@rh/protocol';
import { engineDir, manifestPath, runtimeDir, supportDir, tmpDir } from './paths.js';
import { executableName, hostArch, hostPlatform, managedRuntimeExecutableRelativePath } from '../platform.js';

export interface DownloadProgress {
  id: string;
  version: string;
  receivedBytes: number;
  totalBytes: number | null;
}

export interface FetchSource {
  url: string;
  /**
   * Expected sha256. REQUIRED for artifacts whose host publishes checksums.
   * Official-canary V8 zips publish none — those pass `undefined` and enter
   * RECORD MODE: the observed hash is returned and persisted into the
   * manifest, so any later re-install of the same version is verified
   * against the previously recorded digest (D2 audit trail).
   */
  sha256?: string;
}

export interface InstallRequest {
  entry: Omit<ManifestEntry, 'installedPath' | 'addedAt'>;
  source: FetchSource;
  /** Archive format; zip remains the default for existing installers. */
  archive?: 'zip' | 'tar.gz' | 'tar.xz' | 'file';
  /** Optional executable path inside an extracted archive to materialize at its root. */
  executablePath?: string;
  /** Directory name inside the archive containing the payload root (auto-detect when absent). */
  stripRoot?: boolean;
  onProgress?: (p: DownloadProgress) => void;
}

const MAX_DOWNLOAD_BYTES = 1024 * 1024 * 1024;

export function emptyManifest(): BinaryManifest {
  return { schemaVersion: 1, entries: [] };
}

export async function readManifest(): Promise<BinaryManifest> {
  try {
    const raw = await fs.readFile(manifestPath(), 'utf8');
    return BinaryManifestSchema.parse(JSON.parse(raw));
  } catch {
    return emptyManifest();
  }
}

export async function writeManifest(manifest: BinaryManifest): Promise<void> {
  const path = manifestPath();
  await fs.mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(manifest, null, 2), 'utf8');
  await fs.rename(tmp, path);
}

/*
 * Separate downloads use separate staging directories, but they all update
 * the same manifest when they finish. Serialize those read/modify/write
 * operations so two parallel installs cannot lose the entry written by the
 * other install.
 */
let manifestMutation: Promise<void> = Promise.resolve();

function withManifestMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const run = manifestMutation.then(mutation, mutation);
  manifestMutation = run.then(() => undefined, () => undefined);
  return run;
}

export function upsertEntry(entry: ManifestEntry): Promise<void> {
  return withManifestMutation(async () => {
    const manifest = await readManifest();
    const key = (e: ManifestEntry): string => `${e.kind}:${e.id}:${e.platform}:${e.arch}:${e.version}`;
    const filtered = manifest.entries.filter((e) => key(e) !== key(entry));
    filtered.push(ManifestEntrySchema.parse(entry));
    await writeManifest({ schemaVersion: 1, entries: filtered });
  });
}

export function removeEntry(kind: ManifestEntry['kind'], id: string, version: string): Promise<void> {
  return withManifestMutation(async () => {
    const manifest = await readManifest();
    const target = manifest.entries.find(
      (e) => e.kind === kind && e.id === id && e.version === version
    );
    if (!target) throw new Error(`not installed: ${kind}/${id}/${version}`);
    if (!target.installedPath) throw new Error('manifest entry has no installedPath');
    await fs.rm(target.installedPath, { recursive: true, force: false });
    const remaining = manifest.entries.filter((e) => e !== target);
    await writeManifest({ schemaVersion: 1, entries: remaining });
  });
}

/** Stream a URL to a file, hashing while downloading. */
export async function downloadTo(source: FetchSource, destFile: string, onProgress?: (p: DownloadProgress) => void, progressId = '', version = ''): Promise<string> {
  await fs.mkdir(dirname(destFile), { recursive: true });
  const res = await fetch(source.url);
  if (!res.ok || !res.body) throw new Error(`download failed ${res.status} for ${source.url}`);
  const body = res.body;
  const totalHeader = res.headers.get('content-length');
  const parsedTotal = totalHeader === null ? Number.NaN : Number(totalHeader);
  const total = Number.isFinite(parsedTotal) && parsedTotal >= 0 ? parsedTotal : null;
  if (total !== null && total > MAX_DOWNLOAD_BYTES) {
    await body.cancel();
    throw new Error(`download is too large (${total} bytes; limit ${MAX_DOWNLOAD_BYTES})`);
  }
  const hash = createHash('sha256');
  let received = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      if (received > MAX_DOWNLOAD_BYTES) {
        callback(new Error(`download exceeded ${MAX_DOWNLOAD_BYTES} byte limit`));
        return;
      }
      hash.update(chunk);
      onProgress?.({ id: progressId, version, receivedBytes: received, totalBytes: total });
      callback(null, chunk);
    }
  });
  try {
    const sourceStream = Readable.from((async function* streamResponseBody() {
      for await (const chunk of body) yield chunk;
    })());
    await pipeline(sourceStream, meter, createWriteStream(destFile));
  } catch (error) {
    await fs.rm(destFile, { force: true });
    throw error;
  }
  return hash.digest('hex');
}

const ZIP_FILE_TYPE_MASK = 0o170000;
const ZIP_DIRECTORY_TYPE = 0o040000;
const ZIP_SYMLINK_TYPE = 0o120000;
const MAX_ZIP_ENTRY_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_ZIP_TOTAL_BYTES = 4 * 1024 * 1024 * 1024;
const MAX_TAR_LISTING_BYTES = 16 * 1024 * 1024;
const ARCHIVE_COMMAND_TIMEOUT_MS = 2 * 60 * 1000;

function zipEntryMode(entry: Entry): number {
  return (entry.externalFileAttributes >>> 16) & 0xffff;
}

function safeArchiveEntryPath(destDir: string, fileName: string): string {
  if (fileName.includes('\0') || fileName.includes('\\') || fileName.startsWith('/') || /^[a-zA-Z]:/.test(fileName)) {
    throw new Error(`unsafe archive entry path: ${fileName}`);
  }
  const segments = fileName.split('/').filter((segment) => segment !== '');
  if (segments.length === 0 || segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error(`unsafe archive entry path: ${fileName}`);
  }
  const root = resolve(destDir);
  const target = resolve(root, ...segments);
  const fromRoot = relative(root, target);
  if (fromRoot === '' || fromRoot.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || fromRoot === '..' || isAbsolute(fromRoot)) {
    throw new Error(`archive entry escapes destination: ${fileName}`);
  }
  return target;
}

/** Extract a zip without materialising links or allowing entries outside the staging directory. */
export async function extractZipArchive(zipFile: string, destDir: string): Promise<void> {
  await fs.mkdir(destDir, { recursive: true });
  const archive = await openPromise(zipFile, {
    autoClose: true,
    lazyEntries: true,
    strictFileNames: true,
    validateEntrySizes: true
  });
  let totalBytes = 0;
  try {
    for await (const entry of archive.eachEntry()) {
      const mode = zipEntryMode(entry);
      const type = mode & ZIP_FILE_TYPE_MASK;
      if (type === ZIP_SYMLINK_TYPE) throw new Error(`zip symlink entries are not allowed: ${entry.fileName}`);
      if (entry.uncompressedSize > MAX_ZIP_ENTRY_BYTES) throw new Error(`zip entry is too large: ${entry.fileName}`);
      totalBytes += entry.uncompressedSize;
      if (totalBytes > MAX_ZIP_TOTAL_BYTES) throw new Error('zip expands beyond the configured size limit');

      const target = safeArchiveEntryPath(destDir, entry.fileName);
      if (entry.fileName.endsWith('/') || type === ZIP_DIRECTORY_TYPE) {
        await fs.mkdir(target, { recursive: true });
        continue;
      }

      await fs.mkdir(dirname(target), { recursive: true });
      const input = await archive.openReadStreamPromise(entry);
      await pipeline(input, createWriteStream(target, { flags: 'wx', mode: mode & 0o777 || 0o644 }));
      if (process.platform !== 'win32' && (mode & 0o777) !== 0) await fs.chmod(target, mode & 0o777);
    }
  } finally {
    archive.close();
  }
}

const execFileAsync = promisify(execFile);

/** Finder-launched macOS apps may not inherit the interactive shell PATH. */
function tarExecutable(): string {
  return process.platform === 'darwin' ? '/usr/bin/tar' : 'tar';
}

function extractionError(archiveFile: string, error: unknown): Error {
  const detail = error instanceof Error ? error.message : String(error);
  return new Error(`failed to extract ${basename(archiveFile)} with ${tarExecutable()}: ${detail}`);
}

/** Validate system-tar output before extraction. Only files/directories are allowed. */
export function validateTarListings(namesOutput: string, verboseOutput: string): void {
  const names = namesOutput.split(/\r?\n/).filter((name) => name !== '');
  const verbose = verboseOutput.split(/\r?\n/).filter((line) => line !== '');
  if (names.length !== verbose.length) throw new Error('tar listing is inconsistent');
  for (const name of names) safeArchiveEntryPath('.', name.replace(/\/$/, ''));
  for (const line of verbose) {
    const entryType = line[0];
    if (entryType !== '-' && entryType !== 'd') {
      throw new Error(`tar entry type is not allowed: ${entryType ?? 'unknown'}`);
    }
  }
}

async function validateTarArchive(archiveFile: string, compression: 'z' | 'J'): Promise<void> {
  const common = {
    windowsHide: true,
    timeout: ARCHIVE_COMMAND_TIMEOUT_MS,
    maxBuffer: MAX_TAR_LISTING_BYTES,
    encoding: 'utf8' as const
  };
  const names = await execFileAsync(tarExecutable(), [`-t${compression}f`, archiveFile], common);
  const verbose = await execFileAsync(tarExecutable(), [`-tv${compression}f`, archiveFile], common);
  validateTarListings(names.stdout, verbose.stdout);
}

async function extractTarGz(archiveFile: string, destDir: string): Promise<void> {
  await fs.mkdir(destDir, { recursive: true });
  try {
    await validateTarArchive(archiveFile, 'z');
    await execFileAsync(tarExecutable(), ['-xzf', archiveFile, '-C', destDir], {
      windowsHide: true,
      timeout: ARCHIVE_COMMAND_TIMEOUT_MS
    });
  } catch (error) {
    throw extractionError(archiveFile, error);
  }
}

async function extractTarXz(archiveFile: string, destDir: string): Promise<void> {
  await fs.mkdir(destDir, { recursive: true });
  try {
    await validateTarArchive(archiveFile, 'J');
    await execFileAsync(tarExecutable(), ['-xJf', archiveFile, '-C', destDir], {
      windowsHide: true,
      timeout: ARCHIVE_COMMAND_TIMEOUT_MS
    });
  } catch (error) {
    throw extractionError(archiveFile, error);
  }
}

function safeRelativePath(value: string): string {
  if (isAbsolute(value)) throw new Error('executablePath must be relative');
  const normalized = value.replace(/\\/g, '/');
  if (normalized === '' || normalized.split('/').some((segment) => segment === '..')) {
    throw new Error('invalid executablePath');
  }
  return normalized;
}

async function materializeExecutable(stageDir: string, entryId: string, executablePath: string): Promise<void> {
  const source = join(stageDir, safeRelativePath(executablePath));
  const targetName = IMPORT_BINARY_NAME[entryId] ?? basename(source);
  await fs.access(source);
  if (source !== join(stageDir, targetName)) await fs.copyFile(source, join(stageDir, targetName));
}

/**
 * If the zip contains a single top-level directory, hoist its contents into
 * destDir so the install dir IS the payload root.
 */
async function hoistSingleRoot(destDir: string): Promise<void> {
  const children = await fs.readdir(destDir);
  if (children.length !== 1) return;
  const only = children[0];
  if (!only) return;
  const inner = join(destDir, only);
  const stat = await fs.stat(inner);
  if (!stat.isDirectory()) return;
  const staged = `${destDir}__hoist`;
  await fs.rename(inner, staged);
  await fs.rm(destDir, { recursive: true, force: true });
  await fs.rename(staged, destDir);
}

export function targetDirFor(entry: ManifestEntry): string {
  if (entry.kind === 'runtime') return runtimeDir(entry.id, entry.version);
  if (entry.kind === 'engine') return engineDir(entry.id, entry.version);
  return supportDir(entry.id);
}

const IMPORT_BINARY_NAME: Record<string, string> = {
  node: executableName('node'),
  deno: executableName('deno'),
  bun: executableName('bun'),
  v8: executableName('d8'),
  'd8-debug': executableName('d8'),
  spidermonkey: executableName('js'),
  javascriptcore: executableName('jsc'),
  quickjs: executableName('qjs'),
  hermes: executableName('hermes'),
  chakra: executableName('ch'),
  txiki: executableName('tjs'),
  'moddable-xs': executableName('xst')
};

async function makeExecutable(path: string, required = false): Promise<void> {
  const stat = await fs.stat(path).catch(() => null);
  if (stat === null || !stat.isFile()) {
    if (required) throw new Error(`runtime archive is missing its executable: ${path}`);
    return;
  }
  if (process.platform === 'win32') return;
  await fs.chmod(path, 0o755);
}

function stagedExecutablePath(entry: Pick<ManifestEntry, 'kind' | 'id'>, executablePath?: string): string | null {
  if (entry.kind === 'runtime' && entry.id === 'node') return managedRuntimeExecutableRelativePath('node');
  if (executablePath !== undefined) return basename(executablePath);
  return IMPORT_BINARY_NAME[entry.id] ?? null;
}

function safeImportSegment(value: string, label: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(value)) throw new Error(`invalid ${label}`);
}

async function hashImportSource(sourcePath: string): Promise<string> {
  const hash = createHash('sha256');
  const walk = async (current: string, relative: string): Promise<void> => {
    const stat = await fs.stat(current);
    if (stat.isDirectory()) {
      const children = (await fs.readdir(current)).sort();
      for (const child of children) await walk(join(current, child), join(relative, child));
      return;
    }
    hash.update(`${relative}\0`);
    hash.update(await fs.readFile(current));
  };
  await walk(sourcePath, basename(sourcePath));
  return hash.digest('hex');
}

/** Copy an existing runtime/engine into the private RuntimeHell cache. */
export async function importLocalArtifact(
  kind: 'runtime' | 'engine',
  id: string,
  sourcePath: string,
  version: string
): Promise<ManifestEntry> {
  if (!isAbsolute(sourcePath)) throw new Error('local import path must be absolute');
  safeImportSegment(id, 'binary id');
  safeImportSegment(version, 'version');
  const sourceStat = await fs.stat(sourcePath);
  const entry: ManifestEntry = {
    kind,
    id,
    platform: hostPlatform(),
    arch: hostArch(),
    version,
    url: pathToFileURL(sourcePath).toString(),
    sha256: await hashImportSource(sourcePath),
    license: 'user-provided local artifact',
    source: 'local-import',
    customBuildRequired: false as const
  };
  const finalDir = targetDirFor(entry);
  const stageDir = tmpDir(`local-${kind}-${id}-${version}`);
  try {
    await fs.access(finalDir).then(
      () => {
        throw new Error(`already installed at ${finalDir}`);
      },
      () => undefined
    );
    await fs.rm(stageDir, { recursive: true, force: true });
    await fs.mkdir(stageDir, { recursive: true });
    if (sourceStat.isDirectory()) {
      const executableRelativePath = kind === 'runtime' && id === 'node'
        ? managedRuntimeExecutableRelativePath(id)
        : IMPORT_BINARY_NAME[id];
      if (executableRelativePath === undefined) throw new Error(`no executable mapping for ${kind}/${id}`);
      try {
        await fs.access(join(sourcePath, executableRelativePath));
      } catch {
        throw new Error(`local artifact folder must contain ${executableRelativePath}`);
      }
      // Materialize links into the cache so an imported tree cannot keep a
      // path back out of the sandbox when it is executed later.
      await fs.cp(sourcePath, stageDir, { recursive: true, dereference: true });
    } else {
      const targetRelativePath = kind === 'runtime' && id === 'node'
        ? managedRuntimeExecutableRelativePath(id)
        : IMPORT_BINARY_NAME[id] ?? basename(sourcePath);
      const targetPath = join(stageDir, targetRelativePath);
      await fs.mkdir(dirname(targetPath), { recursive: true });
      await fs.copyFile(sourcePath, targetPath);
      await makeExecutable(targetPath);
    }
    if (sourceStat.isDirectory()) {
      const executableRelativePath = kind === 'runtime' && id === 'node'
        ? managedRuntimeExecutableRelativePath(id)
        : IMPORT_BINARY_NAME[id];
      if (executableRelativePath !== undefined) await makeExecutable(join(stageDir, executableRelativePath));
    }
    await fs.mkdir(dirname(finalDir), { recursive: true });
    await fs.rename(stageDir, finalDir);
    const installed: ManifestEntry = { ...entry, installedPath: finalDir, addedAt: new Date().toISOString() };
    await upsertEntry(installed);
    return installed;
  } catch (error) {
    await fs.rm(stageDir, { recursive: true, force: true });
    throw error;
  }
}

/**
 * Full install pipeline. Throws before mutating anything if verification fails.
 */
export async function installArtifact(req: InstallRequest): Promise<ManifestEntry> {
  const token = `${req.entry.kind}-${req.entry.id}-${req.entry.version}`;
  const stageZip = `${tmpDir(token)}.zip`;
  const stageDir = tmpDir(token);

  try {
    const expected = req.source.sha256;
    const actual = await downloadTo(req.source, stageZip, req.onProgress, req.entry.id, req.entry.version);
    // Empty/undefined expected ⇒ RECORD MODE (no upstream checksum exists,
    // e.g. Mozilla jsshell zips): the observed digest is pinned instead.
    if (expected !== undefined && expected !== '' && actual !== expected) {
      throw new Error(`sha256 mismatch for ${req.source.url}: expected ${expected}, got ${actual}`);
    }
    // Record-mode (no upstream checksum): the OBSERVED hash becomes the
    // manifest's pinned sha256 for this artifact/version combination.
    const recordedSha = expected ?? actual;

    if (req.archive === 'file') {
      await fs.mkdir(stageDir, { recursive: true });
      const targetName = IMPORT_BINARY_NAME[req.entry.id] ?? basename(req.source.url);
      await fs.copyFile(stageZip, join(stageDir, targetName));
    } else if (req.archive === 'tar.gz') {
      await extractTarGz(stageZip, stageDir);
      if (req.stripRoot !== false) await hoistSingleRoot(stageDir);
    } else if (req.archive === 'tar.xz') {
      await extractTarXz(stageZip, stageDir);
      if (req.stripRoot !== false) await hoistSingleRoot(stageDir);
    } else {
      await extractZipArchive(stageZip, stageDir);
      if (req.stripRoot !== false) await hoistSingleRoot(stageDir);
    }
    if (req.executablePath !== undefined) await materializeExecutable(stageDir, req.entry.id, req.executablePath);
    const stagedExecutable = stagedExecutablePath(req.entry, req.executablePath);
    if (stagedExecutable !== null) {
      await makeExecutable(
        join(stageDir, stagedExecutable),
        req.entry.kind === 'runtime' && req.entry.id === 'node'
      );
    }

    const finalDir = targetDirFor(req.entry);
    await fs.mkdir(dirname(finalDir), { recursive: true });
    try {
      await fs.rename(stageDir, finalDir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EPERM') {
        // Windows rename-onto-existing quirk → explicit conflict
        throw new Error(`already installed at ${finalDir}`);
      }
      throw err;
    }

    const entry: ManifestEntry = {
      ...req.entry,
      sha256: recordedSha,
      installedPath: finalDir,
      addedAt: new Date().toISOString()
    };
    await upsertEntry(entry);
    return entry;
  } finally {
    await fs.rm(stageZip, { force: true });
    await fs.rm(tmpDir(token), { recursive: true, force: true });
  }
}
