/**
 * Sentinel splitter + frame parser unit tests (plan todo 10): chunk-boundary
 * safety is the load-bearing property — frames NEVER split across events in
 * real streams.
 */
import { describe, expect, it } from 'vitest';
import { SentinelLineSplitter, parseReportFrame } from './report-transport.js';

function collect(): { text: string[]; sentinels: string[]; feed(chunk: string): void; end(): void } {
  const text: string[] = [];
  const sentinels: string[] = [];
  const splitter = new SentinelLineSplitter({
    onSentinel: (payload) => sentinels.push(payload),
    onText: (t) => text.push(t)
  });
  return {
    text,
    sentinels,
    feed: (chunk) => splitter.push(chunk),
    end: () => splitter.flush()
  };
}

describe('SentinelLineSplitter', () => {
  it('routes sentinel lines to onSentinel and other text untouched', () => {
    const c = collect();
    c.feed('__RH__{"i":0,"phase":"immediate","n":1}\nplain error line\n');
    c.end();
    expect(c.sentinels).toEqual(['{"i":0,"phase":"immediate","n":1}']);
    expect(c.text).toEqual(['plain error line\n']);
  });

  it('reassembles frames split across arbitrary chunk boundaries', () => {
    const c = collect();
    const frame = '__RH__{"i":2,"phase":"fulfilled","n":3,"v":{"t":"number","prim":"42"}}\n';
    c.feed(frame.slice(0, 7));
    c.feed(frame.slice(7, 20));
    c.feed(frame.slice(20));
    c.end();
    expect(c.sentinels.length).toBe(1);
    expect(parseReportFrame(c.sentinels[0] ?? '')?.index).toBe(2);
    expect(c.text).toEqual([]);
  });

  it('handles multiple frames and text mixed within one chunk', () => {
    const c = collect();
    c.feed('a\n__RH__{"i":0,"phase":"immediate"}\n__RH__{"i":1,"phase":"immediate"}\nb');
    c.end();
    expect(c.sentinels.length).toBe(2);
    expect(c.text).toEqual(['a\n', 'b']);
  });

  it('flushes a trailing unterminated non-sentinel line verbatim', () => {
    const c = collect();
    c.feed('no trailing newline');
    c.end();
    expect(c.text).toEqual(['no trailing newline']);
  });

  it('surfaces malformed sentinel payloads as text (debuggable, never dropped)', () => {
    const c = collect();
    c.feed('__RH__{not json}\n');
    c.end();
    expect(c.sentinels).toEqual([]);
    expect(c.text).toEqual(['__RH__{not json}\n']);
  });
});

describe('parseReportFrame', () => {
  it('parses well-formed frames including nonce', () => {
    const frame = parseReportFrame('{"i":5,"phase":"rejected","n":9,"v":{"t":"error"}}');
    expect(frame).not.toBeNull();
    expect(frame?.index).toBe(5);
    expect(frame?.phase).toBe('rejected');
    expect(frame?.nonce).toBe(9);
  });

  it('rejects garbage, wrong types and unknown phases', () => {
    expect(parseReportFrame('{not json')).toBeNull();
    expect(parseReportFrame('{"phase":"immediate"}')).toBeNull(); // missing index
    expect(parseReportFrame('{"i":-1,"phase":"immediate"}')).toBeNull();
    expect(parseReportFrame('{"i":0,"phase":"teleport"}')).toBeNull();
    expect(parseReportFrame('42')).toBeNull();
  });
});
