/**
 * Official standalone runtime/engine downloads discovered from GitHub
 * releases. These selectors currently target Windows x64 assets; the
 * controller rejects other hosts before reaching this module. GitHub's
 * sha256 asset digest is used whenever it is available.
 */
import type { ManifestEntry, RuntimeVersionRow } from '@rh/protocol';
import { installArtifact, type InstallRequest } from './binary-manager.js';

const GITHUB_API = 'https://api.github.com/repos';

type ReleaseRepo =
  | 'quickjs-ng/quickjs'
  | 'saghul/txiki.js'
  | 'oracle/graaljs'
  | 'facebook/hermes'
  | 'chakra-core/ChakraCore'
  | 'Moddable-OpenSource/moddable';

interface ReleaseAsset {
  name?: string;
  browser_download_url?: string;
  digest?: string | null;
}

interface GitHubRelease {
  tag_name?: string;
  published_at?: string | null;
  body?: string | null;
  assets?: ReleaseAsset[];
}

export interface StandaloneInstallSpec {
  entry: Omit<ManifestEntry, 'installedPath' | 'addedAt'>;
  source: InstallRequest['source'];
  archive: NonNullable<InstallRequest['archive']>;
  executablePath?: string;
}

async function releaseFor(repo: ReleaseRepo, tag: string | undefined, fetchImpl: typeof fetch = fetch): Promise<GitHubRelease> {
  const endpoint = tag === undefined
    ? `${GITHUB_API}/${repo}/releases/latest`
    : `${GITHUB_API}/${repo}/releases/tags/${encodeURIComponent(tag)}`;
  const res = await fetchImpl(endpoint, {
    headers: { 'User-Agent': 'RuntimeHell', Accept: 'application/vnd.github+json' }
  });
  if (!res.ok) throw new Error(`${repo} release lookup failed: ${res.status}`);
  return (await res.json()) as GitHubRelease;
}

async function releases(repo: ReleaseRepo, fetchImpl: typeof fetch = fetch): Promise<GitHubRelease[]> {
  const res = await fetchImpl(`${GITHUB_API}/${repo}/releases?per_page=30`, {
    headers: { 'User-Agent': 'RuntimeHell', Accept: 'application/vnd.github+json' }
  });
  if (!res.ok) throw new Error(`${repo} releases fetch failed: ${res.status}`);
  const body = (await res.json()) as unknown;
  return Array.isArray(body) ? (body as GitHubRelease[]) : [];
}

function releaseVersion(tag: string | undefined): string | null {
  const match = /(?:^|[^\d])(\d+\.\d+\.\d+(?:\.\d+)?)(?:$|[^\d])/.exec(tag ?? '');
  return match?.[1] ?? null;
}

function sha256Digest(asset: ReleaseAsset): string | undefined {
  const digest = asset.digest ?? '';
  const match = /^sha256:([a-f0-9]{64})$/i.exec(digest.trim());
  return match?.[1]?.toLowerCase();
}

function selectAsset(release: GitHubRelease, predicate: (name: string) => boolean, label: string): ReleaseAsset {
  const asset = (release.assets ?? []).find((candidate) => typeof candidate.name === 'string' && predicate(candidate.name));
  if (asset?.name === undefined || asset.browser_download_url === undefined) {
    throw new Error(`no Windows x64 ${label} asset in the latest release`);
  }
  return asset;
}

function versionOrThrow(release: GitHubRelease, label: string): string {
  const version = releaseVersion(release.tag_name);
  if (version === null) throw new Error(`${label} release tag has no semantic version`);
  return version;
}

function buildEntry(
  kind: 'runtime' | 'engine',
  id: string,
  version: string,
  asset: ReleaseAsset,
  license: string
): Omit<ManifestEntry, 'installedPath' | 'addedAt'> {
  return {
    kind,
    id,
    platform: 'win64',
    arch: 'x64',
    version,
    url: asset.browser_download_url ?? '',
    sha256: sha256Digest(asset) ?? '',
    license,
    source: 'official-dist',
    customBuildRequired: false as const
  };
}

export async function buildQuickJsInstall(fetchImpl: typeof fetch = fetch): Promise<StandaloneInstallSpec> {
  const release = await releaseFor('quickjs-ng/quickjs', undefined, fetchImpl);
  const asset = selectAsset(release, (name) => /^qjs-windows-x86_64\.exe$/i.test(name), 'QuickJS-ng executable');
  const version = versionOrThrow(release, 'QuickJS-ng');
  return {
    entry: buildEntry('engine', 'quickjs', version, asset, 'MIT'),
    source: { url: asset.browser_download_url ?? '', ...(sha256Digest(asset) ? { sha256: sha256Digest(asset) } : {}) },
    archive: 'file'
  };
}

export async function buildTxikiInstall(version?: string, fetchImpl: typeof fetch = fetch): Promise<StandaloneInstallSpec> {
  const release = await releaseFor('saghul/txiki.js', version === undefined ? undefined : `v${version.replace(/^v/, '')}`, fetchImpl);
  const asset = selectAsset(release, (name) => /^txiki-windows-x86_64\.zip$/i.test(name), 'txiki.js archive');
  const resolvedVersion = versionOrThrow(release, 'txiki.js');
  return {
    entry: buildEntry('runtime', 'txiki', resolvedVersion, asset, 'MIT'),
    source: { url: asset.browser_download_url ?? '', ...(sha256Digest(asset) ? { sha256: sha256Digest(asset) } : {}) },
    archive: 'zip'
  };
}

export async function buildGraalJsInstall(fetchImpl: typeof fetch = fetch): Promise<StandaloneInstallSpec> {
  const release = await releaseFor('oracle/graaljs', undefined, fetchImpl);
  const asset = selectAsset(
    release,
    (name) => /^graaljs-\d+(?:\.\d+)+-windows-amd64\.zip$/i.test(name),
    'GraalJS archive'
  );
  const version = versionOrThrow(release, 'GraalJS');
  return {
    entry: buildEntry('engine', 'graaljs', version, asset, 'GFTC / UPL'),
    source: { url: asset.browser_download_url ?? '', ...(sha256Digest(asset) ? { sha256: sha256Digest(asset) } : {}) },
    archive: 'zip',
    executablePath: 'bin/js.exe'
  };
}

export async function buildHermesInstall(fetchImpl: typeof fetch = fetch): Promise<StandaloneInstallSpec> {
  const release = await releaseFor('facebook/hermes', undefined, fetchImpl);
  const asset = selectAsset(
    release,
    (name) => /^hermes-cli-windows(?:-v\d+(?:\.\d+)+)?\.(?:tgz|tar\.gz)$/i.test(name),
    'Hermes CLI archive'
  );
  const version = versionOrThrow(release, 'Hermes');
  return {
    entry: buildEntry('engine', 'hermes', version, asset, 'MIT'),
    source: { url: asset.browser_download_url ?? '', ...(sha256Digest(asset) ? { sha256: sha256Digest(asset) } : {}) },
    archive: 'tar.gz'
  };
}

export async function buildModdableXsInstall(fetchImpl: typeof fetch = fetch): Promise<StandaloneInstallSpec> {
  const release = await releaseFor('Moddable-OpenSource/moddable', undefined, fetchImpl);
  const asset = selectAsset(release, (name) => /^moddable-tools-win64\.zip$/i.test(name), 'Moddable XS tools archive');
  const version = versionOrThrow(release, 'Moddable XS');
  return {
    entry: buildEntry('engine', 'moddable-xs', version, asset, 'BSD-style (Moddable)'),
    source: { url: asset.browser_download_url ?? '', ...(sha256Digest(asset) ? { sha256: sha256Digest(asset) } : {}) },
    archive: 'zip',
    executablePath: 'xst.exe'
  };
}

export async function buildChakraInstall(fetchImpl: typeof fetch = fetch): Promise<StandaloneInstallSpec> {
  const release = await releaseFor('chakra-core/ChakraCore', undefined, fetchImpl);
  const version = versionOrThrow(release, 'ChakraCore');
  const body = release.body ?? '';
  const url = /https:\/\/aka\.ms\/chakracore\/cc_windows_all_[a-z0-9_/-]+/i.exec(body)?.[0]
    ?? `https://aka.ms/chakracore/cc_windows_all_${version.replace(/\./g, '_')}`;
  const checksum = /Windows \(all\)[^\n]*?([a-f0-9]{64})/i.exec(body)?.[1]?.toLowerCase();
  if (checksum === undefined) throw new Error('ChakraCore release has no published Windows sha256');
  const asset: ReleaseAsset = {
    name: `ChakraCore-${version}-windows.zip`,
    browser_download_url: url,
    digest: `sha256:${checksum}`
  };
  return {
    entry: buildEntry('engine', 'chakra', version, asset, 'MIT'),
    source: { url, sha256: checksum },
    archive: 'zip'
  };
}

export async function installStandalone(spec: StandaloneInstallSpec, onProgress?: InstallRequest['onProgress']): Promise<ManifestEntry> {
  return installArtifact({
    entry: spec.entry,
    source: spec.source,
    archive: spec.archive,
    ...(spec.executablePath !== undefined ? { executablePath: spec.executablePath } : {}),
    onProgress
  });
}

export async function installQuickJsEngine(onProgress?: InstallRequest['onProgress']): Promise<ManifestEntry> {
  const spec = await buildQuickJsInstall();
  return installStandalone(spec, onProgress);
}

export async function installGraalJsEngine(onProgress?: InstallRequest['onProgress']): Promise<ManifestEntry> {
  const spec = await buildGraalJsInstall();
  return installStandalone(spec, onProgress);
}

export async function installHermesEngine(onProgress?: InstallRequest['onProgress']): Promise<ManifestEntry> {
  const spec = await buildHermesInstall();
  return installStandalone(spec, onProgress);
}

export async function installModdableXsEngine(onProgress?: InstallRequest['onProgress']): Promise<ManifestEntry> {
  const spec = await buildModdableXsInstall();
  return installStandalone(spec, onProgress);
}

export async function installChakraEngine(onProgress?: InstallRequest['onProgress']): Promise<ManifestEntry> {
  const spec = await buildChakraInstall();
  return installStandalone(spec, onProgress);
}

export async function installTxikiRuntime(onProgress?: InstallRequest['onProgress']): Promise<ManifestEntry> {
  const spec = await buildTxikiInstall();
  return installStandalone(spec, onProgress);
}

export async function listTxikiVersions(fetchImpl: typeof fetch = fetch): Promise<RuntimeVersionRow[]> {
  const rows = await releases('saghul/txiki.js', fetchImpl);
  return rows.flatMap((release) => {
    const version = releaseVersion(release.tag_name);
    return version === null ? [] : [{ version, date: release.published_at ?? '' }];
  });
}
