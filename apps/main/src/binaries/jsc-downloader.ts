import type { ManifestEntry } from '@rh/protocol';
import { installArtifact, readManifest, type InstallRequest } from './binary-manager.js';
import { resolveLatestJscRevisions } from './jsc-source.js';
import { WebKitArchiveUnavailable } from './jsc-archive.js';

export async function installJscEngine(req: Pick<InstallRequest, 'onProgress'> = {}): Promise<ManifestEntry> {
  const candidates = await resolveLatestJscRevisions();
  const manifest = await readManifest();
  for (const { revision, url } of candidates) {
    const previous = manifest.entries.find((entry) => entry.kind === 'engine' && entry.id === 'javascriptcore' && entry.url === url);
    try {
      return await installArtifact({
        entry: {
          kind: 'engine', id: 'javascriptcore', platform: 'win64', arch: 'x64', version: revision, url,
          sha256: previous?.sha256 ?? '', license: 'LGPL-2.1 + BSD mix', source: 'official-dist', customBuildRequired: false
        },
        source: { url, sha256: previous?.sha256 }, archive: 'webkit-jsc', onProgress: req.onProgress
      });
    } catch (error) {
      if (!(error instanceof WebKitArchiveUnavailable)) throw error;
    }
  }
  throw new Error('No Windows x64 archives are available for the latest WebKit builds');
}
