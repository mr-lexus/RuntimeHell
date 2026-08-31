import { describe, expect, it } from 'vitest';
import { buildChakraInstall, buildGraalJsInstall, buildHermesInstall, buildModdableXsInstall, buildQuickJsInstall, buildTxikiInstall } from './standalone-downloader.js';

const sha = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';

function mockFetch(payload: unknown): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.includes('/releases/')) throw new Error(`unexpected fetch: ${url}`);
    return new Response(JSON.stringify(payload), { status: 200 });
  }) as typeof fetch;
}

describe('standalone release installers', () => {
  it('selects the QuickJS-ng Windows executable and its GitHub sha256 digest', async () => {
    const spec = await buildQuickJsInstall(mockFetch({
      tag_name: 'v0.15.1',
      assets: [{ name: 'qjs-windows-x86_64.exe', browser_download_url: 'https://example.test/qjs.exe', digest: `sha256:${sha}` }]
    }));
    expect(spec.entry.id).toBe('quickjs');
    expect(spec.entry.version).toBe('0.15.1');
    expect(spec.archive).toBe('file');
    expect(spec.source.sha256).toBe(sha);
  });

  it('resolves a pinned txiki.js release instead of silently installing latest', async () => {
    const spec = await buildTxikiInstall('26.4.0', mockFetch({
      tag_name: 'v26.4.0',
      assets: [{ name: 'txiki-windows-x86_64.zip', browser_download_url: 'https://example.test/txiki.zip' }]
    }));
    expect(spec.entry.id).toBe('txiki');
    expect(spec.entry.version).toBe('26.4.0');
    expect(spec.source.sha256).toBeUndefined();
  });

  it('selects the native GraalJS distribution and materializes bin/js.exe', async () => {
    const spec = await buildGraalJsInstall(mockFetch({
      tag_name: 'graal-25.3.4.1',
      assets: [{ name: 'graaljs-25.3.4.1-windows-amd64.zip', browser_download_url: 'https://example.test/graal.zip', digest: `sha256:${sha}` }]
    }));
    expect(spec.entry.id).toBe('graaljs');
    expect(spec.executablePath).toBe('bin/js.exe');
    expect(spec.source.sha256).toBe(sha);
  });

  it('selects the Windows Hermes CLI archive', async () => {
    const spec = await buildHermesInstall(mockFetch({
      tag_name: 'v0.13.0',
      assets: [{ name: 'hermes-cli-windows.tar.gz', browser_download_url: 'https://example.test/hermes.tar.gz', digest: `sha256:${sha}` }]
    }));
    expect(spec.entry.id).toBe('hermes');
    expect(spec.archive).toBe('tar.gz');
  });

  it('keeps supporting versioned Hermes tgz assets', async () => {
    const spec = await buildHermesInstall(mockFetch({
      tag_name: 'v0.12.0',
      assets: [{ name: 'hermes-cli-windows-v0.12.0.tgz', browser_download_url: 'https://example.test/hermes.tgz' }]
    }));
    expect(spec.entry.version).toBe('0.12.0');
    expect(spec.archive).toBe('tar.gz');
  });

  it('selects the official Moddable XS Windows tools archive', async () => {
    const spec = await buildModdableXsInstall(mockFetch({
      tag_name: '9.0.0',
      assets: [{ name: 'moddable-tools-win64.zip', browser_download_url: 'https://example.test/moddable.zip', digest: `sha256:${sha}` }]
    }));
    expect(spec.entry.id).toBe('moddable-xs');
    expect(spec.entry.version).toBe('9.0.0');
    expect(spec.executablePath).toBe('xst.exe');
    expect(spec.source.sha256).toBe(sha);
  });

  it('resolves the official ChakraCore Azure binary and release checksum', async () => {
    const spec = await buildChakraInstall(mockFetch({
      tag_name: 'v1.11.24',
      body: 'Windows (all) | [download](https://aka.ms/chakracore/cc_windows_all_1_11_24) | `ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789`'
    }));
    expect(spec.entry.id).toBe('chakra');
    expect(spec.entry.version).toBe('1.11.24');
    expect(spec.source.url).toBe('https://aka.ms/chakracore/cc_windows_all_1_11_24');
    expect(spec.source.sha256).toBe(sha);
  });
});
