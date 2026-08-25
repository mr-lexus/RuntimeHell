/**
 * WebKitRequirements support artifact (plan todo 25).
 * Resolves the latest GitHub release asset, downloads it (record-mode sha —
 * GitHub publishes no checksums for these assets), extracts into
 * cache/support/webkit-requirements, and exposes the bin64 DLL directory that
 * must be prepended to the CHILD process PATH when running jsc.
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { ManifestEntry } from '@rh/protocol';
import { installArtifact, readManifest } from './binary-manager.js';
import { supportDir } from './paths.js';

const RELEASES_API = 'https://api.github.com/repos/WebKitForWindows/WebKitRequirements/releases/latest';

export interface RequirementsInfo {
  entry: ManifestEntry;
  bin64Dir: string;
}

interface GitHubAsset {
  name: string;
  browser_download_url: string;
}

export async function resolveRequirementsAsset(fetchImpl: typeof fetch = fetch): Promise<{ url: string; name: string }> {
  const res = await fetchImpl(RELEASES_API, { headers: { 'User-Agent': 'RuntimeHell' } });
  if (!res.ok) throw new Error(`WebKitRequirements release lookup failed: ${res.status}`);
  const body = (await res.json()) as { assets?: GitHubAsset[] };
  const asset = (body.assets ?? []).find((a) => /webkitrequirements.*\.zip$/i.test(a.name));
  if (!asset) throw new Error('no WebKitRequirements zip asset in latest release');
  return { url: asset.browser_download_url, name: asset.name };
}

/** Install (or reuse) the support artifact; returns the bin64 DLL directory. */
export async function ensureWebKitRequirements(fetchImpl: typeof fetch = fetch): Promise<string> {
  const manifest = await readManifest();
  const existing = manifest.entries.find(
    (e) => e.kind === 'runtime-support' && e.id === 'webkit-requirements' && e.installedPath !== undefined
  );
  if (existing?.installedPath !== undefined) {
    const bin64 = join(existing.installedPath, 'bin64');
    try {
      await fs.access(bin64);
      return bin64;
    } catch {
      /* fall through to reinstall */
    }
  }

  const { url, name } = await resolveRequirementsAsset(fetchImpl);
  const entry = await installArtifact({
    entry: {
      kind: 'runtime-support',
      id: 'webkit-requirements',
      platform: 'win64',
      arch: 'x64',
      version: name.replace(/\.zip$/i, ''),
      url,
      sha256: '', // record-mode: no upstream checksums for this artifact
      license: 'BSD-style (WebKitForWindows)',
      source: 'webkit-requirements',
      customBuildRequired: false as const
    },
    source: { url },
    stripRoot: false // zip already contains bin64/ at its root
  });
  const bin64 = join(entry.installedPath ?? '', 'bin64');
  await fs.access(bin64); // fail loudly if layout changed upstream
  return bin64;
}
