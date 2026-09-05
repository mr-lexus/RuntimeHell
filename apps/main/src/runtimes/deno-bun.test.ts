/**
 * Deno/Bun version listing + install-builder unit tests (feature).
 * Network is mocked: parseGitHubReleases is pure; build*Install fetch the
 * sha256 sidecar / release digest respectively.
 */
import { describe, expect, it, vi } from 'vitest';
import { buildBunInstall, buildDenoInstall, bunArtifactName, denoArtifactName, parseDenoSha256, parseGitHubReleases } from './deno-bun.js';

describe('parseGitHubReleases', () => {
  it('maps tag_name rows to version rows, dropping malformed entries', () => {
    const body = JSON.stringify([
      { tag_name: 'v2.3.4', published_at: '2026-01-01T00:00:00Z' },
      { tag_name: 'v2.3.3', published_at: '2025-12-01T00:00:00Z' },
      { tag_name: 'not-a-version', published_at: '2025-01-01T00:00:00Z' },
      { tag_name: 'v1.2.3' } // missing published_at
    ]);
    expect(parseGitHubReleases(body, /^v/)).toEqual([
      { version: '2.3.4', date: '2026-01-01T00:00:00Z' },
      { version: '2.3.3', date: '2025-12-01T00:00:00Z' },
      { version: '1.2.3', date: '' }
    ]);
  });

  it('strips the bun-v tag prefix', () => {
    const body = JSON.stringify([{ tag_name: 'bun-v1.2.3', published_at: '2026-01-01T00:00:00Z' }]);
    expect(parseGitHubReleases(body, /^bun-v/)).toEqual([{ version: '1.2.3', date: '2026-01-01T00:00:00Z' }]);
  });

  it('returns [] for non-array payloads', () => {
    expect(parseGitHubReleases('{"not":"array"}', /^v/)).toEqual([]);
  });
});

describe('buildDenoInstall', () => {
  it('parses the PowerShell Get-FileHash sidecar published for Windows', () => {
    expect(parseDenoSha256('Algorithm : SHA256\nHash      : ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789\nPath      : C:\\deno.zip\n'))
      .toBe('abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789');
  });

  it('parses the standard hash-and-filename sidecar format', () => {
    expect(parseDenoSha256('abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789  deno.zip\n'))
      .toBe('abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789');
  });

  it('parses a checksum surrounded by sidecar metadata', () => {
    expect(parseDenoSha256('Algorithm=SHA256\nchecksum: ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789\n'))
      .toBe('abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789');
  });

  it('builds an entry from the .sha256sum sidecar', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.endsWith('.sha256sum')) {
        return new Response(`  abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789  ${denoArtifactName('2.3.4')}\n`);
      }
      throw new Error(`unexpected fetch: ${u}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const spec = await buildDenoInstall('2.3.4');
      expect(spec.entry.id).toBe('deno');
      expect(spec.entry.version).toBe('2.3.4');
      expect(spec.entry.url).toContain(`/v2.3.4/${denoArtifactName('2.3.4')}`);
      expect(spec.sha256).toBe('abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789');
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('.sha256sum'));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rejects a malformed sidecar', async () => {
    vi.stubGlobal('fetch', async () => new Response('garbage'));
    try {
      await expect(buildDenoInstall('2.3.4')).rejects.toThrow(/invalid deno sha256/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('buildBunInstall', () => {
  it('builds an entry from the release asset digest (sha256: prefix stripped)', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes('/releases/tags/bun-')) {
        return new Response(
          JSON.stringify({
            assets: [
              { name: bunArtifactName('1.2.3'), digest: 'sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789' },
              { name: `${bunArtifactName('1.2.3')}.sig`, digest: 'sha256:0000000000000000000000000000000000000000000000000000000000000000' }
            ]
          })
        );
      }
      throw new Error(`unexpected fetch: ${u}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const spec = await buildBunInstall('1.2.3');
      expect(spec.entry.id).toBe('bun');
      expect(spec.entry.version).toBe('1.2.3');
      expect(spec.entry.url).toContain(`/bun-v1.2.3/${bunArtifactName('1.2.3')}`);
      expect(spec.sha256).toBe('abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rejects a missing digest', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ assets: [] })));
    try {
      await expect(buildBunInstall('1.2.3')).rejects.toThrow(/invalid bun sha256/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
