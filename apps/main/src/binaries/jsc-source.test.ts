import { describe, expect, it, vi } from 'vitest';
import { resolveLatestJscRevisions } from './jsc-source.js';

describe('JavaScriptCore source resolution', () => {
  it('uses the injected fetch implementation for every discovery request', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/builders')) {
        return new Response(JSON.stringify({
          builders: [{ builderid: 7, name: 'WinCairo WKL-Release-Build' }]
        }));
      }
      if (url.includes('/builds?')) {
        return new Response(JSON.stringify({
          builds: [{ number: 10, properties: { got_revision: 'abcdef' } }]
        }));
      }
      if (url.endsWith('/commits/abcdef')) {
        return new Response(JSON.stringify({
          commit: { message: 'Build update\n\nCanonical link: https://commits.webkit.org/123456@main' }
        }));
      }
      return new Response('not found', { status: 404 });
    });

    await expect(resolveLatestJscRevisions(fetchImpl as typeof fetch)).resolves.toEqual([
      {
        url: 'https://s3-us-west-2.amazonaws.com/archives.webkit.org/wincairo-x86_64-release/123456@main.zip',
        revision: '123456'
      }
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});
