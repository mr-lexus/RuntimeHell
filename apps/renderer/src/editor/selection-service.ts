/**
 * Selection classification (plan todo 5).
 *
 * Strategy: find the AST node whose [start,end) span EXACTLY equals the
 * normalized selection span (trailing whitespace/semicolons trimmed), then map
 * its type to a fragment kind. Exact-span matching avoids the classic trap
 * where a call expression containing an arrow function would otherwise be
 * classified by the inner arrow. Falls back to statement/block heuristics.
 */
import { parse } from '@babel/parser';

export type SelectionKind = 'expression' | 'statement' | 'function' | 'class' | 'block' | 'module';

export interface SelectionInfo {
  text: string;
  startLine: number; // 1-based
  startCol: number; // 1-based
  endLine: number;
  endCol: number;
  kind: SelectionKind;
}

const FUNCTION_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
const CLASS_TYPES = new Set(['ClassDeclaration', 'ClassExpression']);
/** Expression nodes whose type name does not end in "Expression". */
const EXPRESSION_TYPES = new Set(['JSXElement', 'JSXFragment']);

interface SpanNode {
  type: string;
  start: number;
  end: number;
}

interface AstLikeNode {
  type: string;
  start?: number | null;
  end?: number | null;
}

function collectNodes(node: AstLikeNode, out: SpanNode[]): void {
  if (typeof node.start === 'number' && typeof node.end === 'number') {
    out.push({ type: node.type, start: node.start, end: node.end });
  }
  for (const key of Object.keys(node)) {
    const child = (node as unknown as Record<string, unknown>)[key];
    if (Array.isArray(child)) {
      for (const c of child) {
        if (c && typeof c === 'object' && typeof (c as AstLikeNode).type === 'string') collectNodes(c as AstLikeNode, out);
      }
    } else if (child && typeof child === 'object' && typeof (child as AstLikeNode).type === 'string') {
      collectNodes(child as AstLikeNode, out);
    }
  }
}

/** Offset of a 1-based line/column pair. */
function offsetOf(lines: string[], line: number, col: number): number {
  let offset = 0;
  for (let i = 0; i < line - 1 && i < lines.length; i++) offset += (lines[i]?.length ?? 0) + 1;
  return offset + (col - 1);
}

function kindForSpan(nodes: SpanNode[], start: number, end: number): SelectionKind | null {
  // Smallest node exactly matching the span wins.
  const exact = nodes
    .filter((n) => n.start === start && n.end === end)
    .sort((a, b) => a.start - b.start || a.end - b.end)[0];
  if (!exact) return null;
  if (FUNCTION_TYPES.has(exact.type)) return 'function';
  if (CLASS_TYPES.has(exact.type)) return 'class';
  if (EXPRESSION_TYPES.has(exact.type) || exact.type.endsWith('Expression')) return 'expression';
  if (
    exact.type.endsWith('Statement') ||
    exact.type === 'VariableDeclaration' ||
    exact.type.startsWith('Export')
  ) {
    return 'statement';
  }
  return null;
}

function kindForContaining(nodes: SpanNode[], start: number, end: number): SelectionKind {
  const containing = nodes.filter((n) => n.start <= start && n.end >= end);
  const smallest = containing.sort((a, b) => a.end - a.start - (b.end - b.start))[0];
  if (!smallest) return 'block';
  if (FUNCTION_TYPES.has(smallest.type)) return 'function';
  if (CLASS_TYPES.has(smallest.type)) return 'class';
  if (EXPRESSION_TYPES.has(smallest.type) || smallest.type.endsWith('Expression')) return 'expression';
  return 'block';
}

export function classifySelection(
  source: string,
  sel: { startLine: number; startCol: number; endLine: number; endCol: number }
): SelectionKind {
  let ast: ReturnType<typeof parse>;
  try {
    ast = parse(source, { sourceType: 'unambiguous', plugins: ['jsx', 'typescript'], errorRecovery: false });
  } catch {
    return 'block'; // unparseable document → safest wrapper is IIFE
  }

  const lines = source.split('\n');
  const rawStart = offsetOf(lines, sel.startLine, sel.startCol);
  const rawEnd = offsetOf(lines, sel.endLine, sel.endCol);

  // Normalized span: drop trailing whitespace/semicolons and leading whitespace.
  let start = rawStart;
  let end = rawEnd;
  while (end > start && /[\s;]/.test(source[end - 1] ?? '')) end--;
  while (start < end && /\s/.test(source[start] ?? '')) start++;
  if (end <= start) return 'block';

  const nodes: SpanNode[] = [];
  collectNodes(ast.program, nodes);

  // Prefer the RAW selection end first: selecting "x = x + 1;" should match the
  // ExpressionStatement (which includes ';') rather than the inner expression.
  const exactKindRaw = kindForSpan(nodes, start, rawEnd);
  if (exactKindRaw) return exactKindRaw;
  const exactKindTrimmed = kindForSpan(nodes, start, end);
  if (exactKindTrimmed) return exactKindTrimmed;

  // Multi-statement selections: cover ≥2 top-level statements → block.
  const coveredTopLevel = ast.program.body.filter(
    (s) => typeof s.start === 'number' && typeof s.end === 'number' && s.start >= start && s.end <= end
  );
  if (coveredTopLevel.length >= 2) return 'block';

  return kindForContaining(nodes, start, end);
}

export function getSelectionInfo(
  source: string,
  text: string,
  sel: { startLine: number; startCol: number; endLine: number; endCol: number }
): SelectionInfo {
  return { text, ...sel, kind: classifySelection(source, sel) };
}
