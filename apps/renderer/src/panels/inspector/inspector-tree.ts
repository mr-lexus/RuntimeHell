/**
 * Pure tree-flattening for the Inspector (plan todo 11). The component keeps
 * an expansion set; this module turns SerializedValue nodes into flat rows
 * honoring that set. No React imports — unit-testable.
 */
import type { SerializedValue } from '@rh/protocol';

export interface TreeRow {
  /** Stable identity for expansion state and list keys. */
  readonly key: string;
  readonly depth: number;
  /** Child key as shown in the gutter (`users`, `0`, `[1] key`…). */
  readonly childKey: string;
  readonly label: string;
  readonly hasChildren: boolean;
  readonly isPrototype: boolean;
  readonly isExpanded: boolean;
}

export function describeNode(node: SerializedValue): string {
  switch (node.t) {
    case 'undefined':
      return 'undefined';
    case 'null':
      return 'null';
    case 'boolean':
    case 'number':
    case 'bigint':
    case 'symbol':
    case 'string':
      return node.prim ?? '';
    case 'function':
    case 'class':
      return `${node.t} ${node.label ?? '(anonymous)'}${node.size !== undefined ? `(${node.size})` : '()'}`;
    case 'error':
      return `${node.label ?? 'Error'}: ${childPrim(node, 'message')}`;
    case 'promise':
      return node.label ?? 'promise';
    case 'map':
      return `Map(${node.size ?? 0})`;
    case 'set':
      return `Set(${node.size ?? 0})`;
    case 'date':
      return `Date ${node.prim ?? ''}`;
    case 'regexp':
      return `/${node.prim ?? ''}/${node.label ?? ''}`;
    case 'typedarray':
      return `${node.label ?? 'TypedArray'}(${node.size ?? 0})`;
    case 'array':
      return `Array exotic object(${node.size ?? node.children?.length ?? 0})${node.truncated ? ' [truncated]' : ''}`;
    case 'object': {
      if (node.refId !== undefined) return `[Circular ↑${node.refId}]`;
      const size = node.size ?? node.children?.length ?? 0;
      return `${node.label ?? 'Object'}${node.truncated ? ` (${size}…) [truncated]` : ''}`;
    }
  }
}

function childPrim(node: SerializedValue, key: string): string {
  const child = node.children?.find((c) => c.k === key)?.node;
  return child?.prim ?? '';
}

export function flattenValue(root: SerializedValue, expanded: ReadonlySet<string>): TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (node: SerializedValue, childKey: string, depth: number, key: string): void => {
    const hasChildren = (node.children?.length ?? 0) > 0;
    rows.push({
      key,
      depth,
      childKey,
      label: describeNode(node),
      hasChildren,
      isPrototype: childKey === '[[Prototype]]',
      isExpanded: expanded.has(key)
    });
    if (!hasChildren || !expanded.has(key)) return;
    for (const child of node.children ?? []) {
      walk(child.node, child.k, depth + 1, `${key}\u0000${child.k}`);
    }
  };
  // Root row renders without a child-key gutter.
  const hasChildren = (root.children?.length ?? 0) > 0;
  rows.push({ key: 'root', depth: 0, childKey: '', label: describeNode(root), hasChildren, isPrototype: false, isExpanded: expanded.has('root') });
  if (hasChildren && expanded.has('root')) {
    for (const child of root.children ?? []) {
      walk(child.node, child.k, 1, `root\u0000${child.k}`);
    }
  }
  return rows;
}
