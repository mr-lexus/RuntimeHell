import { parse } from '@babel/parser';

export type DetectedLanguage = 'js' | 'ts';

function containsTypeScriptSyntax(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsTypeScriptSyntax);
  if (value === null || typeof value !== 'object') return false;
  const node = value as Record<string, unknown>;
  const type = typeof node.type === 'string' ? node.type : '';
  if (type.startsWith('TS') || node.importKind === 'type' || node.exportKind === 'type') return true;
  return Object.values(node).some(containsTypeScriptSyntax);
}

function hasIncompleteTypeScriptHint(source: string): boolean {
  return [
    /\b(?:interface|type|enum|namespace|declare|abstract|implements)\s+[A-Za-z_$][\w$]*/,
    /\bimport\s+type\b/,
    /\bexport\s+type\b/,
    /\bsatisfies\s+[A-Za-z_$][\w$]*/,
    /\bas\s+(?:const|[A-Za-z_$][\w$]*(?:\s*[<\[|&.]|\s*$))/,
    /(?:\b(?:const|let|var|function)\s+[A-Za-z_$][\w$]*|\([^)]*\))\s*\??:\s*[A-Za-z_$({[]/
  ].some((pattern) => pattern.test(source));
}

/** Detect TypeScript by file convention first, then by authored syntax. */
export function detectSourceLanguage(source: string, relPath = ''): DetectedLanguage {
  if (/\.(?:ts|tsx|mts|cts|d\.ts)$/i.test(relPath)) return 'ts';

  try {
    const ast = parse(source, {
      sourceType: 'unambiguous',
      plugins: ['jsx', 'typescript'],
      errorRecovery: true
    });
    if (containsTypeScriptSyntax(ast)) return 'ts';
  } catch {
    // Incomplete source is common while typing; use the lexical fallback below.
  }

  return hasIncompleteTypeScriptHint(source) ? 'ts' : 'js';
}
