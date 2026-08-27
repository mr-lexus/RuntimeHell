/**
 * Safe standalone wrapping strategies (plan todo 20).
 *
 * Turns an editor selection (classified by selection-service) into a
 * standalone snippet that an ENGINE SHELL can compile+run without the rest of
 * the file. Deterministic and fully unit-testable; the emitted header doubles
 * as the "show generated wrapper" preview.
 */
import type { SelectionInfo } from './selection-service';

export type WrapperKind = 'expression' | 'statement' | 'function' | 'class' | 'block' | 'module';

export interface WrapInput {
  readonly kindGuess: WrapperKind;
  /** Selected text (or whole file for module kind). */
  readonly text: string;
  /** Offer a sample invocation after function/class definitions. */
  readonly sampleInvocation?: boolean;
  /** Name to bind an expression to so V8 emits a named bytecode block. */
  readonly targetName?: string | null;
}

export interface WrappedSnippet {
  readonly code: string;
  readonly functionName: string | null;
  readonly usedFallbackRepr: boolean;
}

/**
 * Structural repr available INSIDE generated snippets for engines without the
 * ResultCapture bootstrap (fd3/sentinel transport is Electron-only).
 */
export const REPR_PRELUDE = [
  "const __rh_repr = (v, depth = 0, seen = new Set()) => {",
  "  if (v === null) return 'null';",
  "  if (v === undefined) return 'undefined';",
  "  const t = typeof v;",
  "  if (t === 'number' || t === 'boolean' || t === 'bigint' || t === 'symbol') return String(v);",
  "  if (t === 'string') return depth === 0 ? v : JSON.stringify(v);",
  "  if (t === 'function') return `[function ${(v.name || '(anonymous)')}]`;",
  "  if (depth > 3) return '…';",
  "  if (seen.has(v)) return '[Circular]';",
  "  seen.add(v);",
  "  if (Array.isArray(v)) return '[' + v.map((x) => __rh_repr(x, depth + 1, seen)).join(', ') + ']';",
  "  try {",
  "    const entries = Object.entries(Object(v)).map(([k, val]) => `${k}: ${__rh_repr(val, depth + 1, seen)}`);",
  "    return `{ ${entries.join(', ')} }`;",
  "  } catch (e) { return '<unserializable>'; }",
  "};",
  "const __rh_out = (s) => { if (typeof print === 'function') print(s); else console.log(s); };"
].join('\n');

/** Extract a callable/class name from a definition fragment, best-effort. */
export function extractDefinitionName(text: string): string | null {
  const patterns = [
    /\bclass\s+([A-Za-z_$][\w$]*)/,
    /\bfunction\s*\*?\s+([A-Za-z_$][\w$]*)/,
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\()/,
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (m?.[1] !== undefined) return m[1];
  }
  return null;
}

/** Build the standalone snippet for one analysis request. */
export function buildAnalysisSnippet(input: WrapInput): WrappedSnippet {
  const text = input.text.replace(/\r\n/g, '\n');
  const kind = input.kindGuess;
  let body: string;
  let functionName: string | null = null;

  switch (kind) {
    case 'expression': {
      // Single trailing semicolon is normalized away so report() owns it.
      const trimmed = text.trim().replace(/;\s*$/, '');
      const targetName = typeof input.targetName === 'string' && input.targetName.trim() !== '' ? input.targetName : null;
      if (targetName !== null) {
        // Bind to a const so V8 emits a named bytecode block instead of
        // an anonymous "(top level)" one for arrows / function expressions.
        functionName = targetName;
        body = `const ${targetName} = ${trimmed};\n__rh_out(__rh_repr(${targetName}));`;
      } else {
        body = `__rh_out(__rh_repr(${trimmed}));`;
      }
      break;
    }
    case 'function':
    case 'class': {
      functionName = extractDefinitionName(text);
      body = text;
      if (functionName !== null) {
        // V8 in ES module mode (the adapter writes `snippet.mjs`) does NOT
        // eagerly compile top-level function declarations even with
        // `--no-lazy`. A bare `function sum(){}` snippet emits no `sum`
        // bytecode block, so the renderer's focus filter falls back to all
        // functions. A top-level reference `const __rh_force = sum;` forces
        // V8 to compile the declaration without executing it.
        body += `\nconst __rh_force = ${functionName};`;
      }
      if (input.sampleInvocation === true && functionName !== null) {
        body += `\ntry {\n  ${functionName}.apply(null, Array.from({ length: ${functionName}.length }, () => undefined));\n} catch (e) {\n  __rh_out('[sample-invocation] ' + (e && e.message ? e.message : String(e)));\n}`;
      }
      break;
    }
    case 'statement':
    case 'block': {
      body = `(async () => {\n${text}\n})();`;
      break;
    }
    case 'module': {
      body = text;
      break;
    }
  }

  const needsPrelude = kind !== 'module';
  const code = needsPrelude
    ? `// RuntimeHell generated analysis wrapper (${kind})\n${REPR_PRELUDE}\n${body}\n`
    : `// RuntimeHell generated analysis wrapper (module — verbatim)\n${text}\n`;

  return {
    code,
    functionName: kind === 'statement' || kind === 'block' || kind === 'module' ? null : functionName,
    usedFallbackRepr: needsPrelude && kind === 'expression'
  };
}

/** Convenience bridge from SelectionInfo to wrapper input. */
export function wrapSelection(info: SelectionInfo, sampleInvocation = false): WrappedSnippet {
  return buildAnalysisSnippet({
    kindGuess: info.kind,
    text: info.text,
    sampleInvocation
  });
}
