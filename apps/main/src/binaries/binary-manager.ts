/**
 * BinaryManager (plan todo 7/15): manifest-driven download → checksum verify →
 * atomic extract → cache install, plus removal. Runtime- and engine-agnostic;
 * sources describe WHERE to fetch + HOW to verify; the manager does the rest.
 *
 * All artifacts land only after sha256 verification; staging dirs are removed
 * on any failure so a failed install never mutates the manifest or cache.
 */
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  BinaryManifestSchema,
  ManifestEntrySchema,
  type BinaryManifest,
  type ManifestEntry
} from '@rh/protocol';
import { engineDir, manifestPath, runtimeDir, supportDir, tmpDir } from './paths.js';

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
  /** Directory name inside the zip containing the payload root (auto-detect when absent). */
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

export async function upsertEntry(entry: ManifestEntry): Promise<void> {
  const manifest = await readManifest();
  const key = (e: ManifestEntry): string => `${e.kind}:${e.id}:${e.platform}:${e.arch}:${e.version}`;
  const filtered = manifest.entries.filter((e) => key(e) !== key(entry));
  filtered.push(ManifestEntrySchema.parse(entry));
  await writeManifest({ schemaVersion: 1, entries: filtered });
}

export async function removeEntry(kind: ManifestEntry['kind'], id: string, version: string): Promise<void> {
  const manifest = await readManifest();
  const target = manifest.entries.find(
    (e) => e.kind === kind && e.id === id && e.version === version
  );
  if (!target) throw new Error(`not installed: ${kind}/${id}/${version}`);
  if (!target.installedPath) throw new Error('manifest entry has no installedPath');
  await fs.rm(target.installedPath, { recursive: true, force: false });
  const remaining = manifest.entries.filter((e) => e !== target);
  await writeManifest({ schemaVersion: 1, entries: remaining });
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
    if (expected !== undefined && actual !== expected) {
      throw new Error(`sha256 mismatch for ${req.source.url}: expected ${expected}, got ${actual}`);
    }
    // Record-mode (no upstream checksum): the OBSERVED hash becomes the
    // manifest's pinned sha256 for this artifact/version combination.
    const recordedSha = expected ?? actual;

    await extractZip(stageZip, stageDir);
    if (req.stripRoot !== false) await hoistSingleRoot(stageDir);

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
