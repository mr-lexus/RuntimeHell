import type { SerializedValue } from '@rh/protocol';

export interface TableShape {
  headers: string[];
  rows: { k: string; node: SerializedValue }[][];
}

const visibleChildren = (node: SerializedValue): { k: string; node: SerializedValue }[] =>
  (node.children ?? []).filter((child) => child.k !== '[[Prototype]]');

const stringValue = (value: string): SerializedValue => ({ t: 'string', prim: value });

function rowsFromCollection(children: { k: string; node: SerializedValue }[]): TableShape | null {
  if (children.length === 0) return null;

  const collectionRows = children.filter((child) => child.node.t === 'object' || child.node.t === 'array');
  if (collectionRows.length > 0) {
    const headers: string[] = [];
    const seen = new Set<string>();
    for (const row of collectionRows) {
      for (const cell of visibleChildren(row.node)) {
        if (!seen.has(cell.k)) {
          seen.add(cell.k);
          headers.push(cell.k);
        }
      }
    }
    return headers.length > 0
      ? { headers, rows: collectionRows.map((row) => visibleChildren(row.node)) }
      : null;
  }

  // console.table([1, 2]) — keep primitive arrays useful as a one-column table.
  return {
    headers: ['value'],
    rows: children.map((child) => [{ k: 'value', node: child.node }]),
  };
}

/**
 * Normalize the serialized values accepted by console.table into one shape
 * shared by the full console and the inline inspector.
 */
export function detectTable(value: SerializedValue): TableShape | null {
  if (value.t === 'array') return rowsFromCollection(visibleChildren(value));
  if (value.t !== 'object') return null;

  const children = visibleChildren(value);
  if (children.length === 0) return null;

  // console.table({ alice: { age: 30 }, bob: { age: 32 } })
  const objectRows = children.filter((child) => child.node.t === 'object' || child.node.t === 'array');
  if (objectRows.length > 0) {
    const nested = rowsFromCollection(objectRows);
    if (!nested) return null;
    return {
      headers: ['key', ...nested.headers],
      rows: objectRows.map((row, index) => [
        { k: 'key', node: stringValue(row.k) },
        ...visibleChildren(row.node),
      ]),
    };
  }

  // console.table({ a: 1, b: 2 }) — key/value rows.
  return {
    headers: ['key', 'value'],
    rows: children.map((child) => [
      { k: 'key', node: stringValue(child.k) },
      { k: 'value', node: child.node },
    ]),
  };
}
