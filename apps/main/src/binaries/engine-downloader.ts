/**
 * EngineDownloader (plan todo 15): catalog-driven engine installs.
 *
 * V8 rel/dbg flow: `-latest.json` discovery → canary zip → sha256 RECORD
 * mode (Google publishes no checksums for canary artifacts; the observed
 * hash is pinned into our manifest so re-installs are tamper-checked).
 * Historical pinning uses the committed seed catalog when present; the
 * milestone-guess helper is EXPERIMENTAL and only consults that seed — it
 * never guesses network URLs (documented limitation, surfaced in UI tooltip
 * by the engines panel).
 */
import type { ManifestEntry } from '@rh/protocol';
import { installArtifact, readManifest, type InstallRequest } from './binary-manager.js';
import {
  parseV8Latest,
  resolveEngineArtifact,
  v8LatestJsonUrl,
  v8ZipUrl,
  type EngineId
} from './engine-catalog.js';

const ENGINE_VARIANT: Record<string, 'rel' | 'dbg'> = {
  v8: 'rel',
  'd8-debug': 'dbg'
};

export async function fetchLatestV8Version(variant: 'rel' | 'dbg'): Promise<string> {
  const res = await fetch(v8LatestJsonUrl(variant));
  if (!res.ok) throw new Error(`v8 latest fetch failed: ${res.status}`);
  const version = parseV8Latest(await res.text());
  if (version === null) throw new Error('v8 latest payload malformed');
  return version;
}

export interface EngineInstallRequest {
  engineId: EngineId;
  /** Explicit version; omitted = latest via -latest.json (V8 only). */
  version?: string;
  onProgress?: InstallRequest['onProgress'];
}

export interface EngineInstallOutcome {
  entry: ManifestEntry;
}

/** Install a managed engine binary per the catalog. */
export async function installEngine(req: EngineInstallRequest): Promise<EngineInstallOutcome> {
  const source = resolveEngineArtifact(req.engineId, 'win64', 'x64');
  // The IPC boundary accepts a string id. Keep malformed/legacy ids from
  // turning an unsupported lookup into a cryptic "reading enabled" crash.
  if (source === undefined) throw new Error(`unknown engine '${req.engineId}'`);
  if (!source.enabled) throw new Error(source.reason ?? 'engine download unavailable');
  if (source.kind !== 'v8-canary') {
    // sm/jsc install flows activate with their adapter todos (24/25).
    throw new Error(`installer for ${req.engineId} is not active yet`);
  }

  const variant = ENGINE_VARIANT[req.engineId] ?? 'rel';
  const version = req.version ?? (await fetchLatestV8Version(variant));

  const existing = await readManifest();
  const prior = existing.entries.find(
    (e) => e.kind === 'engine' && e.id === req.engineId && e.version === version
  );

  const entry = await installArtifact({
    entry: {
      kind: 'engine',
      id: req.engineId,
      platform: 'win64',
      arch: 'x64',
      version,
      url: v8ZipUrl(version, variant),
      sha256: prior?.sha256 ?? '',
      license: 'BSD-style (V8 LICENSE)',
      source: 'official-canary',
      customBuildRequired: false as const
    },
    source: {
      url: v8ZipUrl(version, variant),
      // Re-install of a previously recorded version verifies against the
      // recorded digest; first install enters record mode.
      sha256: prior?.sha256
    },
    onProgress: req.onProgress
  });
  return { entry };
}

/**
 * EXPERIMENTAL: resolve a historical V8 pin like "11.9" against the local
 * manifest/seed. Canary hosts publish no historical listing, so this NEVER
 * invents URLs — it only matches versions already known locally.
 */
export function guessMilestoneVersion(knownVersions: string[], milestone: string): string | null {
  const norm = (v: string): string => v.replace(/^v/, '');
  const prefix = norm(milestone);
  const matches = knownVersions.filter((v) => norm(v).startsWith(prefix));
  if (matches.length === 0) return null;
  return matches.sort((a, b) => norm(b).localeCompare(norm(a), undefined, { numeric: true }))[0] ?? null;
}
