/**
 * JavaScriptCore source resolution (plan todo 25, evidence-fact style):
 * revision discovered LIVE from WebKit's public Buildbot (wincairo WKL
 * release builder), artifact from the official archives.webkit.org S3 bucket
 * — the exact scheme jsvu uses (verified against jsvu@latest predict-url.js).
 *
 * The latest build's artifact may be private/expired (403), so we walk back
 * through recent builds until one downloads successfully. No checksums are
 * published upstream ⇒ record-mode sha256 (observed digest pinned).
 */
import type { ManifestEntry } from '@rh/protocol';

const BUILDBOT_BUILDERS = 'https://build.webkit.org/api/v2/builders';
const BUILDBOT_BUILDS = 'https://build.webkit.org/api/v2/builds';
const ARCHIVE_BASE = 'https://s3-us-west-2.amazonaws.com/archives.webkit.org/wincairo-x86_64-release';

export interface JscSource {
  url: string;
  revision: string;
}

interface BuilderListResponse {
  builders?: { builderid: number; name: string }[];
}
interface BuildsResponse {
  builds?: {
    number: number;
    properties?: Record<string, unknown>;
  }[];
}

async function jsonGet(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { 'User-Agent': 'RuntimeHell' } });
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  return (await res.json()) as unknown;
}

/** Find the wincairo x86_64 RELEASE *build* builder (produces jsc). */
export async function findWinCairoReleaseBuilder(
  fetchImpl: typeof fetch = fetch
): Promise<{ builderid: number; name: string } | null> {
  const data = (await jsonGet(BUILDBOT_BUILDERS)) as BuilderListResponse;
  const builders = data.builders ?? [];
  // Preferred: the WKL release build (full tree → ships jsc.exe).
  const preferred = builders.find((b) => /wincairo/i.test(b.name) && /wkl-release-build/i.test(b.name));
  if (preferred !== undefined) return preferred;
  return (
    builders.find(
      (b) => /wincairo/i.test(b.name) && /release/i.test(b.name) && /build/i.test(b.name) && !/arm/i.test(b.name)
    ) ?? null
  );
}

function extractGotRevision(build: { properties?: Record<string, unknown> }): string | null {
  const props = build.properties ?? {};
  for (const [key, value] of Object.entries(props)) {
    if (key === 'got_revision') {
      return Array.isArray(value) ? String(value[0]) : String(value);
    }
  }
  return null;
}

/**
 * Return candidate revisions, NEWEST FIRST. Callers try each URL in order —
 * the newest may 403/404 (expired artifact) while older ones succeed.
 */
export async function resolveLatestJscRevisions(fetchImpl: typeof fetch = fetch): Promise<JscSource[]> {
  const builder = await findWinCairoReleaseBuilder(fetchImpl);
  if (!builder) throw new Error('wincairo release builder not found on build.webkit.org');
  const url = `${BUILDBOT_BUILDS}?builderid=${builder.builderid}&order=-number&limit=10&complete=true&property=got_revision`;
  const data = (await jsonGet(url)) as BuildsResponse;

  const out: JscSource[] = [];
  for (const build of data.builds ?? []) {
    const hash = extractGotRevision(build);
    if (hash === null) continue;
    try {
      const commitRes = await fetch(`https://api.github.com/repos/WebKit/WebKit/commits/${hash}`, {
        headers: { 'User-Agent': 'RuntimeHell' }
      });
      if (!commitRes.ok) continue;
      const body = (await commitRes.json()) as { commit?: { message?: string } };
      const canonical = /Canonical link: https:\/\/commits\.webkit\.org\/(\d+)@main/.exec(body.commit?.message ?? '');
      if (canonical?.[1] === undefined) continue;
      out.push({
        url: `${ARCHIVE_BASE}/${canonical[1]}@main.zip`,
        revision: canonical[1]
      });
    } catch {
      /* skip unresolvable candidates */
    }
  }
  if (out.length === 0) throw new Error('could not determine any WebKit revisions from recent wincairo builds');
  return out;
}

export function buildJscInstall(revision: string, sha256: string): Omit<ManifestEntry, 'installedPath' | 'addedAt'> {
  return {
    kind: 'engine',
    id: 'javascriptcore',
    platform: 'win64',
    arch: 'x64',
    version: revision,
    url: `${ARCHIVE_BASE}/${revision}@main.zip`,
    sha256,
    license: 'LGPL-2.1 + BSD mix',
    source: 'taskcluster', // closest enum: community CI build (jsvu-compatible)
    customBuildRequired: false as const
  };
}
