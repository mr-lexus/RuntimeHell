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
import { promises as fs } from 'node:fs';
import { dirname, isAbsolute, join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
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
  const totalHeader = res.headers.get('content-length');
  const total = totalHeader ? Number(totalHeader) : null;
  const hash = createHash('sha256');
  let received = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of res.body) {
    const buf = Buffer.from(chunk as Buffer);
    hash.update(buf);
    received += buf.length;
    // Keep the archive in memory: zips here are ≤ ~200MB and extraction needs
    // random access anyway. Streaming-to-disk variant can come later if needed.
    chunks.push(buf);
    onProgress?.({ id: progressId, version, receivedBytes: received, totalBytes: total });
  }
  const sha256 = hash.digest('hex');
  await fs.writeFile(destFile, Buffer.concat(chunks));
  return sha256;
}

async function extractZip(zipFile: string, destDir: string): Promise<void> {
  const extract = (await import('extract-zip')).default;
  await fs.mkdir(destDir, { recursive: true });
  await extract(zipFile, { dir: destDir });
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

async function extractTarGz(archiveFile: string, destDir: string): Promise<void> {
  await fs.mkdir(destDir, { recursive: true });
  try {
    await execFileAsync(tarExecutable(), ['-xzf', archiveFile, '-C', destDir], { windowsHide: true });
  } catch (error) {
    throw extractionError(archiveFile, error);
  }
}

async function extractTarXz(archiveFile: string, destDir: string): Promise<void> {
  await fs.mkdir(destDir, { recursive: true });
  try {
    await execFileAsync(tarExecutable(), ['-xJf', archiveFile, '-C', destDir], { windowsHide: true });
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
      await extractZip(stageZip, stageDir);
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
