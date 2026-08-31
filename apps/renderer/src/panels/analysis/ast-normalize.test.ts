import { describe, expect, it } from 'vitest';
import { parseEmbeddedJson, parseSourceAst } from './ast-normalize';

describe('parseEmbeddedJson', () => {
  it('accepts a JSON document followed by diagnostics', () => {
    expect(parseEmbeddedJson('{"type":"Program","body":[]}\n[stderr]\nwarning')).toEqual({ type: 'Program', body: [] });
  });

  it('finds a JSON document wrapped in engine output', () => {
    expect(parseEmbeddedJson('AST output:\n{"type":"Program","body":[{"type":"Literal","value":"ok"}]}')).toEqual({
      type: 'Program',
      body: [{ type: 'Literal', value: 'ok' }]
    });
  });

  it('returns null for textual AST output', () => {
    expect(parseEmbeddedJson('--- AST ---\nFUNC at 0')).toBeNull();
  });

  it('does not mistake a scalar diagnostic for an AST root', () => {
    expect(parseEmbeddedJson('0')).toBeNull();
    expect(parseEmbeddedJson('{"root":0}')).toBeNull();
  });

  it('builds a structured source tree when V8 AST output is textual', () => {
    expect(parseSourceAst('function add(a: number, b: number) { return a + b; }')).toMatchObject({
      type: 'Program',
      body: [{ type: 'FunctionDeclaration', id: { name: 'add' } }]
    });
  });

  it('returns null for an empty source', () => {
    expect(parseSourceAst('  ')).toBeNull();
  });
});
