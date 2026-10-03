import { afterEach, expect, it, vi } from 'vitest';
import { valueForLine } from './line-results';

afterEach(() => vi.unstubAllGlobals());

it('preserves a single object and its prototype tree without wrapping it', () => {
  const value = { t: 'object' as const, children: [{ k: '[[Prototype]]', node: { t: 'null' as const } }] };
  expect(valueForLine([{ index: 0, line: 1, value }], 1)).toBe(value);
  expect(valueForLine([], 2)).toBeUndefined();
});

it('retains same-line captures, undefined, promise settlements and run correlation', async () => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
  const { useRun } = await import('./run');
  useRun.setState({ phase: 'running', runId: 'current', reports: [], resultByLine: {} });
  const emit = (index: number, value: { t: 'object' | 'promise' | 'undefined' | 'number'; prim?: string }, line?: number, runId = 'current') => useRun.getState().handleEvent({ type: 'result', runId, index, value, line });
  emit(0, { t: 'object' }, 1);
  emit(1, { t: 'promise' }, 1);
  emit(2, { t: 'undefined' }, 2);
  emit(1, { t: 'number', prim: '42' });
  emit(0, { t: 'number', prim: '999' }, 1, 'stale');
  expect(useRun.getState().resultByLine[1]?.children?.map((child) => child.node)).toEqual([{ t: 'object' }, { t: 'number', prim: '42' }]);
  expect(useRun.getState().resultByLine[2]).toEqual({ t: 'undefined' });
  expect(useRun.getState().reports).toHaveLength(3);
});
