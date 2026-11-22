import { expect, it, vi } from 'vitest';
import { resolveLatestJscRevisions } from './jsc-source.js';

it('resolves published main revisions from the Windows release builder', async () => {
  const fetchImpl = vi.fn(async (url: string | URL | Request) => {
    if (!String(url).includes('/builders/Windows-64-bit-Release-Build/builds?')) return new Response(null, { status: 404 });
    const builds = ['327569@main', 'bad/revision', '327568@main', '327568@main'].map((revision) => ({
      properties: { archive_revision: [revision, 'Unknown'] }
    }));
    return Response.json({ builds });
  });
  expect(await resolveLatestJscRevisions(fetchImpl)).toEqual(['327569', '327568'].map((revision) => ({
    revision, url: `https://s3-us-west-2.amazonaws.com/archives.webkit.org/win-x86_64-release/${revision}@main.zip`
  })));
});
