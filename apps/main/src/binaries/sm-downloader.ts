/**
 * SpiderMonkey engine installer (plan todo 24).
 * Uses resolveSmSource (taskcluster → archive fallback) + record-mode sha256
 * (Mozilla publishes no checksums for jsshell zips; the observed digest is
 * pinned into the manifest so re-installs are tamper-checked).
 */
import type { ManifestEntry } from '@rh/protocol';
import { installArtifact } from './binary-manager.js';
import { buildSmInstall, resolveSmSource } from './sm-source.js';

export interface SmInstallRequest {
  onProgress?: (p: { receivedBytes: number; totalBytes: number | null }) => void;
}

export async function installSmEngine(req: SmInstallRequest = {}): Promise<ManifestEntry> {
  const source = await resolveSmSource();
  const built = buildSmInstall(source, ''); // empty sha ⇒ BinaryManager RECORD MODE
  return installArtifact({
    entry: built,
    source: { url: source.url },
    onProgress: (p) => req.onProgress?.({ receivedBytes: p.receivedBytes, totalBytes: p.totalBytes })
  });
}
