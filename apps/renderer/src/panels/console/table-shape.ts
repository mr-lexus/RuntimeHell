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

function isRecordLike(node: SerializedValue): boolean {
  return node.t === 'object' || node.t === 'array';
}

function columnNames(node: SerializedValue | undefined): string[] | null {
  if (!node || node.t !== 'array') return null;
  const names = visibleChildren(node);
  if (names.length === 0 || names.some(({ node: value }) => value.t !== 'string')) return null;
  return names.map(({ node: value }) => value.prim ?? '');
}

function limitColumns(shape: TableShape, columns: string[]): TableShape {
  const allowed = new Set(columns);
  return {
    headers: shape.headers.filter((header) => allowed.has(header)),
    rows: shape.rows.map((row) => row.filter((cell) => allowed.has(cell.k))),
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

/**
 * Normalize the complete argument list of console.table.
 *
 * In addition to the native `console.table(data, columns)` form, RuntimeHell
 * accepts a convenient list of records (`console.table(row1, row2, ...)`) and
 * renders those records as rows. The old renderer looked only at args[0], so
 * that form incorrectly became a key/value table for the first object.
 */
export function detectConsoleTable(args: readonly SerializedValue[]): TableShape | null {
  if (args.length === 0) return null;

  const first = args[0];
  if (!first) return null;
  const columns = columnNames(args[1]);
  if (args.length === 2 && columns !== null) {
    const shape = detectTable(first);
    return shape ? limitColumns(shape, columns) : null;
  }

  if (args.length > 1 && args.every(isRecordLike)) {
    const rows = args.map((node, index) => ({ k: String(index), node }));
    return rowsFromCollection(rows);
  }

  return detectTable(first);
}
