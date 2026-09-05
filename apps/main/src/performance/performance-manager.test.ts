import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { PerformanceManager, RegistryPerformanceTargetResolver, comparePairedSamples, performanceLaunchArgs, type ResolvedPerformanceTarget } from './performance-manager.js';
import type { ManifestEntry, PerformanceEvent, PerformanceRawSample } from '@rh/protocol';
import { RuntimeRegistry } from '../runtimes/runtime-adapter.js';
import { detectSystemBrowser, detectSystemRuntime, type BrowserId } from '../runtimes/runtime-detection.js';
import { workspaceRoot } from '../workspace/files.js';
import { executableName } from '../platform.js';

function samples(caseId: string, values: number[]): PerformanceRawSample[] {
  return values.map((durationNs, round) => ({ caseId, round, durationNs, iterations: 1, orderIndex: round % 2 }));
}

describe('Performance Lab comparison', () => {
  it('uses paired ratios instead of independent confidence-interval overlap', () => {
    const comparison = comparePairedSamples(
      samples('a', [100, 110, 90, 105, 95]),
      samples('b', [50, 55, 45, 52, 48]),
      'a',
      'b',
      7
    );
    expect(comparison.medianRatio).toBeLessThan(0.6);
    expect(comparison.confidenceHigh).toBeLessThan(1);
    expect(comparison.significance).toBe('candidate-faster');
  });
});

describe('Performance optimizer catalog', () => {
  it('offers distinct JavaScriptCore tiers for Bun and resolves their environment overrides', async () => {
    const runtimes = new RuntimeRegistry({ adapters: [{
      id: 'bun',
      resolveExecutable: async () => ({ exePath: process.execPath, version: '1.3.14' }),
      installedVersions: async () => []
    }] });
    const resolver = new RegistryPerformanceTargetResolver(runtimes, {
      readManifest: async () => ({ schemaVersion: 1, entries: [] }),
      detectNvm: async () => null,
      detectBrowser: async () => null
    });
    const catalog = await resolver.catalog();
    const bun = catalog.targets[0];
    expect(bun?.profiles.map((profile) => profile.id)).toEqual(['natural', 'jsc-interpreter', 'jsc-baseline', 'jsc-no-ftl']);
    const target = bun ? await resolver.resolve(bun.ref) : null;
    const profile = target ? await resolver.resolveProfile(target, { id: 'jsc-baseline' }) : null;
    expect(profile?.extraEnv).toEqual({ BUN_JSC_useDFGJIT: 'false', BUN_JSC_useFTLJIT: 'false' });
  });

  it('lists every executable installed source, including browsers, nvm, runtimes, and engines', async () => {
    const id = randomUUID();
    const root = workspaceRoot(`perf-catalog-${id.slice(0, 8)}`);
    const executableNames: Record<string, string> = {
      txiki: executableName('tjs'), v8: executableName('d8'), 'd8-debug': executableName('d8'), spidermonkey: executableName('js'), javascriptcore: executableName('jsc'),
      quickjs: executableName('qjs'), graaljs: join('bin', executableName('js')), hermes: executableName('hermes'), chakra: executableName('ch'), 'moddable-xs': executableName('xst')
    };
    const entries: ManifestEntry[] = [];
    try {
      for (const [entryId, executableName] of Object.entries(executableNames)) {
        const installedPath = join(root, entryId);
        const executable = join(installedPath, executableName);
        await fs.mkdir(dirname(executable), { recursive: true });
        await fs.writeFile(executable, 'fixture', 'utf8');
        entries.push({
          kind: entryId === 'txiki' ? 'runtime' : 'engine', id: entryId, platform: 'win64', arch: 'x64', version: '1.2.3',
          url: 'https://example.test/runtime.zip', sha256: 'a'.repeat(64), license: 'test', source: 'official-dist', installedPath,
          addedAt: new Date(0).toISOString(), customBuildRequired: false
        });
      }
      const runtimes = new RuntimeRegistry({ adapters: [{
        id: 'node', resolveExecutable: async () => ({ exePath: process.execPath, version: process.versions.node }), installedVersions: async () => []
      }] });
      const resolver = new RegistryPerformanceTargetResolver(runtimes, {
        readManifest: async () => ({ schemaVersion: 1, entries }),
        detectNvm: async () => ({ root: join(root, 'nvm'), versions: [{ version: '20.11.0', exePath: process.execPath, active: false }] }),
        detectBrowser: async (browserId) => ({ exePath: join(root, `${browserId}.exe`), version: browserId === 'chrome' ? '140.0.7339.81' : '141.0.1' })
      });
      const catalog = await resolver.catalog();
      const available = catalog.targets.filter((target) => target.available);
      expect(available.map((target) => `${target.ref.source}:${target.ref.id}:${target.ref.provenance}`)).toEqual(expect.arrayContaining([
        'runtime:node:system', 'runtime:node:nvm', 'runtime:browser:builtin', 'runtime:chrome:system', 'runtime:firefox:system',
        'runtime:txiki:managed', 'engine:v8:managed', 'engine:d8-debug:managed', 'engine:spidermonkey:managed',
        'engine:javascriptcore:managed', 'engine:quickjs:managed', 'engine:graaljs:managed', 'engine:hermes:managed',
        'engine:chakra:managed', 'engine:moddable-xs:managed'
      ]));
      expect(available.find((target) => target.ref.id === 'chrome')?.label).toContain('Google Chrome');
      expect(available.find((target) => target.ref.id === 'firefox')?.engineId).toBe('spidermonkey');
      const graal = await resolver.resolve({ source: 'engine', id: 'graaljs', version: '1.2.3', provenance: 'managed' });
      expect(graal?.executable).toBe(join(root, 'graaljs', 'bin', executableName('js')));
      expect(performanceLaunchArgs({
        ref: { source: 'runtime', id: 'txiki', version: '1.2.3' }, executable: join(root, 'txiki', 'tjs.exe'),
        runtimeId: 'txiki', runtimeVersion: '1.2.3', engineId: 'quickjs', launchKind: 'shell'
      }, 'group.js', [], 'runtime')).toEqual(['run', 'group.js']);
    } finally {
      await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});

describe('PerformanceManager real Node child', () => {
  it('runs an N-case group through the isolated Mitata harness and returns raw paired samples', async () => {
    const events: PerformanceEvent[] = [];
    let finish!: (event: PerformanceEvent) => void;
    const done = new Promise<PerformanceEvent>((resolve) => { finish = resolve; });
    const target: ResolvedPerformanceTarget = {
      ref: { source: 'runtime', id: 'node', version: process.versions.node, provenance: 'test' },
      executable: process.execPath,
      runtimeId: 'node',
      runtimeVersion: process.versions.node,
      engineId: 'v8',
      engineVersion: process.versions.v8
    };
    const manager = new PerformanceManager({
      targetResolver: {
        resolve: async () => target,
        catalog: async () => ({ targets: [] }),
        resolveProfile: async (_target, profile) => ({ ref: profile, flags: [], extraEnv: {} })
      },
      randomSeed: () => 4,
      emit: (event) => {
        events.push(event);
        if (event.type === 'done') finish(event);
      }
    });
    const requestId = randomUUID();
    const response = await manager.start({
      requestId,
      workspaceId: `perf-test-${requestId.slice(0, 8)}`,
      name: 'matrix test',
      setup: 'const shared = 2;',
      cases: [
        { id: 'a', label: 'A', body: 'return shared + 1;', mode: 'sync', sourceSnapshot: 'return shared + 1;' },
        { id: 'b', label: 'B', body: 'return shared + 2;', mode: 'sync', sourceSnapshot: 'return shared + 2;' },
        { id: 'c', label: 'C', body: 'return shared + 3;', mode: 'sync', sourceSnapshot: 'return shared + 3;' }
      ],
      targets: [{ target: target.ref, profiles: [{ id: 'natural', label: 'Natural V8' }] }],
      measurement: { samples: 3, warmupRounds: 1, iterationsPerSample: 7, timeoutMs: 30_000, gcMode: 'runtime' },
      isolation: { mode: 'target-profile' }
    });
    expect(response.accepted).toBe(true);
    const completed = await done;
    expect(completed.type).toBe('done');
    const result = events.find((event) => event.type === 'result');
    expect(result?.type, JSON.stringify(events, null, 2)).toBe('result');
    if (result?.type !== 'result') return;
    expect(result.result.results).toHaveLength(3);
    expect(result.result.results.every((item) => item.samples).valueOf()).toBe(true);
    expect(result.result.results[0]?.samples).toHaveLength(3);
    expect(result.result.results[1]?.samples).toHaveLength(3);
    expect(result.result.results[2]?.samples).toHaveLength(3);
    expect(result.result.results[0]?.samples.every((sample) => sample.iterations >= 7)).toBe(true);
    expect(result.result.results[1]?.samples.every((sample) => sample.iterations >= 7)).toBe(true);
    expect(result.result.comparisons).toHaveLength(2);
    expect(result.result.comparisons[0]?.significance).toBeDefined();
    const progress = events.filter((event) => event.type === 'progress');
    expect(progress.length).toBeGreaterThan(3);
    expect(progress.every((event, index) => index === 0 || event.completed >= (progress[index - 1]?.completed ?? 0))).toBe(true);
    expect(progress.at(-1)?.completed).toBe(progress.at(-1)?.total);
  });

  it('accepts a one-case experiment', async () => {
    const events: PerformanceEvent[] = [];
    let finish!: () => void;
    const done = new Promise<void>((resolve) => { finish = resolve; });
    const target: ResolvedPerformanceTarget = { ref: { source: 'runtime', id: 'node' }, executable: process.execPath, runtimeId: 'node', runtimeVersion: process.versions.node, engineId: 'v8' };
    const manager = new PerformanceManager({
      targetResolver: { resolve: async () => target, catalog: async () => ({ targets: [] }), resolveProfile: async (_target, profile) => ({ ref: profile, flags: [], extraEnv: {} }) },
      emit: (event) => { events.push(event); if (event.type === 'done') finish(); }
    });
    const id = randomUUID();
    await manager.start({ requestId: id, workspaceId: `perf-one-${id.slice(0, 8)}`, name: 'one', setup: '', cases: [{ id: 'one', label: 'One', body: 'return 42;', mode: 'sync' }], targets: [{ target: target.ref, profiles: [{ id: 'natural' }] }], measurement: { samples: 3, warmupRounds: 0, iterationsPerSample: 3, timeoutMs: 30_000, gcMode: 'runtime' }, isolation: { mode: 'target-profile' } });
    await done;
    const result = events.find((event) => event.type === 'result');
    expect(result?.type === 'result' ? result.result.results : []).toHaveLength(1);
    expect(result?.type === 'result' ? result.result.comparisons : []).toHaveLength(0);
  });

  it('runs only the cases assigned to each runtime/profile group', async () => {
    const events: PerformanceEvent[] = [];
    let finish!: () => void;
    const done = new Promise<void>((resolve) => { finish = resolve; });
    const targetA: ResolvedPerformanceTarget = { ref: { source: 'runtime', id: 'node', version: 'a', provenance: 'test' }, executable: process.execPath, runtimeId: 'node', runtimeVersion: process.versions.node, engineId: 'v8' };
    const targetB: ResolvedPerformanceTarget = { ...targetA, ref: { source: 'runtime', id: 'node', version: 'b', provenance: 'test' } };
    const manager = new PerformanceManager({
      targetResolver: {
        resolve: async (ref) => ref.version === 'b' ? targetB : targetA,
        catalog: async () => ({ targets: [] }),
        resolveProfile: async (_target, profile) => ({ ref: profile, flags: [], extraEnv: {} })
      },
      emit: (event) => { events.push(event); if (event.type === 'done') finish(); }
    });
    const id = randomUUID();
    await manager.start({
      requestId: id, workspaceId: `perf-assigned-${id.slice(0, 8)}`, name: 'assigned cases', setup: '',
      cases: [
        { id: 'a', label: 'A', body: 'return 1;', mode: 'sync', target: targetA.ref, profileIds: ['natural'] },
        { id: 'b', label: 'B', body: 'return 2;', mode: 'sync', target: targetB.ref, profileIds: ['natural'] }
      ],
      targets: [
        { target: targetA.ref, profiles: [{ id: 'natural' }] },
        { target: targetB.ref, profiles: [{ id: 'natural' }] }
      ],
      measurement: { samples: 3, warmupRounds: 0, iterationsPerSample: 2, timeoutMs: 30_000, gcMode: 'runtime' }, isolation: { mode: 'target-profile' }
    });
    await done;
    const results = events.filter((event): event is Extract<PerformanceEvent, { type: 'result' }> => event.type === 'result').map((event) => event.result);
    expect(results).toHaveLength(2);
    expect(results.find((result) => result.target.version === 'a')?.results.map((item) => item.caseId)).toEqual(['a']);
    expect(results.find((result) => result.target.version === 'b')?.results.map((item) => item.caseId)).toEqual(['b']);
  });

  it('runs a case snippet that includes a static local import', async () => {
    const events: PerformanceEvent[] = [];
    let finish!: () => void;
    const done = new Promise<void>((resolve) => { finish = resolve; });
    const target: ResolvedPerformanceTarget = { ref: { source: 'runtime', id: 'node' }, executable: process.execPath, runtimeId: 'node', runtimeVersion: process.versions.node, engineId: 'v8' };
    const id = randomUUID();
    const root = workspaceRoot(`perf-import-${id.slice(0, 8)}`);
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(join(root, 'fixture.ts'), 'export const base: number = 40;', 'utf8');
    try {
      const manager = new PerformanceManager({
        targetResolver: { resolve: async () => target, catalog: async () => ({ targets: [] }), resolveProfile: async (_target, profile) => ({ ref: profile, flags: [], extraEnv: {} }) },
        emit: (event) => { events.push(event); if (event.type === 'done') finish(); }
      });
      await manager.start({ requestId: id, workspaceId: `perf-import-${id.slice(0, 8)}`, name: 'imported case', setup: '', cases: [{ id: 'imported', label: 'Imported', body: "import { base } from './fixture.ts'; return base + 2;", mode: 'sync' }], targets: [{ target: target.ref, profiles: [{ id: 'natural' }] }], measurement: { samples: 3, warmupRounds: 0, iterationsPerSample: 2, timeoutMs: 30_000, gcMode: 'runtime' }, isolation: { mode: 'target-profile' } });
      await done;
      expect(events.some((event) => event.type === 'result')).toBe(true);
      expect(events.some((event) => event.type === 'cell-error')).toBe(false);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('bundles a workspace CommonJS package used by a case', async () => {
    const events: PerformanceEvent[] = [];
    let finish!: () => void;
    const done = new Promise<void>((resolve) => { finish = resolve; });
    const target: ResolvedPerformanceTarget = { ref: { source: 'runtime', id: 'node' }, executable: process.execPath, runtimeId: 'node', runtimeVersion: process.versions.node, engineId: 'v8' };
    const id = randomUUID();
    const workspaceId = `perf-package-${id.slice(0, 8)}`;
    const root = workspaceRoot(workspaceId);
    const packageDir = join(root, 'node_modules', 'fixture-equal');
    await fs.mkdir(packageDir, { recursive: true });
    await fs.writeFile(join(packageDir, 'package.json'), JSON.stringify({ name: 'fixture-equal', main: 'index.js' }), 'utf8');
    await fs.writeFile(join(packageDir, 'index.js'), 'module.exports = (a, b) => JSON.stringify(a) === JSON.stringify(b);', 'utf8');
    try {
      const manager = new PerformanceManager({
        targetResolver: { resolve: async () => target, catalog: async () => ({ targets: [] }), resolveProfile: async (_target, profile) => ({ ref: profile, flags: [], extraEnv: {} }) },
        emit: (event) => { events.push(event); if (event.type === 'done') finish(); }
      });
      await manager.start({ requestId: id, workspaceId, name: 'package case', setup: '', cases: [{ id: 'pkg', label: 'Package', body: "const equal = require('fixture-equal'); return equal({ foo: 'bar' }, { foo: 'bar' });", mode: 'sync' }], targets: [{ target: target.ref, profiles: [{ id: 'natural' }] }], measurement: { samples: 3, warmupRounds: 0, iterationsPerSample: 2, timeoutMs: 30_000, gcMode: 'runtime' }, isolation: { mode: 'target-profile' } });
      await done;
      expect(events.some((event) => event.type === 'result')).toBe(true);
      expect(events.find((event) => event.type === 'cell-error')).toBeUndefined();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('transpiles TypeScript setup and awaits explicitly async cases', async () => {
    const events: PerformanceEvent[] = [];
    let finish!: () => void;
    const done = new Promise<void>((resolve) => { finish = resolve; });
    const target: ResolvedPerformanceTarget = { ref: { source: 'runtime', id: 'node' }, executable: process.execPath, runtimeId: 'node', runtimeVersion: process.versions.node, engineId: 'v8' };
    const manager = new PerformanceManager({
      targetResolver: { resolve: async () => target, catalog: async () => ({ targets: [] }), resolveProfile: async (_target, profile) => ({ ref: profile, flags: [], extraEnv: {} }) },
      emit: (event) => { events.push(event); if (event.type === 'done') finish(); }
    });
    const id = randomUUID();
    const workspaceId = `perf-complex-${id.slice(0, 8)}`;
    const root = workspaceRoot(workspaceId);
    await fs.mkdir(join(root, 'bench'), { recursive: true });
    await fs.writeFile(join(root, 'bench', 'fixture.ts'), 'export const externalBase: number = 1;', 'utf8');
    try {
      await manager.start({
        requestId: id,
        workspaceId,
        name: 'typed async workload',
        setup: "import { externalBase } from './fixture.ts';\ninterface Row { value: number }\nconst rows: Row[] = [{ value: externalBase + 1 }, { value: 3 }];\nconst twice = async (value: number): Promise<number> => Promise.resolve(value * 2);",
        setupSourceLabel: 'bench/experiment.ts',
        cases: [
          { id: 'typed', label: 'Typed', body: 'const total: number = rows.reduce((sum, row) => sum + row.value, 0); return total;', mode: 'sync' },
          { id: 'async', label: 'Async', body: 'return await twice(rows[0]!.value);', mode: 'async' }
        ],
        targets: [{ target: target.ref, profiles: [{ id: 'natural' }] }],
        measurement: { samples: 3, warmupRounds: 1, iterationsPerSample: 2, timeoutMs: 30_000, gcMode: 'before-group' },
        isolation: { mode: 'target-profile' }
      });
      await done;
      const result = events.find((event) => event.type === 'result');
      expect(result?.type === 'result' ? result.result.results : []).toHaveLength(2);
      expect(result?.type === 'result' ? result.result.environment.gcMode : null).toBe('before-group');
      expect(events.find((event) => event.type === 'cell-error')).toBeUndefined();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('reports the failing case and phase while completing progress', async () => {
    const events: PerformanceEvent[] = [];
    let finish!: () => void;
    const done = new Promise<void>((resolve) => { finish = resolve; });
    const target: ResolvedPerformanceTarget = { ref: { source: 'runtime', id: 'node' }, executable: process.execPath, runtimeId: 'node', runtimeVersion: process.versions.node, engineId: 'v8' };
    const manager = new PerformanceManager({
      targetResolver: { resolve: async () => target, catalog: async () => ({ targets: [] }), resolveProfile: async (_target, profile) => ({ ref: profile, flags: [], extraEnv: {} }) },
      emit: (event) => { events.push(event); if (event.type === 'done') finish(); }
    });
    const id = randomUUID();
    await manager.start({ requestId: id, workspaceId: `perf-error-${id.slice(0, 8)}`, name: 'error', setup: '', cases: [{ id: 'broken', label: 'Broken case', body: 'throw new Error("boom");', mode: 'sync' }], targets: [{ target: target.ref, profiles: [{ id: 'natural' }] }], measurement: { samples: 3, warmupRounds: 1, iterationsPerSample: 1, timeoutMs: 30_000, gcMode: 'runtime' }, isolation: { mode: 'target-profile' } });
    await done;
    const failure = events.find((event) => event.type === 'cell-error');
    expect(failure?.type === 'cell-error' ? failure.message : '').toContain('Case "Broken case" failed during warmup round 1: boom');
    const progress = events.filter((event) => event.type === 'progress').at(-1);
    expect(progress?.completed).toBe(progress?.total);
  });

  it('runs the harness under a system Bun with a JSC profile when Bun is available', async () => {
    const bun = await detectSystemRuntime('bun');
    if (bun === null) return;
    const events: PerformanceEvent[] = [];
    let finish!: () => void;
    const done = new Promise<void>((resolve) => { finish = resolve; });
    const target: ResolvedPerformanceTarget = { ref: { source: 'runtime', id: 'bun', version: bun.version }, executable: bun.exePath, runtimeId: 'bun', runtimeVersion: bun.version, engineId: 'javascriptcore' };
    const manager = new PerformanceManager({
      targetResolver: { resolve: async () => target, catalog: async () => ({ targets: [] }), resolveProfile: async () => ({ ref: { id: 'jsc-interpreter', label: 'Interpreter only' }, flags: [], extraEnv: { BUN_JSC_useJIT: 'false' } }) },
      emit: (event) => { events.push(event); if (event.type === 'done') finish(); }
    });
    const id = randomUUID();
    await manager.start({ requestId: id, workspaceId: `perf-bun-${id.slice(0, 8)}`, name: 'bun profile', setup: 'const values: number[] = [1, 2, 3];', cases: [{ id: 'sum', label: 'Sum', body: 'return values[0]! + values[1]! + values[2]!;', mode: 'sync' }], targets: [{ target: target.ref, profiles: [{ id: 'jsc-interpreter' }] }], measurement: { samples: 3, warmupRounds: 0, iterationsPerSample: 2, timeoutMs: 30_000, gcMode: 'runtime' }, isolation: { mode: 'target-profile' } });
    await done;
    const result = events.find((event) => event.type === 'result');
    expect(result?.type === 'result' ? result.result.environment.flags : []).toContain('BUN_JSC_useJIT=false');
    expect(events.find((event) => event.type === 'cell-error')).toBeUndefined();
  });
});

describe('PerformanceManager installed browser smoke', () => {
  it('runs the same structured harness in each detected desktop browser', async () => {
    const detected = (await Promise.all((['chrome', 'firefox'] as const).map(async (browserId) => ({ browserId, runtime: await detectSystemBrowser(browserId) })))).filter((item): item is { browserId: BrowserId; runtime: NonNullable<typeof item.runtime> } => item.runtime !== null);
    for (const { browserId, runtime } of detected) {
      const events: PerformanceEvent[] = [];
      let finish!: () => void;
      const done = new Promise<void>((resolve) => { finish = resolve; });
      const target: ResolvedPerformanceTarget = {
        ref: { source: 'runtime', id: browserId, version: 'system', provenance: 'system' },
        executable: runtime.exePath, runtimeId: browserId, runtimeVersion: runtime.version,
        engineId: browserId === 'firefox' ? 'spidermonkey' : 'v8', launchKind: 'external-browser'
      };
      const manager = new PerformanceManager({
        targetResolver: {
          resolve: async () => target,
          catalog: async () => ({ targets: [] }),
          resolveProfile: async (_target, profile) => ({ ref: profile, flags: [], extraEnv: {} })
        },
        emit: (event) => { events.push(event); if (event.type === 'done') finish(); }
      });
      const requestId = randomUUID();
      const workspaceId = `perf-${browserId}-${requestId.slice(0, 8)}`;
      try {
        await manager.start({
          requestId, workspaceId, name: `${browserId} smoke`, setup: '',
          cases: [{ id: 'browser', label: 'Browser', body: 'return typeof document === "object" ? 42 : 0;', mode: 'sync' }],
          targets: [{ target: target.ref, profiles: [{ id: 'natural', label: 'Natural tiering' }] }],
          measurement: { samples: 3, warmupRounds: 0, iterationsPerSample: 2, timeoutMs: 30_000, gcMode: 'runtime' },
          isolation: { mode: 'target-profile' }
        });
        await done;
        const result = events.find((event) => event.type === 'result');
        expect(result?.type, `${browserId}: ${JSON.stringify(events, null, 2)}`).toBe('result');
        expect(result?.type === 'result' ? result.result.environment.runtimeId : null).toBe(browserId);
      } finally {
        await fs.rm(workspaceRoot(workspaceId), { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }
    }
  }, 60_000);
});
