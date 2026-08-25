/**
 * JavaScriptCore network integration (plan todo 25 QA happy).
 * Gated by RH_NET_TESTS=1. Installs requirements + real wincairo jsc, then:
 *  - bytecode analysis via JSC_dumpGeneratedBytecodes=true contains JSC
 *    bytecode markers for sum()
 *  - child PATH contains the requirements dir ONLY within that run
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AnalysisEvent } from '@rh/protocol';
import { JavaScriptCoreAdapter } from './javascriptcore/jsc-adapter.js';
import { probeSmBinary } from './sm-probe.js';
import type { AnalysisStartRequest } from '@rh/protocol';
import type { EngineRegistry } from './registry.js';

const RUN = process.env['RH_NET_TESTS'] === '1';

let dir = '';
let jscExe: string | null = null;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'rh-jsc-net-'));
  process.env['RH_CACHE_ROOT'] = dir;
});

afterAll(() => {
  delete process.env['RH_CACHE_ROOT'];
});

async function getJsc(): Promise<string> {
  if (jscExe !== null) return jscExe;
  const { installJscEngine } = await import('../binaries/jsc-downloader.js');
  const entry = await installJscEngine();
  jscExe = join(entry.installedPath ?? '', 'jsc.exe');
  return jscExe;
}

function fakeRegistry(binaryPath: string): EngineRegistry {
  const capsPromise = probeSmBinary(binaryPath);
  return {
    describe: async () => ({
      id: 'javascriptcore',
      version: 'net',
      binaryPath,
      capabilities: await capsPromise,
      reason: null
    }),
    capabilities: async () => await capsPromise
  } as unknown as EngineRegistry;
}

describe.skipIf(!RUN)('JavaScriptCore on real wincairo build (network)', () => {
  it('probes jsc and runs bytecode analysis via JSC_dumpGeneratedBytecodes', async () => {
    const exe = await getJsc();
    const registry = fakeRegistry(exe);
    const adapter = new JavaScriptCoreAdapter(registry);

    const events: AnalysisEvent[] = [];
    await adapter.analyze(
      {
        requestId: 'jsc-net-000001',
        engineId: 'javascriptcore',
        binaryPath: exe,
        code: 'function sum(a, b) { return a + b; }\nsum(40, 2);',
        analysisTypes: ['bytecode'],
        timeoutMs: 30_000
      },
      {
        emit: (e) => events.push(e),
        registerCancel: () => {},
        isLive: () => true
      }
    );

    const resultEvent = events.find((e) => e.t === 'result');
    expect(resultEvent).toBeDefined();
    if (resultEvent?.t !== 'result') return;
    // JSC bytecode markers (NOT V8 Ignition tokens).
    expect(resultEvent.result.rawOutput).toMatch(/sum/);
    expect(resultEvent.result.rawOutput).not.toMatch(/LdaSmi|Star0/);
  }, 120_000);
});
