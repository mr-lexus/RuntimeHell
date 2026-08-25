/**
 * SpiderMonkey network integration (plan todo 24 QA).
 * Gated by RH_NET_TESTS=1. Downloads the real win64 jsshell (taskcluster в†’
 * archive fallback), probes capabilities, and verifies the AST path works
 * end-to-end. Bytecode dumping on stock SM shells is NOT possible (dis()
 * removed; dumpStencil no-op) вЂ” honestly gated with a C-lane reason.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { installSmEngine } from '../binaries/sm-downloader.js';
import { probeSmBinary } from './sm-probe.js';
import { SpiderMonkeyAdapter } from './spidermonkey/sm-adapter.js';
import type { EngineRegistry } from './registry.js';

const RUN = process.env['RH_NET_TESTS'] === '1';

let dir = '';
let d8LikePath: string | null = null;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'rh-sm-net-'));
  process.env['RH_CACHE_ROOT'] = dir;
});

afterAll(() => {
  delete process.env['RH_CACHE_ROOT'];
});

async function getJsshell(): Promise<string> {
  if (d8LikePath !== null) return d8LikePath;
  const entry = await installSmEngine();
  d8LikePath = join(entry.installedPath ?? '', 'js.exe');
  return d8LikePath;
}

function fakeRegistry(binaryPath: string): EngineRegistry {
  const capsPromise = probeSmBinary(binaryPath);
  return {
    describe: async () => ({
      id: 'spidermonkey',
      version: 'net',
      binaryPath,
      capabilities: await capsPromise,
      reason: null
    }),
    capabilities: async () => await capsPromise
  } as unknown as EngineRegistry;
}

describe.skipIf(!RUN)('SpiderMonkey on real jsshell (network)', () => {
  it('probes Reflect.parse AST and runs the ast analysis end-to-end', async () => {
    const exe = await getJsshell();
    const registry = fakeRegistry(exe);
    const adapter = new SpiderMonkeyAdapter(registry);

    const caps = await registry.capabilities(exe);
    expect(caps.astDump).toBe(true);
    expect(caps.bytecodeDump).toBe(false); // stock shell вЂ” honest gating

    const events: { t: string; raw?: string; analysisType?: string }[] = [];
    await adapter.analyze(
      {
        requestId: 'sm-net-000001',
        engineId: 'spidermonkey',
        binaryPath: exe,
        code: 'function sum(a, b) { return a + b; }\nsum(1, 2);',
        analysisTypes: ['ast'],
        timeoutMs: 20_000
      },
      {
        emit: (e) =>
          events.push(e.t === 'result' ? { t: e.t, raw: e.result.rawOutput } : { t: e.t }),
        registerCancel: () => {},
        isLive: () => true
      }
    );

    const resultEvent = events.find((e) => e.t === 'result');
    expect(resultEvent).toBeDefined();
    // AST JSON contains the function name and SM parse-node markers.
    expect(resultEvent?.raw).toContain('sum');
    expect(resultEvent?.raw).toContain('Identifier');
  }, 300_000);

  it('gates bytecode as unsupported with an actionable reason', async () => {
    const exe = await getJsshell();
    const registry = fakeRegistry(exe);
    const adapter = new SpiderMonkeyAdapter(registry);
    const events: { t: string; reason?: string }[] = [];
    await adapter.analyze(
      {
        requestId: 'sm-net-000002',
        engineId: 'spidermonkey',
        binaryPath: exe,
        code: 'function sum(a, b) { return a + b; }',
        analysisTypes: ['bytecode'],
        functionName: 'sum',
        timeoutMs: 20_000
      },
      {
        emit: (e) => events.push({ t: e.t, ...(e.t === 'unsupported' ? { reason: e.reason } : {}) }),
        registerCancel: () => {},
        isLive: () => true
      }
    );
    const unsupported = events.find((e) => e.t === 'unsupported');
    expect(unsupported).toBeDefined();
    expect(unsupported?.reason).toContain('bytecode');
  }, 120_000);
});
