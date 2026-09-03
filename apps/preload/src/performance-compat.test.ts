import { describe, expect, it } from 'vitest';
import { PerformanceStartRequestSchema } from '@rh/protocol';
import { isLegacyPerformanceContractError, toLegacyPerformanceStartRequest } from './performance-compat.js';

describe('performance IPC compatibility', () => {
  it('recognizes only the old-main schema rejection', () => {
    expect(isLegacyPerformanceContractError({ message: 'unrecognized_keys: mode, gcMode' })).toBe(true);
    expect(isLegacyPerformanceContractError(new Error('benchmark child exited with code 1'))).toBe(false);
    expect(isLegacyPerformanceContractError(new Error('unrecognized_keys: requestId'))).toBe(false);
  });

  it('strips fields introduced after the original Performance contract', () => {
    const request = PerformanceStartRequestSchema.parse({
      requestId: 'request-12345678',
      workspaceId: 'workspace',
      setup: 'const value = 1;',
      setupSourceLabel: 'fixture.ts',
      cases: [{ id: 'case', label: 'case', body: 'value + 1', mode: 'async' }],
      targets: [{ target: { source: 'runtime', id: 'node' }, profiles: [{ id: 'default' }] }],
      measurement: { samples: 3, warmupRounds: 0, iterationsPerSample: 1, timeoutMs: 1_000, gcMode: 'before-sample' }
    });

    const legacy = toLegacyPerformanceStartRequest(request);
    expect(legacy).not.toHaveProperty('setupSourceLabel');
    expect(legacy.cases).toEqual([{ id: 'case', label: 'case', body: 'value + 1' }]);
    expect(legacy.measurement).toEqual({ samples: 3, warmupRounds: 0, iterationsPerSample: 1, timeoutMs: 1_000 });
  });
});
