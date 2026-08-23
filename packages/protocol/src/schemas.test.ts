import { describe, expect, it } from 'vitest';
import { IPC, PingRequestSchema, PingResponseSchema } from './index.js';

describe('protocol ping contract', () => {
  it('round-trips a valid ping request', () => {
    const req = { sentAt: Date.now() };
    expect(PingRequestSchema.parse(req)).toEqual(req);
  });

  it('round-trips a valid ping response', () => {
    const res = { pong: true as const, receivedAt: Date.now(), echoSentAt: Date.now() };
    expect(PingResponseSchema.parse(res)).toEqual(res);
  });

  it('rejects malformed payloads', () => {
    expect(() => PingRequestSchema.parse({ sentAt: 'not-a-number' })).toThrow();
    expect(() => PingResponseSchema.parse({ pong: false })).toThrow();
    expect(() => PingResponseSchema.parse({ pong: true, receivedAt: 'x', echoSentAt: 1 })).toThrow();
  });

  it('exposes the canonical channel name', () => {
    expect(IPC.ping).toBe('app:ping');
  });
});
