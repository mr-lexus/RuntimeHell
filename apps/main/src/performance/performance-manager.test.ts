import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PerformanceManager, comparePairedSamples, type ResolvedPerformanceTarget } from './performance-manager.js';
import type { PerformanceEvent, PerformanceRawSample } from '@rh/protocol';

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
        resolveProfile: async (_target, profile) => ({ ref: profile, flags: [] })
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
        { id: 'a', label: 'A', body: 'return shared + 1;', sourceSnapshot: 'return shared + 1;' },
        { id: 'b', label: 'B', body: 'return shared + 2;', sourceSnapshot: 'return shared + 2;' },
        { id: 'c', label: 'C', body: 'return shared + 3;', sourceSnapshot: 'return shared + 3;' }
      ],
      targets: [{ target: target.ref, profiles: [{ id: 'natural', label: 'Natural V8' }] }],
      measurement: { samples: 3, warmupRounds: 1, iterationsPerSample: 7, timeoutMs: 30_000 },
      isolation: { mode: 'target-profile' }
    });
    expect(response.accepted).toBe(true);
    const completed = await done;
    expect(completed.type).toBe('done');
    const result = events.find((event) => event.type === 'result');
    expect(result?.type).toBe('result');
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
  });

  it('accepts a one-case experiment', async () => {
    const events: PerformanceEvent[] = [];
    let finish!: () => void;
    const done = new Promise<void>((resolve) => { finish = resolve; });
    const target: ResolvedPerformanceTarget = { ref: { source: 'runtime', id: 'node' }, executable: process.execPath, runtimeId: 'node', runtimeVersion: process.versions.node, engineId: 'v8' };
    const manager = new PerformanceManager({
      targetResolver: { resolve: async () => target, catalog: async () => ({ targets: [] }), resolveProfile: async (_target, profile) => ({ ref: profile, flags: [] }) },
      emit: (event) => { events.push(event); if (event.type === 'done') finish(); }
    });
    const id = randomUUID();
    await manager.start({ requestId: id, workspaceId: `perf-one-${id.slice(0, 8)}`, name: 'one', setup: '', cases: [{ id: 'one', label: 'One', body: 'return 42;' }], targets: [{ target: target.ref, profiles: [{ id: 'natural' }] }], measurement: { samples: 3, warmupRounds: 0, iterationsPerSample: 3, timeoutMs: 30_000 }, isolation: { mode: 'target-profile' } });
    await done;
    const result = events.find((event) => event.type === 'result');
    expect(result?.type === 'result' ? result.result.results : []).toHaveLength(1);
    expect(result?.type === 'result' ? result.result.comparisons : []).toHaveLength(0);
  });
});
