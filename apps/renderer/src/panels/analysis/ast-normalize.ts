import { parse } from '@babel/parser';

/**
 * Extract the first complete JSON document from an engine response. Analysis
 * adapters may append stderr/diagnostic lines, so parsing the complete raw
 * string is intentionally too strict for the normalized AST view.
 */
export function parseEmbeddedJson(raw: string): unknown | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    // Continue with line/document extraction below.
  }

  for (const line of raw.split(/\r?\n/)) {
    const candidate = line.trim();
    if (!candidate.startsWith('{') && !candidate.startsWith('[')) continue;
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // A diagnostic line can begin with '['; keep scanning for the payload.
    }
  }

  for (let start = 0; start < raw.length; start += 1) {
    if (raw[start] !== '{' && raw[start] !== '[') continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let end = start; end < raw.length; end += 1) {
      const ch = raw[end];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === '{' || ch === '[') depth += 1;
      else if (ch === '}' || ch === ']') {
        depth -= 1;
        if (depth === 0) {
          try {
            return JSON.parse(raw.slice(start, end + 1)) as unknown;
          } catch {
            break;
          }
        }
      }
    }
  }
  return null;
}

/**
 * V8's --print-ast is deliberately a human-readable text dump, unlike
 * SpiderMonkey's JSON AST. Build a stable ESTree-like fallback from the
 * analyzed source so the normalized AST tab is still a real collapsible tree.
 * The raw engine dump remains available as the authoritative view.
 */
export function parseSourceAst(source: string): unknown | null {
  if (source.trim() === '') return null;
  try {
    return parse(source, {
      sourceType: 'unambiguous',
      plugins: ['jsx', 'typescript'],
      errorRecovery: true
    }).program;
  } catch {
    return null;
  }
}
