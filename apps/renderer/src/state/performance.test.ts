import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PerformanceCatalogResponse, PerformanceRunResult, PerformanceStartResponse } from '@rh/protocol';
import { usePerformance } from './performance';

const requestId = 'perf-progress-1234';
const target = { source: 'runtime' as const, id: 'node' };
const catalog: PerformanceCatalogResponse = { targets: [{ ref: target, label: 'Node.js', available: true, reason: null, runtimeId: 'node', runtimeVersion: '24', engineId: 'v8', profiles: [{ id: 'natural', label: 'Default', description: '', available: true, classification: 'stable' }] }] };

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('performance progress state', () => {
  beforeEach(() => {
    usePerformance.setState({
      requestId,
      running: true,
      cancelling: false, outcome: null, startedAt: 100, finishedAt: null,
      results: [], loadingCatalog: false, catalog: null, catalogUpdatedAt: 0,
      cases: [{ id: 'case-a', label: 'A', body: 'return 42;', mode: 'sync' }],
      runTargets: [{ target, profiles: [{ id: 'natural' }] }], selectedProfiles: {},
      progress: 'starting',
      progressCompleted: 0,
      progressTotal: 0,
      progressPhase: 'resolving',
      activeGroupId: null,
      completedGroups: 0,
      totalGroups: 2,
      errors: {}
    });
  });

  it('retains numeric progress instead of only replacing the status message', () => {
    usePerformance.getState().handleEvent({
      type: 'progress', requestId, groupId: 'node:natural', phase: 'measurement',
      completed: 7, total: 20, message: 'Case A · sample 3/5'
    });
    expect(usePerformance.getState()).toMatchObject({
      progress: 'Case A · sample 3/5',
      progressCompleted: 7,
      progressTotal: 20,
      progressPhase: 'measurement',
      activeGroupId: 'node:natural'
    });
  });

  it('ignores events from an older experiment and finalizes non-cancelled progress', () => {
    usePerformance.getState().handleEvent({ type: 'progress', requestId: 'stale-request', phase: 'warmup', completed: 9, total: 10, message: 'stale' });
    expect(usePerformance.getState().progress).toBe('starting');
    usePerformance.setState({ progressCompleted: 12, progressTotal: 20 });
    usePerformance.getState().handleEvent({ type: 'done', requestId, status: 'partial', completedGroups: 1, totalGroups: 2 });
    expect(usePerformance.getState()).toMatchObject({ running: false, requestId: null, progress: 'partial', progressCompleted: 20, progressTotal: 20, completedGroups: 1 });
  });

  it.each(['cancelled', 'failed'] as const)('retains partial progress and the %s outcome until the next action', (status) => {
    usePerformance.setState({ progressCompleted: 7, progressTotal: 20, cancelling: true });
    usePerformance.getState().handleEvent({ type: 'done', requestId, status, completedGroups: 0, totalGroups: 2 });
    expect(usePerformance.getState()).toMatchObject({ running: false, cancelling: false, outcome: status, progressCompleted: 7, progressTotal: 20 });
    expect(usePerformance.getState().finishedAt).toBeGreaterThan(100);
    usePerformance.getState().handleEvent({ type: 'progress', requestId, phase: 'measurement', completed: 20, total: 20, message: 'late' });
    expect(usePerformance.getState().progressCompleted).toBe(7);
    usePerformance.getState().setMeasurement({ samples: 5 });
    expect(usePerformance.getState()).toMatchObject({ outcome: null, startedAt: null, finishedAt: null, progressTotal: 0, completedGroups: 0 });
  });

  it('does not move the progress bar backwards on a delayed frame', () => {
    usePerformance.setState({ progressCompleted: 10, progressTotal: 20, progress: 'latest' });
    usePerformance.getState().handleEvent({ type: 'progress', requestId, phase: 'warmup', completed: 5, total: 20, message: 'late' });
    expect(usePerformance.getState()).toMatchObject({ progressCompleted: 10, progress: 'latest' });
  });

  it('counts unique result groups, not duplicate deliveries', () => {
    const result: PerformanceRunResult = {
      requestId, groupId: 'node:natural', target, profile: { id: 'natural' },
      environment: { platform: 'test', arch: 'x64', cpu: 'test', logicalCores: 1, runtimeId: 'node', runtimeVersion: '24', executable: 'node', flags: [], gcMode: 'runtime' },
      results: [], comparisons: [], scheduleSeed: 1, rounds: 5
    };
    usePerformance.getState().handleEvent({ type: 'result', requestId, result });
    usePerformance.getState().handleEvent({ type: 'result', requestId, result });
    expect(usePerformance.getState().completedGroups).toBe(1);
    expect(usePerformance.getState().results).toHaveLength(1);
  });

  it.each(['resolve', 'reject'] as const)('ignores a stale start response (%s) after a newer run begins', async (action) => {
    const pending = deferred<PerformanceStartResponse>();
    vi.stubGlobal('window', { api: { performanceStart: () => pending.promise } });
    usePerformance.setState({ running: false, requestId: null });
    const run = usePerformance.getState().run();
    const firstId = usePerformance.getState().requestId!;
    usePerformance.getState().handleEvent({ type: 'done', requestId: firstId, status: 'completed', completedGroups: 1, totalGroups: 1 });
    usePerformance.setState({ running: true, requestId: 'new-request', totalGroups: 3, outcome: null });
    if (action === 'resolve') pending.resolve({ accepted: true, requestId: firstId, totalGroups: 1, totalCells: 1 });
    else pending.reject(new Error('old failure'));
    await run;
    expect(usePerformance.getState()).toMatchObject({ running: true, requestId: 'new-request', totalGroups: 3, errors: {} });
  });

  it('deduplicates Stop and waits for done, preserving completed measurements', async () => {
    const performanceCancel = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('window', { api: { performanceCancel } });
    await Promise.all([usePerformance.getState().cancel(), usePerformance.getState().cancel()]);
    expect(performanceCancel).toHaveBeenCalledTimes(1);
    expect(usePerformance.getState()).toMatchObject({ running: true, cancelling: true, requestId });
    usePerformance.getState().handleEvent({ type: 'done', requestId, status: 'cancelled', completedGroups: 1, totalGroups: 2 });
    expect(usePerformance.getState()).toMatchObject({ running: false, cancelling: false, outcome: 'cancelled', completedGroups: 1 });
  });

  it.each([false, true])('handles rejected/negative cancellation without getting stuck (reject=%s)', async (reject) => {
    const performanceCancel = reject ? vi.fn().mockRejectedValue(new Error('offline')) : vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal('window', { api: { performanceCancel } });
    await usePerformance.getState().cancel();
    expect(usePerformance.getState()).toMatchObject({ running: true, cancelling: false });
    expect(usePerformance.getState().errors.cancellation).toContain('Could not stop');
  });

  it('deduplicates runtime discovery, caches it on reopen, and allows an explicit refresh', async () => {
    const pending = deferred<PerformanceCatalogResponse>();
    const performanceCatalog = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(catalog);
    vi.stubGlobal('window', { api: { performanceCatalog } });
    usePerformance.setState({ running: false });
    const first = usePerformance.getState().refreshCatalog();
    await usePerformance.getState().refreshCatalog();
    expect(performanceCatalog).toHaveBeenCalledTimes(1);
    pending.resolve(catalog);
    await first;
    await usePerformance.getState().refreshCatalog();
    expect(performanceCatalog).toHaveBeenCalledTimes(1);
    await usePerformance.getState().refreshCatalog(true);
    expect(performanceCatalog).toHaveBeenCalledTimes(2);
    expect(usePerformance.getState()).toMatchObject({ catalog, loadingCatalog: false });
  });

  it('preserves existing results/errors if refreshing the catalog fails', async () => {
    vi.stubGlobal('window', { api: { performanceCatalog: vi.fn().mockRejectedValue(new Error('probe failed')) } });
    usePerformance.setState({ running: false, catalog, errors: { 'run-1': 'run failed' }, outcome: 'partial' });
    await usePerformance.getState().refreshCatalog(true);
    expect(usePerformance.getState()).toMatchObject({ catalog, loadingCatalog: false, outcome: 'partial', errors: { catalog: 'probe failed', 'run-1': 'run failed' } });
  });

  it('times out stalled discovery and permits retry', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', { api: { performanceCatalog: vi.fn().mockReturnValueOnce(new Promise(() => {})).mockResolvedValue(catalog) } });
    usePerformance.setState({ running: false });
    const first = usePerformance.getState().refreshCatalog();
    await vi.advanceTimersByTimeAsync(35000);
    await first;
    expect(usePerformance.getState().loadingCatalog).toBe(false);
    expect(usePerformance.getState().errors.catalog).toContain('timed out');
    await usePerformance.getState().refreshCatalog(true);
    expect(usePerformance.getState().errors.catalog).toBeUndefined();
  });

  it('does not start a comparison during runtime discovery', async () => {
    const performanceStart = vi.fn();
    vi.stubGlobal('window', { api: { performanceStart } });
    usePerformance.setState({ running: false, loadingCatalog: true });
    await usePerformance.getState().run();
    expect(performanceStart).not.toHaveBeenCalled();
  });

  it('replaces an old success with a visible failure if a live sample becomes empty', async () => {
    const performanceStart = vi.fn();
    vi.stubGlobal('window', { api: { performanceStart } });
    usePerformance.setState({ running: false, requestId: null, outcome: 'completed', progressCompleted: 100, progressTotal: 100 });
    await usePerformance.getState().run([{ id: 'case-a', label: 'A', body: '  ', mode: 'sync' }]);
    expect(performanceStart).not.toHaveBeenCalled();
    expect(usePerformance.getState()).toMatchObject({ running: false, outcome: 'failed', progressTotal: 0, totalGroups: 0, errors: { experiment: 'Every case must contain executable code.' } });
  });
});
