/**
 * Wrapping strategy unit tests (plan todo 20): ≥15 deterministic cases
 * covering every kind and the plan-listed edge shapes.
 */
import { describe, expect, it } from 'vitest';
import { buildAnalysisSnippet, extractDefinitionName, REPR_PRELUDE } from './wrapping';

function wrap(kind: Parameters<typeof buildAnalysisSnippet>[0]['kindGuess'], text: string, sample = false) {
  return buildAnalysisSnippet({ kindGuess: kind, text, sampleInvocation: sample });
}

describe('buildAnalysisSnippet — expression', () => {
  it('wraps bare expressions with repr output', () => {
    const out = wrap('expression', 'users.filter(x => x.active)');
    expect(out.code).toContain('__rh_out(__rh_repr(users.filter(x => x.active)));');
    expect(out.code).toContain(REPR_PRELUDE);
  });

  it('normalizes trailing semicolons', () => {
    const out = wrap('expression', '1 + 2;');
    expect(out.code).toContain('__rh_repr(1 + 2));');
    expect(out.code).not.toContain(';;');
  });

  it('flags fallback repr usage for engine shells', () => {
    const out = wrap('expression', 'a.b(c)');
    expect(out.usedFallbackRepr).toBe(true);
  });

  it('binds a named expression to a const so V8 emits a named block', () => {
    const out = buildAnalysisSnippet({ kindGuess: 'expression', text: '(n) => n * 2', targetName: 'double' });
    expect(out.code).toContain('const double = (n) => n * 2;');
    expect(out.code).toContain('__rh_out(__rh_repr(double));');
    expect(out.functionName).toBe('double');
  });

  it('keeps anonymous expressions unwrapped when no target name', () => {
    const out = buildAnalysisSnippet({ kindGuess: 'expression', text: 'a + b' });
    expect(out.code).toContain('__rh_out(__rh_repr(a + b));');
    expect(out.functionName).toBeNull();
  });
});

describe('buildAnalysisSnippet — function/class definitions', () => {
  it('emits function declarations verbatim (no sample invocation by default)', () => {
    const src = 'function sum(a, b) {\n  return a + b;\n}';
    const out = wrap('function', src);
    expect(out.code).toContain(src);
    expect(out.functionName).toBe('sum');
    expect(out.code).toContain('const __rh_force = sum;');
    expect(out.code).not.toContain('.apply(');
  });

  it('appends placeholder-arg invocation when opted in', () => {
    const src = 'function sum(a, b) {\n  return a + b;\n}';
    const out = wrap('function', src, true);
    // Arity is resolved at RUNTIME via fn.length (static analysis would
    // require a parser here); the generated call shape is what matters.
    expect(out.code).toContain('sum.apply(null, Array.from({ length: sum.length }, () => undefined))');
    expect(out.code).toContain('[sample-invocation]');
  });

  it('detects class names and arity-zero invocations', () => {
    const src = 'class Klass {\n  m() {}\n}';
    const out = wrap('class', src, true);
    expect(out.functionName).toBe('Klass');
    expect(out.code).toContain('Klass.apply(null, Array.from({ length: Klass.length }');
  });

  it('handles arrow functions bound to consts', () => {
    const src = 'const double = (n) => n * 2;';
    const out = wrap('function', src);
    expect(out.functionName).toBe('double');
  });

  it('handles async function declarations', () => {
    const src = 'async function load() {\n  return 1;\n}';
    const out = wrap('function', src);
    expect(out.functionName).toBe('load');
  });

  it('returns null name for anonymous function expressions', () => {
    expect(extractDefinitionName('(function () {})')).toBeNull();
  });

  it('appends a __rh_force reference for named classes so V8 emits the bytecode block in ESM mode', () => {
    const src = 'class Klass {\n  m() {}\n}';
    const out = wrap('class', src);
    expect(out.functionName).toBe('Klass');
    expect(out.code).toContain('const __rh_force = Klass;');
  });

  it('omits __rh_force for anonymous function expressions', () => {
    const src = '(function () {})';
    const out = wrap('function', src);
    expect(out.functionName).toBeNull();
    expect(out.code).not.toContain('__rh_force');
  });
});

describe('buildAnalysisSnippet — statement/block', () => {
  it('wraps statements in an async IIFE', () => {
    const out = wrap('statement', 'const x = await fetchNothing();');
    expect(out.code).toContain('(async () => {');
    expect(out.code).toContain('const x = await fetchNothing();');
    expect(out.code).toContain('})();');
  });

  it('treats top-level await snippets as block-kind safely', () => {
    const snippet = 'await Promise.resolve(42);';
    const out = wrap('block', snippet);
    expect(out.code).toContain('(async () => {');
    expect(out.code).toContain(snippet);
  });

  it('keeps multi-statement blocks intact inside the IIFE', () => {
    const block = 'let s = 0;\nfor (let i = 0; i < 3; i++) s += i;';
    const out = wrap('block', block);
    expect(out.code).toContain(block);
  });
});

describe('buildAnalysisSnippet — module/verbatim', () => {
  it('passes module files through verbatim without prelude', () => {
    const src = 'export const answer = 42;\nconsole.log(answer);\n';
    const out = wrap('module', src);
    expect(out.code).toContain(src);
    expect(out.code).not.toContain(REPR_PRELUDE);
    expect(out.usedFallbackRepr).toBe(false);
  });
});

describe('edge shapes (plan list)', () => {
  it('class static blocks survive verbatim emission', () => {
    const src = 'class WithStatic {\n  static {\n    this.tag = "s";\n  }\n}';
    const out = wrap('class', src);
    expect(out.code).toContain('static {');
  });

  it('JSX elements classify as expressions and wrap syntactically', () => {
    // Note: raw JSX is only valid after the transform pipeline; here we assert
    // wrapper structure, not compilability inside a .mjs shell.
    const out = wrap('expression', '<Widget size="lg" />');
    expect(out.code).toContain('__rh_repr(<Widget size="lg" />)');
  });

  it('destructured export fragments fall back to statement IIFE wrapping', () => {
    const frag = 'const { a, b } = pair;';
    const out = wrap('statement', frag);
    expect(out.code).toContain(frag);
  });
});

describe('extractDefinitionName', () => {
  it('prefers explicit names across declaration styles', () => {
    expect(extractDefinitionName('function* gen() {}')).toBe('gen');
    expect(extractDefinitionName('const load = async function () {};')).toBe('load');
    expect(extractDefinitionName('let handler = () => {};')).toBe('handler');
    expect(extractDefinitionName('class $Outer {}')).toBe('$Outer');
    expect(extractDefinitionName('just an expression')).toBeNull();
  });
});
