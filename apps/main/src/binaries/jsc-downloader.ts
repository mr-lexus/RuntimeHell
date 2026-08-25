/**
 * JavaScriptCore engine installer (plan todo 25).
 * Walks candidate revisions NEWEST-FIRST (from the Buildbot listing) and
 * returns the first artifact that downloads + verifies. Record-mode sha256:
 * WebKit publishes no checksums for these CI zips.
 */
import type { ManifestEntry } from '@rh/protocol';
import { installArtifact } from './binary-manager.js';
import { resolveLatestJscRevisions } from './jsc-source.js';

export interface JscInstallRequest {
  onProgress?: (p: { receivedBytes: number; totalBytes: number | null }) => void;
}

export async function installJscEngine(req: JscInstallRequest = {}): Promise<ManifestEntry> {
  const candidates = await resolveLatestJscRevisions();
  let lastError: Error | null = null;
  for (const candidate of candidates) {
    try {
      return await installArtifact({
        entry: buildJscInstall(candidate.revision, ''),
        source: { url: candidate.url }, // empty sha ⇒ RECORD MODE
        onProgress: (p) =>
          req.onProgress?.({ receivedBytes: p.receivedBytes, totalBytes: p.totalBytes })
      });
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // 404/403 on this particular artifact → try the next candidate.
    }
  }
  throw lastError ?? new Error('no downloadable JSC artifacts found');
}

function buildJscInstall(revision: string, sha256: string): Omit<ManifestEntry, 'installedPath' | 'addedAt'> {
  return {
    kind: 'engine',
    id: 'javascriptcore',
    platform: 'win64',
    arch: 'x64',
    version: revision,
    url: `https://s3-us-west-2.amazonaws.com/archives.webkit.org/wincairo-x86_64-release/${revision}@main.zip`,
    sha256,
    license: 'LGPL-2.1 + BSD mix',
    source: 'taskcluster', // closest enum: community CI build (jsvu-compatible)
    customBuildRequired: false as const
  };
}
