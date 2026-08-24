/**
 * Node.js runtime source (plan evidence fact 5):
 *   versions: https://nodejs.org/dist/index.json
 *   artifact: https://nodejs.org/dist/v{ver}/node-v{ver}-win-x64.zip
 *   checksum: https://nodejs.org/dist/v{ver}/SHASUMS256.txt
 */
import { spawn } from 'node:child_process';
import type { ManifestEntry } from '@rh/protocol';
import { parseShasums, findShasum } from '../../binaries/shasums.js';

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

export function nodeArtifactName(version: string, platform = 'win', arch = 'x64'): string {
  // v22.17.0 -> node-v22.17.0-win-x64.zip
  return `node-${version}-${platform}-${arch}.zip`;
}

export async function buildNodeInstall(
  version: string,
  onProgress?: (received: number, total: number | null) => void
): Promise<{ entry: Omit<ManifestEntry, 'installedPath' | 'addedAt'>; url: string; sha256: string }> {
  const v = version.startsWith('v') ? version : `v${version}`;
  const filename = nodeArtifactName(v);
  const base = `https://nodejs.org/dist/${v}`;
  const shasumsRes = await fetch(`${base}/SHASUMS256.txt`);
  if (!shasumsRes.ok) throw new Error(`SHASUMS256.txt fetch failed: ${shasumsRes.status}`);
  const sha256 = findShasum(parseShasums(await shasumsRes.text()), filename);
  if (!sha256) throw new Error(`no sha256 for ${filename} in SHASUMS256.txt`);

  return {
    entry: {
      kind: 'runtime',
      id: 'node',
      platform: 'win64',
      arch: 'x64',
      version: v.replace(/^v/, ''),
      url: `${base}/${filename}`,
      sha256,
      license: 'MIT',
      source: 'official-dist',
      customBuildRequired: false as const
    },
    url: `${base}/${filename}`,
    sha256
  };
}

export interface DetectedNode {
  exePath: string;
  version: string;
}

/** Locate a system Node via where.exe; returns null when absent. */
export function detectSystemNode(): Promise<DetectedNode | null> {
  return new Promise((resolve) => {
    const child = spawn('where.exe', ['node'], { windowsHide: true });
    let out = '';
    child.stdout?.on('data', (d) => {
      out += String(d);
    });
    child.on('error', () => resolve(null));
    child.on('close', (code) => {
      if (code !== 0) return resolve(null);
      const first = out.split(/\r?\n/).find((l) => l.trim().toLowerCase().endsWith('.exe'));
      if (!first) return resolve(null);
      const exePath = first.trim();
      const ver = spawn(exePath, ['--version'], { windowsHide: true });
      let vout = '';
      ver.stdout?.on('data', (d) => {
        vout += String(d);
      });
      ver.on('error', () => resolve(null));
      ver.on('close', (vc) => {
        if (vc !== 0) return resolve(null);
        resolve({ exePath, version: vout.trim().replace(/^v/, '') });
      });
    });
  });
}
