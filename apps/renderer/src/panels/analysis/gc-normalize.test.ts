import { describe, expect, it } from 'vitest';
import { parseV8Gc } from './gc-normalize';

describe('parseV8Gc', () => {
  it('parses V8 trace-gc events with process prefixes and reasons', () => {
    expect(parseV8Gc([
      '[22872:000002973B730000]       26 ms: Scavenge 4.7 (5.7) -> 4.4 (6.7) MB, pooled: 0 MB, 0.84 / 0.00 ms  (average mu = 1.000, current mu = 1.000) allocation failure;',
      '[22872:000002973B730000]       89 ms: Scavenge 37.2 (54.9) -> 36.6 (99.9) MB, pooled: 0 MB, 5.99 / 0.00 ms  (average mu = 1.000, current mu = 1.000) task;',
      'not a GC event'
    ].join('\n'))).toEqual([
      {
        timestampMs: 26,
        kind: 'Scavenge',
        beforeUsedMb: 4.7,
        beforeTotalMb: 5.7,
        afterUsedMb: 4.4,
        afterTotalMb: 6.7,
        pauseMs: 0.84,
        secondaryPauseMs: 0,
        details: 'average mu = 1.000, current mu = 1.000',
        reason: 'allocation failure'
      },
      {
        timestampMs: 89,
        kind: 'Scavenge',
        beforeUsedMb: 37.2,
        beforeTotalMb: 54.9,
        afterUsedMb: 36.6,
        afterTotalMb: 99.9,
        pauseMs: 5.99,
        secondaryPauseMs: 0,
        details: 'average mu = 1.000, current mu = 1.000',
        reason: 'task'
      }
    ]);
  });

  it('returns an empty list for unrelated output', () => {
    expect(parseV8Gc('hello\n[stderr]\nnot a gc line')).toEqual([]);
  });
});
