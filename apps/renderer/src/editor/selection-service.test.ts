import { describe, expect, it } from 'vitest';
import { classifySelection } from './selection-service';

const lineCol = (source: string, index: number): { startLine: number; startCol: number; endLine: number; endCol: number } => {
  // helper: build a selection covering [index, endIndex) given as offsets
  const upto = source.slice(0, index);
  const lines = upto.split('\n');
  return { startLine: lines.length, startCol: (lines[lines.length - 1]?.length ?? 0) + 1, endLine: 1, endCol: 1 };
};

function selFor(source: string, snippet: string): { startLine: number; startCol: number; endLine: number; endCol: number } {
  const start = source.indexOf(snippet);
  const end = start + snippet.length;
  const before = source.slice(0, start).split('\n');
  const selStartLine = before.length;
  const selStartCol = (before[before.length - 1]?.length ?? 0) + 1;
  const within = source.slice(0, end).split('\n');
  return { startLine: selStartLine, startCol: selStartCol, endLine: within.length, endCol: (within[within.length - 1]?.length ?? 0) + 1 };
}

describe('classifySelection', () => {
  it('classifies a function declaration', () => {
    const src = 'const a = 1;\n\nfunction sum(a, b) {\n  return a + b;\n}\n';
    expect(classifySelection(src, selFor(src, 'function sum(a, b) {\n  return a + b;\n}'))).toBe('function');
  });

  it('classifies an arrow function expression', () => {
    const src = 'const double = (x) => x * 2;\n';
    expect(classifySelection(src, selFor(src, '(x) => x * 2'))).toBe('function');
  });

  it('classifies a class declaration', () => {
    const src = 'class User {}\n';
    expect(classifySelection(src, selFor(src, 'class User {}'))).toBe('class');
  });

  it('classifies a bare expression', () => {
    const src = 'const users = [];\nusers.filter((x) => x.active);\n';
    expect(classifySelection(src, selFor(src, 'users.filter((x) => x.active)'))).toBe('expression');
  });

  it('classifies a single statement', () => {
    const src = 'let x = 1;\nx = x + 1;\n';
    expect(classifySelection(src, selFor(src, 'x = x + 1;'))).toBe('statement');
  });

  it('falls back to block for multi-statement selections', () => {
    const src = 'let x = 1;\nlet y = 2;\nlet z = 3;\n';
    expect(classifySelection(src, selFor(src, 'let x = 1;\nlet y = 2;'))).toBe('block');
  });

  it('classifies JSX element as expression', () => {
    const src = 'const el = <div className="a">hi</div>;\n';
    expect(classifySelection(src, selFor(src, '<div className="a">hi</div>'))).toBe('expression');
  });

  it('handles TS annotations', () => {
    const src = 'function greet(name: string): string {\n  return `hi ${name}`;\n}\n';
    expect(classifySelection(src, selFor(src, 'function greet(name: string): string {\n  return `hi ${name}`;\n}'))).toBe('function');
  });

  it('unparseable source falls back to block', () => {
    expect(classifySelection('function {{{{', { startLine: 1, startCol: 1, endLine: 1, endCol: 5 })).toBe('block');
  });
});
