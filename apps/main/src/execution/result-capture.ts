/**
 * ResultCapture transform (plan todo 10): injects __rh.report(index, value)
 * after top-level expression statements and for variable declaration bindings.
 * Transform failure → caller falls back to plain execution WITHOUT expression
 * results (feature degradation, never a run failure).
 */
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import generate from '@babel/generator';
import * as t from '@babel/types';

export interface CaptureTransformResult {
  ok: true;
  code: string;
  reportCount: number;
  /** True when the authored AST contains TypeScript-only syntax. */
  hasTypeScriptSyntax: boolean;
}

export interface CaptureTransformFailure {
  ok: false;
  error: string;
}

export interface InjectCaptureOptions {
  /** Emit `__rh.report` after top-level variable declarations (default ON). */
  readonly captureDeclarations?: boolean;
}

const DEFAULT_OPTIONS: Required<InjectCaptureOptions> = { captureDeclarations: true };

function containsTypeScriptSyntax(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsTypeScriptSyntax);
  if (value === null || typeof value !== 'object') return false;
  const node = value as Record<string, unknown>;
  const type = typeof node.type === 'string' ? node.type : '';
  if (type.startsWith('TS') || node.importKind === 'type' || node.exportKind === 'type') return true;
  return Object.values(node).some(containsTypeScriptSyntax);
}

export function injectCapture(
  source: string,
  options: InjectCaptureOptions = {}
): CaptureTransformResult | CaptureTransformFailure {
  const opts: Required<InjectCaptureOptions> = { ...DEFAULT_OPTIONS, ...options };
  let ast;
  try {
    ast = parse(source, { sourceType: 'unambiguous', plugins: ['jsx', 'typescript'], errorRecovery: false });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  const hasTypeScriptSyntax = containsTypeScriptSyntax(ast);

  // Wrap console.* calls with line-aware __rh.console for RunJS inline
  const CONSOLE_LEVELS = new Set(['log', 'error', 'warn', 'info', 'debug', 'table', 'dir', 'trace']);
  traverse(ast, {
    CallExpression(path) {
      const callee = path.node.callee;
      if (
        t.isMemberExpression(callee) &&
        t.isIdentifier(callee.object, { name: 'console' }) &&
        t.isIdentifier(callee.property) &&
        CONSOLE_LEVELS.has(callee.property.name) &&
        !callee.computed
      ) {
        const line = path.node.loc?.start.line ?? 0;
        const level = callee.property.name;
        // Preserve original call, prepend __rh.console(line, level, args)
        const argsArray = t.arrayExpression(path.node.arguments as t.Expression[]);
        const rhConsoleCall = t.callExpression(t.memberExpression(t.identifier('__rh'), t.identifier('console')), [
          t.numericLiteral(line),
          t.stringLiteral(level),
          argsArray
        ]);
        // Replace entirely: __rh.console renders the line itself (inline panel +
        // L-prefixed classic console), so the original would double-print.
        path.replaceWith(rhConsoleCall);
        path.skip();
      }
    }
  });

  const statements: t.Statement[] = [];
  let reportCount = 0;

  const reportCall = (valueExpr: t.Expression, line: number): t.ExpressionStatement => {
    const id = t.identifier('__rh');
    const call = t.callExpression(t.memberExpression(id, t.identifier('report')), [
      t.numericLiteral(reportCount),
      valueExpr,
      t.numericLiteral(line)
    ]);
    reportCount++;
    return t.expressionStatement(call);
  };

  for (const stmt of ast.program.body) {
    const line = stmt.loc?.start.line ?? 0;
    if (t.isExpressionStatement(stmt) && t.isExpression(stmt.expression)) {
      statements.push(reportCall(stmt.expression, line));
      continue;
    }
    if (t.isVariableDeclaration(stmt)) {
      statements.push(stmt);
      if (opts.captureDeclarations) {
        for (const decl of stmt.declarations) {
          if (t.isIdentifier(decl.id)) {
            const declLine = decl.loc?.start.line ?? line;
            statements.push(reportCall(t.identifier(decl.id.name), declLine));
          }
        }
      }
      continue;
    }
    statements.push(stmt);
  }
  ast.program.body = statements;

  // retainLines keeps authored line numbers stable through the transform so the
  // downstream esbuild sourcemap (and therefore stack remapping) still points
  // at the original .ts positions.
  const output = generate(ast.program, { retainLines: true, compact: false });
  return { ok: true, code: output.code, reportCount, hasTypeScriptSyntax };
}
