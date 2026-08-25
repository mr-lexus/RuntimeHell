/**
 * SpiderMonkey source resolution (plan todo 24, evidence fact 2).
 *
 * Primary: Mozilla taskcluster "latest" index for the win64 jsshell artifact
 * (same host jsvu uses). The index entry carries the task id; the artifact is
 * fetched from firefox-ci-tc services. Mozilla publishes NO checksums for
 * these zips → record-mode sha256 (identical to the V8 canary policy).
 *
 * Fallback (implemented, used automatically on primary failure): drive the
 * official archive.mozilla.org release listing for the pinned ESR version.
 */
import type { ManifestEntry } from '@rh/protocol';

export const SM_TASKCLUSTER_INDEX =
  'https://firefox-ci-tc.services.mozilla.com/api/index/v1/task/gecko.v2.mozilla-central.latest.source.source-jsshell-win64';
export const SM_TASKCLUSTER_ARTIFACT =
  SM_TASKCLUSTER_INDEX + '/artifacts/public/build/jsshell-win64.zip';
export const MOZILLA_VERSIONS_API =
  'https://product-details.mozilla.org/1.0/firefox_versions.json';

export interface SmSource {
  url: string;
  /** Version label recorded in the manifest ('latest-<taskId>' or ESR ver). */
  version: string;
}

async function currentEsr(fetchImpl: typeof fetch): Promise<string | null> {
  try {
    const res = await fetchImpl('https://product-details.mozilla.org/1.0/firefox_versions.json');
    if (!res.ok) return null;
    const body = (await res.json()) as { FIREFOX_ESR?: string };
    return typeof body.FIREFOX_ESR === 'string' && body.FIREFOX_ESR !== '' ? body.FIREFOX_ESR : null;
  } catch {
    return null;
  }
}

/** Resolve a downloadable jsshell zip, trying taskcluster then archive. */
export async function resolveSmSource(fetchImpl: typeof fetch = fetch): Promise<SmSource> {
  // Primary: taskcluster latest — probe the index endpoint first so failures
  // fall through quickly instead of downloading a giant error page.
  try {
    const idx = await fetchImpl(SM_TASKCLUSTER_INDEX);
    if (idx.ok) {
      const body = (await idx.json()) as { taskId?: string };
      if (typeof body.taskId === 'string' && body.taskId.length > 0) {
        return { url: SM_TASKCLUSTER_ARTIFACT, version: `latest-${body.taskId.slice(0, 8)}` };
      }
    }
  } catch {
    /* fall through to archive */
  }

  // Fallback: current ESR release directory (verified live during t24 QA:
  // /pub/firefox/releases/<ver>/jsshell/jsshell-win64.zip).
  const esr = await currentEsr(fetchImpl);
  if (esr !== null) {
    return {
      url: `https://archive.mozilla.org/pub/firefox/releases/${esr}/jsshell/jsshell-win64.zip`,
      version: esr
    };
  }
  throw new Error('unable to resolve a SpiderMonkey jsshell source (taskcluster + archive both failed)');
}

export function buildSmInstall(
  source: SmSource,
  sha256: string
): Omit<ManifestEntry, 'installedPath' | 'addedAt'> {
  return {
    kind: 'engine',
    id: 'spidermonkey',
    platform: 'win64',
    arch: 'x64',
    version: source.version,
    url: source.url,
    sha256,
    license: 'MPL-2.0',
    source: 'taskcluster',
    customBuildRequired: false as const
  };
}
