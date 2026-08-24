/**
 * Run-start/cancel IPC contract tests (plan todo 11).
 */
import { describe, expect, it } from 'vitest';
import { RunCancelRequestSchema, RunStartRequestSchema, RunStartResponseSchema } from './run.js';

describe('RunStartRequestSchema', () => {
  it('accepts a well-formed request', () => {
    const parsed = RunStartRequestSchema.parse({
      workspaceId: 'default',
      relPath: 'entry.ts',
      content: 'console.log(1);\n',
      timeoutMs: 5000
    });
    expect(parsed.timeoutMs).toBe(5000);
  });

  it('rejects unknown fields and bad timeout', () => {
    expect(() =>
      RunStartRequestSchema.parse({
        workspaceId: 'default',
        relPath: 'entry.ts',
        content: '',
        timeoutMs: -1
      })
    ).toThrow();
    expect(() =>
      RunStartRequestSchema.parse({
        workspaceId: 'default',
        relPath: 'entry.ts',
        content: '',
        timeoutMs: 5000,
        extra: true
      })
    ).toThrow();
  });
});

describe('RunStartResponseSchema', () => {
  it('round-trips ok and rejected variants', () => {
    const ok = RunStartResponseSchema.parse({ ok: true, runId: 'abc-123', runtimeVersion: '24.18.0' });
    expect(ok).toEqual({ ok: true, runId: 'abc-123', runtimeVersion: '24.18.0' });

    const rejected = RunStartResponseSchema.parse({
      ok: false,
      stage: 'transpile',
      errors: [{ text: 'unexpected token', line: 3, column: 7 }]
    });
    expect(rejected).toMatchObject({ ok: false, stage: 'transpile' });
  });

  it('rejects unknown stages', () => {
    expect(() => RunStartResponseSchema.parse({ ok: false, stage: 'warp' })).toThrow();
  });
});

describe('RunCancelRequestSchema', () => {
  it('requires a non-empty runId', () => {
    expect(RunCancelRequestSchema.parse({ runId: 'x' })).toEqual({ runId: 'x' });
    expect(() => RunCancelRequestSchema.parse({ runId: '' })).toThrow();
  });
});
