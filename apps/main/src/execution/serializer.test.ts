/**
 * Serializer unit tests (plan todo 10): every supported value kind, caps,
 * circular back-edges and throwing getters — against the REAL child-side
 * module (templates/serialize-value.cjs) so drift is impossible.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_CAPS, makeSerializer } from './templates/serialize-value.cjs';

describe('structural serializer', () => {
  it('serializes primitives', () => {
    const s = makeSerializer();
    expect(s(undefined)).toEqual({ t: 'undefined' });
    expect(s(null)).toEqual({ t: 'null' });
    expect(s(true)).toEqual({ t: 'boolean', prim: 'true' });
    expect(s(1.5)).toEqual({ t: 'number', prim: '1.5' });
    expect(s(NaN)).toEqual({ t: 'number', prim: 'NaN' });
    expect(s(10n)).toEqual({ t: 'bigint', prim: '10n' });
    expect(s(Symbol('tag'))).toEqual({ t: 'symbol', prim: 'Symbol(tag)' });
    expect(s('hello')).toEqual({ t: 'string', prim: 'hello' });
  });

  it('truncates oversized strings with original size', () => {
    const s = makeSerializer({ maxString: 10 });
    const node = s('x'.repeat(100));
    expect(node.truncated).toBe(true);
    expect(node.size).toBe(100);
    expect(node.prim).toBe('x'.repeat(10));
  });

  it('distinguishes functions from classes with name and arity', () => {
    const s = makeSerializer();
    function fn(a: number, b: number): void {
      void a;
      void b;
    }
    const anon = (x: number): number => x;
    class Klass {
      m(): void {}
    }
    const fnNode = s(fn);
    expect(fnNode.t).toBe('function');
    expect(fnNode.label).toBe('fn');
    expect(fnNode.size).toBe(2);
    // Bindings lend their name even to arrows...
    expect(s(anon).label).toBe('anon');
    // ...while unbound function expressions are truly anonymous.
    expect(s(function (): void {}).label).toBe('(anonymous)');
    expect(s(Klass).t).toBe('class');
  });

  it('serializes errors with message and stack children', () => {
    const s = makeSerializer();
    const node = s(new TypeError('boom'));
    expect(node.t).toBe('error');
    expect(node.label).toBe('TypeError');
    const keys = node.children?.map((c) => c.k);
    expect(keys).toContain('message');
    expect(keys).toContain('stack');
    const message = node.children?.find((c) => c.k === 'message')?.node;
    expect(message).toEqual({ t: 'string', prim: 'boom' });
  });

  it('serializes Date as ISO and RegExp as source+flags', () => {
    const s = makeSerializer();
    const date = new Date('2026-01-02T03:04:05.000Z');
    expect(s(date)).toEqual({ t: 'date', prim: '2026-01-02T03:04:05.000Z' });
    const re = s(/ab+c/gi);
    expect(re.t).toBe('regexp');
    expect(re.prim).toBe('ab+c');
    expect(re.label).toBe('gi');
  });

  it('marks promises as placeholders (settlement ships separately)', () => {
    const s = makeSerializer();
    const node = s(Promise.resolve(1));
    expect(node.t).toBe('promise');
    expect(node.label).toContain('promise');
  });

  it('serializes Map entries as ordered key/value child pairs', () => {
    const s = makeSerializer();
    const node = s(
      new Map([
        ['k1', 11],
        ['k2', 22]
      ])
    );
    expect(node.t).toBe('map');
    expect(node.size).toBe(2);
    expect(node.children?.map((c) => c.k)).toEqual(['[0] key', '[0] value', '[1] key', '[1] value']);
    expect(node.children?.[0]?.node.prim).toBe('k1');
    expect(node.children?.[1]?.node.prim).toBe('11');
  });

  it('serializes Set members', () => {
    const s = makeSerializer();
    const node = s(new Set([1, 2]));
    expect(node.t).toBe('set');
    expect(node.size).toBe(2);
    expect(node.children?.map((c) => c.node.prim)).toEqual(['1', '2']);
  });

  it('serializes typed arrays with kind, length and first 50 elements', () => {
    const s = makeSerializer();
    const small = s(new Uint8Array([1, 2, 3]));
    expect(small.t).toBe('typedarray');
    expect(small.label).toBe('Uint8Array');
    expect(small.size).toBe(3);
    expect(small.truncated).toBeUndefined();

    const big = s(new Float64Array(100).fill(7));
    expect(big.size).toBe(100);
    expect(big.children?.length).toBe(50);
    expect(big.truncated).toBe(true);
    expect(big.children?.[0]?.node.prim).toBe('7');
  });

  it('sizes DataView by byteLength', () => {
    const s = makeSerializer();
    const view = new DataView(new ArrayBuffer(24));
    const node = s(view);
    expect(node.t).toBe('typedarray');
    expect(node.label).toBe('DataView');
    expect(node.size).toBe(24);
  });

  it('labels class instances but not plain objects', () => {
    const s = makeSerializer();
    class Point {
      x = 1;
    }
    expect(s(new Point()).label).toBe('Point');
    expect(s({ a: 1 }).label).toBeUndefined();
    expect(s({ a: 1 }).children?.[0]?.k).toBe('a');
  });

  it('serializes the complete prototype chain through null', () => {
    const s = makeSerializer();
    class Base {
      baseMethod(): void {}
    }
    class Child extends Base {
      childMethod(): void {}
    }

    const node = s(new Child());
    const childProto = node.children?.find((c) => c.k === '[[Prototype]]')?.node;
    const baseProto = childProto?.children?.find((c) => c.k === '[[Prototype]]')?.node;
    const objectProto = baseProto?.children?.find((c) => c.k === '[[Prototype]]')?.node;
    const nullProto = objectProto?.children?.find((c) => c.k === '[[Prototype]]')?.node;

    expect(childProto?.label).toBe('Child');
    expect(childProto?.children?.some((c) => c.k === 'childMethod')).toBe(true);
    expect(baseProto?.label).toBe('Base');
    expect(baseProto?.children?.some((c) => c.k === 'baseMethod')).toBe(true);
    expect(objectProto?.label).toBe('Object');
    expect(nullProto).toEqual({ t: 'null' });
  });

  it('emits refId back-edges for circular references', () => {
    const s = makeSerializer();
    const root: Record<string, unknown> = { name: 'root' };
    root['self'] = root;
    const node = s(root);
    expect(node.children?.filter((c) => c.k !== '[[Prototype]]').length).toBe(2);
    const selfEdge = node.children?.find((c) => c.k === 'self')?.node;
    expect(selfEdge?.refId).toBe(0);

    // Mutual cycle one level down.
    const a: Record<string, unknown> = {};
    const b: Record<string, unknown> = { parent: a };
    a['child'] = b;
    const mutual = s(a);
    const innerParent = mutual.children?.find((c) => c.k === 'child')?.node.children?.find((c) => c.k === 'parent');
    expect(innerParent?.node.refId).toBe(0);
  });

  it('replaces throwing getters with the <threw> marker', () => {
    const s = makeSerializer();
    const evil = {
      get broken(): number {
        throw new Error('nope');
      }
    };
    const node = s(evil);
    expect(node.children?.[0]?.k).toBe('broken');
    expect(node.children?.[0]?.node.prim).toBe('<threw>');
  });

  it('stops at the depth cap with a truncated marker', () => {
    const s = makeSerializer({ maxDepth: 3 });
    const deep = { l1: { l2: { l3: { l4: 'too deep' } } } };
    const node = s(deep);
    const l3 = node.children?.[0]?.node.children?.[0]?.node.children?.[0]?.node;
    expect(l3?.truncated).toBe(true);
  });

  it('caps total nodes on huge arrays and flags truncation', () => {
    const s = makeSerializer();
    const huge = Array.from({ length: 100_000 }, (_, i) => i);
    const node = s(huge);
    expect(node.t).toBe('array');
    expect(node.size).toBe(100_000);
    expect(node.truncated).toBe(true);
    expect((node.children?.length ?? 0) + 1).toBeLessThanOrEqual(DEFAULT_CAPS.maxNodes + 1);
  });
});
