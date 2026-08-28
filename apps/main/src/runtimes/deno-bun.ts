/**
 * Deno + Bun runtime adapters (plan todo 27).
 *
 * Both runtimes execute TS natively — TranspileService is bypassed when
 * `capabilities.supportsTypeScriptNative` is true. Download URLs verified:
 *   Deno: https://github.com/denoland/deno/releases (deno-x86_64-pc-windows-msvc.zip)
 *   Bun:  https://github.com/oven-sh/bun/releases     (bun-windows-x64.zip)
 * Checksums: Deno publishes a `.sha256sum` sidecar per asset; Bun exposes the
 * asset digest via the GitHub releases API (`sha256:`-prefixed).
 */
import type { ManifestEntry, RuntimeVersionRow } from '@rh/protocol';
import type { RuntimeCapabilities } from '@rh/protocol';

export interface DenoBunCapabilities {
  readonly supportsTypeScriptNative: boolean;
  readonly supportsNpm: boolean;
  readonly supportsCommonJS: boolean;
  readonly supportsESM: boolean;
}

export const DENO_CAPS: DenoBunCapabilities = {
  supportsTypeScriptNative: true,
  supportsNpm: true, // via npm: specifiers
  supportsCommonJS: false,
  supportsESM: true
};

export const BUN_CAPS: DenoBunCapabilities = {
  supportsTypeScriptNative: true,
  supportsNpm: true, // bun install compatible
  supportsCommonJS: true,
  supportsESM: true
};

/** Deno permission flags mapped from UI checkboxes (default deny). */
export interface DenoPermissions {
  allowAll: boolean;
  allowRead: boolean;
  allowWrite: boolean;
  allowNet: boolean;
  allowEnv: boolean;
  allowRun: boolean;
}

export function denoPermissionFlags(perms: DenoPermissions): string[] {
  if (perms.allowAll) return ['--allow-all'];
  const flags: string[] = [];
  if (perms.allowRead) flags.push('--allow-read');
  if (perms.allowWrite) flags.push('--allow-write');
  if (perms.allowNet) flags.push('--allow-net');
  if (perms.allowEnv) flags.push('--allow-env');
  if (perms.allowRun) flags.push('--allow-run');
  return flags;
}

export function denoArtifactName(version: string): string {
  return `deno-x86_64-pc-windows-msvc.zip`;
}

export function denoDownloadUrl(version: string): string {
  const v = version.startsWith('v') ? version : `v${version}`;
  return `https://github.com/denoland/deno/releases/download/${v}/deno-x86_64-pc-windows-msvc.zip`;
}

export function bunArtifactName(version: string): string {
  return `bun-windows-x64.zip`;
}

export function bunDownloadUrl(version: string): string {
  const v = version.startsWith('v') ? version : `v${version}`;
  // Bun release tags are `bun-vX.Y.Z` (unlike Deno's plain `vX.Y.Z`).
  return `https://github.com/oven-sh/bun/releases/download/bun-${v}/bun-windows-x64.zip`;
}

// --- version listing (GitHub releases API) --------------------------------

const GITHUB_RELEASES = 'https://api.github.com/repos';

/** Parse GitHub releases JSON into version rows (defensive: drop malformed rows). */
export function parseGitHubReleases(body: string, tagPrefix: string | RegExp): RuntimeVersionRow[] {
  const parsed: unknown = JSON.parse(body);
  if (!Array.isArray(parsed)) return [];
  const out: RuntimeVersionRow[] = [];
  for (const row of parsed) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    if (typeof r['tag_name'] !== 'string') continue;
    const version = r['tag_name'].replace(tagPrefix, '');
    if (!/^\d+\.\d+\.\d+$/.test(version)) continue;
    out.push({ version, date: typeof r['published_at'] === 'string' ? r['published_at'] : '' });
  }
  return out;
}

export async function listDenoVersions(): Promise<RuntimeVersionRow[]> {
  const res = await fetch(`${GITHUB_RELEASES}/denoland/deno/releases?per_page=30`);
  if (!res.ok) throw new Error(`deno releases fetch failed: ${res.status}`);
  return parseGitHubReleases(await res.text(), /^v/);
}

export async function listBunVersions(): Promise<RuntimeVersionRow[]> {
  const res = await fetch(`${GITHUB_RELEASES}/oven-sh/bun/releases?per_page=30`);
  if (!res.ok) throw new Error(`bun releases fetch failed: ${res.status}`);
  return parseGitHubReleases(await res.text(), /^bun-v/);
}

// --- install builders (mirror buildNodeInstall) ---------------------------

export interface RuntimeInstallSpec {
  entry: Omit<ManifestEntry, 'installedPath' | 'addedAt'>;
  url: string;
  sha256: string;
}

/** Deno: sha256 from the `.sha256sum` sidecar published next to the zip. */
export async function buildDenoInstall(version: string): Promise<RuntimeInstallSpec> {
  const v = version.startsWith('v') ? version : `v${version}`;
  const url = denoDownloadUrl(v);
  const sidecar = await fetch(`${url}.sha256sum`);
  if (!sidecar.ok) throw new Error(`deno sha256 sidecar fetch failed: ${sidecar.status}`);
  const sha256 = (await sidecar.text()).trim().split(/\s+/)[0] ?? '';
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error(`invalid deno sha256: ${sha256}`);
  return {
    entry: {
      kind: 'runtime',
      id: 'deno',
      platform: 'win64',
      arch: 'x64',
      version: v.replace(/^v/, ''),
      url,
      sha256,
      license: 'MIT',
      source: 'official-dist',
      customBuildRequired: false as const
    },
    url,
    sha256
  };
}

/** Bun: sha256 from the release asset digest (`sha256:`-prefixed) via the API. */
export async function buildBunInstall(version: string): Promise<RuntimeInstallSpec> {
  const v = version.startsWith('v') ? version : `v${version}`;
  const url = bunDownloadUrl(v);
  const res = await fetch(`${GITHUB_RELEASES}/oven-sh/bun/releases/tags/bun-${v}`);
  if (!res.ok) throw new Error(`bun release lookup failed: ${res.status}`);
  const data = (await res.json()) as { assets?: Array<{ name?: string; digest?: string }> };
  const asset = data.assets?.find((a) => a.name === 'bun-windows-x64.zip');
  const sha256 = (asset?.digest ?? '').replace(/^sha256:/, '');
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error(`invalid bun sha256: ${sha256}`);
  return {
    entry: {
      kind: 'runtime',
      id: 'bun',
      platform: 'win64',
      arch: 'x64',
      version: v.replace(/^v/, ''),
      url,
      sha256,
      license: 'MIT',
      source: 'official-dist',
      customBuildRequired: false as const
    },
    url,
    sha256
  };
}
