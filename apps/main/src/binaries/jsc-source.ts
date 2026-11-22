const BUILDS = 'https://build.webkit.org/api/v2/builders/Windows-64-bit-Release-Build/builds';
const ARCHIVES = 'https://s3-us-west-2.amazonaws.com/archives.webkit.org/win-x86_64-release';

export interface JscSource { url: string; revision: string }

export async function resolveLatestJscRevisions(fetchImpl: typeof fetch = fetch): Promise<JscSource[]> {
  const response = await fetchImpl(`${BUILDS}?complete=true&results=0&order=-number&limit=10&property=archive_revision`, {
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) throw new Error(`WebKit build lookup failed: ${response.status}`);
  const data = await response.json() as { builds?: { properties?: { archive_revision?: unknown } }[] };
  const revisions = new Set<string>();
  for (const build of data.builds ?? []) {
    const property = build.properties?.archive_revision;
    const revision = Array.isArray(property) && typeof property[0] === 'string' ? /^(\d+)@main$/.exec(property[0])?.[1] : undefined;
    if (revision) revisions.add(revision);
  }
  if (!revisions.size) throw new Error('No published Windows x64 release revision found on WebKit Buildbot');
  return [...revisions].map((revision) => ({ revision, url: `${ARCHIVES}/${revision}@main.zip` }));
}
