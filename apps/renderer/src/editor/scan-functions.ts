/**
 * Function discovery for the analysis panel's function picker.
 *
 * Walks the babel AST (same parser config as selection-service) and collects
 * every discoverable function: named declarations, arrow functions assigned
 * to variables, anonymous function expressions, and IIFEs. Line numbers are
 * derived from offsets so results are independent of parser location options.
 * Unparseable input yields an empty list — the picker simply offers the whole
 * file.
 */
import { parse } from '@babel/parser';

export type ScannedFunctionKind = 'declaration' | 'expression' | 'arrow' | 'iife';

export interface ScannedFunction {
  /** Display name (extracted) or "(anonymous)" / "(IIFE)". */
  name: string;
  /** 1-based line where the function starts. */
  startLine: number;
  /** 1-based line where the function ends. */
  endLine: number;
  /** Char offset in source (inclusive). */
  startOffset: number;
  /** Char offset in source (exclusive). */
  endOffset: number;
  kind: ScannedFunctionKind;
  /** Full source text of the function node. */
  text: string;
}

interface AstLikeNode {
  type: string;
  start?: number | null;
  end?: number | null;
}

const FUNCTION_NODE_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

function asRecord(node: AstLikeNode): Record<string, unknown> {
  return node as unknown as Record<string, unknown>;
}

function isChildNode(value: unknown): value is AstLikeNode {
  return value !== null && typeof value === 'object' && typeof (value as AstLikeNode).type === 'string';
}

function identifierName(value: unknown): string | null {
  if (isChildNode(value) && value.type === 'Identifier') {
    const name = asRecord(value).name;
    if (typeof name === 'string') return name;
  }
  return null;
}

/** Immediately-invoked: the function node IS the callee of its parent call. */
function isIife(node: AstLikeNode, parent: AstLikeNode | null): boolean {
  if (parent === null || parent.type !== 'CallExpression') return false;
  return asRecord(parent).callee === node;
}

function kindOf(node: AstLikeNode, parent: AstLikeNode | null): ScannedFunctionKind {
  if (node.type === 'FunctionDeclaration') return 'declaration';
  if (isIife(node, parent)) return 'iife';
  return node.type === 'ArrowFunctionExpression' ? 'arrow' : 'expression';
}

function nameOf(node: AstLikeNode, parent: AstLikeNode | null, kind: ScannedFunctionKind): string {
  if (kind === 'iife') return '(IIFE)';
  const own = identifierName(asRecord(node).id);
  if (own !== null) return own;
  if (parent !== null && parent.type === 'VariableDeclarator') {
    const assigned = identifierName(asRecord(parent).id);
    if (assigned !== null) return assigned;
  }
  return '(anonymous)';
}

/** 1-based line starts for offset→line conversion. */
function computeLineStarts(code: string): number[] {
  const starts = [0];
  for (let i = 0; i < code.length; i++) {
    if (code.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

function lineAt(lineStarts: number[], offset: number): number {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((lineStarts[mid] ?? 0) <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

function walk(
  node: AstLikeNode,
  parent: AstLikeNode | null,
  code: string,
  lineStarts: number[],
  out: ScannedFunction[]
): void {
  if (
    FUNCTION_NODE_TYPES.has(node.type) &&
    typeof node.start === 'number' &&
    typeof node.end === 'number' &&
    // Skip TS overload signatures / `declare function` — no body, not analyzable.
    (node.type !== 'FunctionDeclaration' || isChildNode(asRecord(node).body))
  ) {
    const start = node.start;
    const end = node.end;
    const kind = kindOf(node, parent);
    out.push({
      name: nameOf(node, parent, kind),
      startLine: lineAt(lineStarts, start),
      endLine: lineAt(lineStarts, Math.max(start, end - 1)),
      startOffset: start,
      endOffset: end,
      kind,
      text: code.slice(start, end)
    });
  }
  for (const key of Object.keys(node)) {
    const child = asRecord(node)[key];
    if (Array.isArray(child)) {
      for (const c of child) {
        if (isChildNode(c)) walk(c, node, code, lineStarts, out);
      }
    } else if (isChildNode(child)) {
      walk(child, node, code, lineStarts, out);
    }
  }
}

export function scanFunctions(code: string): ScannedFunction[] {
  let ast: ReturnType<typeof parse>;
  try {
    ast = parse(code, { sourceType: 'unambiguous', plugins: ['jsx', 'typescript'], errorRecovery: false });
  } catch {
    return [];
  }
  const out: ScannedFunction[] = [];
  walk(ast.program, null, code, computeLineStarts(code), out);
  out.sort((a, b) => a.startOffset - b.startOffset || a.endOffset - b.endOffset);
  return out;
}
