/**
 * Node.js runtime source (plan evidence fact 5):
 *   versions: https://nodejs.org/dist/index.json
 *   artifact: native Node archive (win.zip, linux.tar.xz, or darwin.tar.gz)
 *   checksum: https://nodejs.org/dist/v{ver}/SHASUMS256.txt
 */
import type { ManifestEntry } from '@rh/protocol';
import { parseShasums, findShasum } from '../../binaries/shasums.js';
import { detectSystemRuntime } from '../runtime-detection.js';
import { hostArch, hostPlatform } from '../../platform.js';

export interface NodeVersionInfo {
  version: string; // 'v22.17.0'
  lts: boolean;
  date: string;
}

/** Defensive parse: tolerate extra fields, drop malformed rows. */
export function parseNodeIndex(body: string): NodeVersionInfo[] {
  const parsed: unknown = JSON.parse(body);
  if (!Array.isArray(parsed)) return [];
  const out: NodeVersionInfo[] = [];
  for (const row of parsed) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    if (typeof r['version'] !== 'string' || !/^v\d+\.\d+\.\d+$/.test(r['version'])) continue;
    out.push({
      version: r['version'],
      lts: typeof r['lts'] === 'string' ? true : Boolean(r['lts']),
      date: typeof r['date'] === 'string' ? r['date'] : ''
    });
  }
  return out;
}

export async function listNodeVersions(): Promise<NodeVersionInfo[]> {
  const res = await fetch('https://nodejs.org/dist/index.json');
  if (!res.ok) throw new Error(`node index fetch failed: ${res.status}`);
  return parseNodeIndex(await res.text());
}

function nodeTargetPlatform(): 'win' | 'linux' | 'darwin' {
  const platform = hostPlatform();
  return platform === 'win64' ? 'win' : platform === 'linux64' ? 'linux' : 'darwin';
}

export function nodeArtifactName(version: string, platform = nodeTargetPlatform(), arch = hostArch()): string {
  // Node publishes zip archives for Windows and tar archives elsewhere.
  const extension = platform === 'win' ? 'zip' : platform === 'linux' ? 'tar.xz' : 'tar.gz';
  return `node-${version}-${platform}-${arch}.${extension}`;
}

export async function buildNodeInstall(
  version: string,
  onProgress?: (received: number, total: number | null) => void
): Promise<{ entry: Omit<ManifestEntry, 'installedPath' | 'addedAt'>; url: string; sha256: string; archive: 'zip' | 'tar.gz' | 'tar.xz' }> {
  const v = version.startsWith('v') ? version : `v${version}`;
  const platform = hostPlatform();
  const arch = hostArch();
  const nodePlatform = platform === 'win64' ? 'win' : platform === 'linux64' ? 'linux' : 'darwin';
  const filename = nodeArtifactName(v, nodePlatform, arch);
  const base = `https://nodejs.org/dist/${v}`;
  const shasumsRes = await fetch(`${base}/SHASUMS256.txt`);
  if (!shasumsRes.ok) throw new Error(`SHASUMS256.txt fetch failed: ${shasumsRes.status}`);
  const sha256 = findShasum(parseShasums(await shasumsRes.text()), filename);
  if (!sha256) throw new Error(`no sha256 for ${filename} in SHASUMS256.txt`);

  return {
    entry: {
      kind: 'runtime',
      id: 'node',
      platform,
      arch,
      version: v.replace(/^v/, ''),
      url: `${base}/${filename}`,
      sha256,
      license: 'MIT',
      source: 'official-dist',
      customBuildRequired: false as const
    },
    url: `${base}/${filename}`,
    sha256,
    archive: nodePlatform === 'win' ? 'zip' : nodePlatform === 'linux' ? 'tar.xz' : 'tar.gz'
  };
}

export interface DetectedNode {
  exePath: string;
  version: string;
}

/** Locate a system Node through the native command lookup utility. */
export function detectSystemNode(): Promise<DetectedNode | null> {
  return detectSystemRuntime('node');
}
