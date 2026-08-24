/**
 * Inspector tree flattening unit tests (plan todo 11).
 */
import { describe, expect, it } from 'vitest';
import { describeNode, flattenValue } from './inspector-tree';
import type { SerializedValue } from '@rh/protocol';

const num = (n: number): SerializedValue => ({ t: 'number', prim: String(n) });

describe('describeNode', () => {
  it('labels container kinds with sizes', () => {
    expect(describeNode({ t: 'array', size: 10, children: [] })).toBe('Array(10)');
    expect(describeNode({ t: 'map', size: 2 })).toBe('Map(2)');
    expect(describeNode({ t: 'set', size: 3 })).toBe('Set(3)');
    expect(describeNode({ t: 'typedarray', label: 'Uint8Array', size: 4 })).toBe('Uint8Array(4)');
  });

  it('marks truncation and circular back-edges explicitly', () => {
    expect(describeNode({ t: 'array', size: 100000, truncated: true })).toContain('[truncated]');
    expect(describeNode({ t: 'object', refId: 0 })).toBe('[Circular ↑0]');
  });

  it('renders functions, errors, dates and regexps', () => {
    expect(describeNode({ t: 'function', label: 'sum', size: 2 })).toBe('function sum(2)');
    expect(describeNode({ t: 'class', label: 'Klass' })).toBe('class Klass()');
    expect(describeNode({ t: 'error', label: 'TypeError', children: [{ k: 'message', node: { t: 'string', prim: 'boom' } }] })).toBe(
      'TypeError: boom'
    );
    expect(describeNode({ t: 'date', prim: '2026-01-01T00:00:00.000Z' })).toBe('Date 2026-01-01T00:00:00.000Z');
    expect(describeNode({ t: 'regexp', prim: 'ab+', label: 'g' })).toBe('/ab+/g');
  });
});

describe('flattenValue', () => {
  const root: SerializedValue = {
    t: 'object',
    children: [
      { k: 'name', node: { t: 'string', prim: 'Alex' } },
      {
        k: 'tags',
        node: {
          t: 'array',
          size: 2,
          children: [
            { k: '0', node: num(1) },
            { k: '1', node: num(2) }
          ]
        }
      }
    ]
  };

  it('collapses children until expanded', () => {
    const rows = flattenValue(root, new Set());
    expect(rows.length).toBe(1);
    expect(rows[0]?.hasChildren).toBe(true);
  });

  it('expands nested levels by key chain', () => {
    const oneLevel = flattenValue(root, new Set(['root']));
    expect(oneLevel.map((r) => r.childKey)).toEqual(['', 'name', 'tags']);

    const deep = flattenValue(root, new Set(['root', 'root\u0000tags']));
    expect(deep.length).toBe(5);
    const tagRow = deep.find((r) => r.childKey === '0');
    expect(tagRow?.depth).toBe(2);
    expect(tagRow?.label).toBe('1');
  });

  it('reports hasChildren only when children exist', () => {
    const rows = flattenValue(root, new Set(['root']));
    const nameRow = rows.find((r) => r.childKey === 'name');
    expect(nameRow?.hasChildren).toBe(false);
  });
});
