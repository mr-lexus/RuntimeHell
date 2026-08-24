/**
 * ResultCapture transform unit tests (plan todo 10).
 */
import { describe, expect, it } from 'vitest';
import { injectCapture } from './result-capture.js';

describe('injectCapture', () => {
  it('wraps top-level expression statements in order', () => {
    const out = injectCapture("foo();\nbar(1);\n");
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.reportCount).toBe(2);
    expect(out.code).toContain('__rh.report(0, foo())');
    expect(out.code).toContain('__rh.report(1, bar(1))');
  });

  it('captures variable declaration bindings by default', () => {
    const out = injectCapture('const x = compute();\nlet y;\n');
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    // y has no initializer and no meaningful value; still reported per spec
    // (binding capture reports every top-level binding).
    expect(out.reportCount).toBe(2);
    expect(out.code).toContain('__rh.report(0, x)');
    expect(out.code).toContain('__rh.report(1, y)');
  });

  it('captureDeclarations:false skips declaration reports', () => {
    const out = injectCapture('const x = compute();\nsideEffect();\n', { captureDeclarations: false });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.reportCount).toBe(1);
    expect(out.code).not.toContain('__rh.report(0, x)');
    expect(out.code).toContain('__rh.report(0, sideEffect())');
  });

  it('leaves nested statements untouched', () => {
    const src = "function f() {\n  inner();\n}\n";
    const out = injectCapture(src);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.reportCount).toBe(0);
    expect(out.code).toContain('inner();');
  });

  it('parses TS and JSX', () => {
    const ts = injectCapture('const n: number = answer() as number;\n');
    expect(ts.ok).toBe(true);
    const jsx = injectCapture('render(<Widget size={"lg"} />);\n');
    expect(jsx.ok).toBe(true);
    if (jsx.ok) expect(jsx.reportCount).toBe(1);
  });

  it('returns structured failure on syntax errors', () => {
    const out = injectCapture('const = = =;;\n');
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error.length).toBeGreaterThan(0);
  });
});
