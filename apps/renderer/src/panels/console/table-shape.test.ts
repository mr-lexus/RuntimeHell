import { describe, expect, it } from 'vitest';
import { detectConsoleTable, detectTable } from './table-shape';
import type { SerializedValue } from '@rh/protocol';

const number = (prim: string): SerializedValue => ({ t: 'number', prim });
const string = (prim: string): SerializedValue => ({ t: 'string', prim });

describe('detectTable', () => {
  it('normalizes an array of records', () => {
    const value: SerializedValue = {
      t: 'array',
      size: 2,
      children: [
        { k: '0', node: { t: 'object', children: [{ k: 'name', node: string('Ada') }, { k: 'age', node: number('36') }] } },
        { k: '1', node: { t: 'object', children: [{ k: 'name', node: string('Linus') }, { k: 'age', node: number('55') }] } },
      ],
    };
    expect(detectTable(value)).toMatchObject({ headers: ['name', 'age'], rows: expect.any(Array) });
  });

  it('renders object input as key/value rows', () => {
    const shape = detectTable({ t: 'object', children: [{ k: 'a', node: number('1') }, { k: 'b', node: number('2') }] });
    expect(shape?.headers).toEqual(['key', 'value']);
    expect(shape?.rows).toHaveLength(2);
  });

  it('keeps row keys for object-of-records input', () => {
    const shape = detectTable({
      t: 'object',
      children: [
        { k: 'alice', node: { t: 'object', children: [{ k: 'score', node: number('10') }] } },
        { k: 'bob', node: { t: 'object', children: [{ k: 'score', node: number('12') }] } },
      ],
    });
    expect(shape?.headers).toEqual(['key', 'score']);
    expect(shape?.rows[0]?.[0]).toEqual({ k: 'key', node: { t: 'string', prim: 'alice' } });
  });

  it('combines multiple record arguments into table rows', () => {
    const shape = detectConsoleTable([
      { t: 'object', children: [{ k: 'a', node: number('1') }, { k: 'b', node: number('2') }] },
      { t: 'object', children: [{ k: 'a', node: number('3') }, { k: 'c', node: number('4') }] },
    ]);
    expect(shape?.headers).toEqual(['a', 'b', 'c']);
    expect(shape?.rows).toHaveLength(2);
    expect(shape?.rows[1]).toEqual([
      { k: 'a', node: number('3') },
      { k: 'c', node: number('4') },
    ]);
  });

  it('keeps native console.table column filtering', () => {
    const shape = detectConsoleTable([
      { t: 'array', children: [{ k: '0', node: { t: 'object', children: [{ k: 'a', node: number('1') }, { k: 'b', node: number('2') }] } }] },
      { t: 'array', children: [{ k: '0', node: string('b') }] },
    ]);
    expect(shape?.headers).toEqual(['b']);
    expect(shape?.rows[0]).toEqual([{ k: 'b', node: number('2') }]);
  });
});
