import { describe, expect, it } from 'vitest';
import { scanFunctions } from './scan-functions';

describe('scanFunctions', () => {
  it('finds a named function declaration with lines, offsets, and text', () => {
    const src = 'const a = 1;\n\nfunction sum(a, b) {\n  return a + b;\n}\n';
    const fns = scanFunctions(src);
    expect(fns).toHaveLength(1);
    const f = fns[0];
    expect(f?.name).toBe('sum');
    expect(f?.kind).toBe('declaration');
    expect(f?.startLine).toBe(3);
    expect(f?.endLine).toBe(5);
    expect(f?.text).toBe('function sum(a, b) {\n  return a + b;\n}');
    expect(src.slice(f?.startOffset ?? -1, f?.endOffset ?? -1)).toBe(f?.text);
  });

  it('names an arrow function from its variable declarator', () => {
    const src = 'const double = (x) => x * 2;\n';
    const fns = scanFunctions(src);
    expect(fns).toHaveLength(1);
    expect(fns[0]?.name).toBe('double');
    expect(fns[0]?.kind).toBe('arrow');
    expect(fns[0]?.text).toBe('(x) => x * 2');
    expect(fns[0]?.startLine).toBe(1);
  });

  it('names an anonymous function expression from its variable declarator', () => {
    const src = 'const run = function () {\n  return 1;\n};\n';
    const fns = scanFunctions(src);
    expect(fns).toHaveLength(1);
    expect(fns[0]?.name).toBe('run');
    expect(fns[0]?.kind).toBe('expression');
    expect(fns[0]?.text).toBe('function () {\n  return 1;\n}');
  });

  it('labels immediately-invoked function expressions as (IIFE)', () => {
    const src = '(function () {\n  console.log("hi");\n})();\n';
    const fns = scanFunctions(src);
    expect(fns).toHaveLength(1);
    expect(fns[0]?.name).toBe('(IIFE)');
    expect(fns[0]?.kind).toBe('iife');
    expect(fns[0]?.text).toBe('function () {\n  console.log("hi");\n}');
  });

  it('labels immediately-invoked arrow functions as (IIFE)', () => {
    const src = '(() => {\n  console.log("hi");\n})();\n';
    const fns = scanFunctions(src);
    expect(fns).toHaveLength(1);
    expect(fns[0]?.name).toBe('(IIFE)');
    expect(fns[0]?.kind).toBe('iife');
  });

  it('prefers the inner name of a named function expression', () => {
    const src = 'const outer = function inner() {};\n';
    const fns = scanFunctions(src);
    expect(fns).toHaveLength(1);
    expect(fns[0]?.name).toBe('inner');
    expect(fns[0]?.kind).toBe('expression');
  });

  it('marks unassigned arrows as (anonymous)', () => {
    const src = 'users.map((u) => u.id);\n';
    const fns = scanFunctions(src);
    expect(fns).toHaveLength(1);
    expect(fns[0]?.name).toBe('(anonymous)');
    expect(fns[0]?.kind).toBe('arrow');
  });

  it('discovers nested functions in source order', () => {
    const src = 'function outer() {\n  const inner = () => 1;\n  return inner();\n}\nconst top = () => outer();\n';
    const fns = scanFunctions(src);
    expect(fns.map((f) => f.name)).toEqual(['outer', 'inner', 'top']);
    expect(fns[0]?.kind).toBe('declaration');
    expect(fns[1]?.kind).toBe('arrow');
    expect(fns[2]?.kind).toBe('arrow');
    expect(fns[1]?.startLine).toBe(2);
    expect(fns[2]?.startLine).toBe(5);
  });

  it('handles TS annotations and skips bodyless overload signatures', () => {
    const src = 'function greet(name: string): string;\nfunction greet(name: string): string {\n  return `hi ${name}`;\n}\n';
    const fns = scanFunctions(src);
    expect(fns).toHaveLength(1);
    expect(fns[0]?.name).toBe('greet');
    expect(fns[0]?.kind).toBe('declaration');
    expect(fns[0]?.startLine).toBe(2);
  });

  it('returns [] for unparseable input', () => {
    expect(scanFunctions('function {')).toEqual([]);
  });

  it('returns [] for code without functions', () => {
    expect(scanFunctions('const x = 1;\nlet y = x + 2;\n')).toEqual([]);
  });
});
