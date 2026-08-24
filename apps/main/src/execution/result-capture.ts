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

  const statements: t.Statement[] = [];
  let reportCount = 0;

  const reportCall = (valueExpr: t.Expression): t.ExpressionStatement => {
    const id = t.identifier('__rh');
    const call = t.callExpression(t.memberExpression(id, t.identifier('report')), [
      t.numericLiteral(reportCount),
      valueExpr
    ]);
    reportCount++;
    return t.expressionStatement(call);
  };

  for (const stmt of ast.program.body) {
    if (t.isExpressionStatement(stmt) && t.isExpression(stmt.expression)) {
      statements.push(reportCall(stmt.expression));
      continue;
    }
    if (t.isVariableDeclaration(stmt)) {
      statements.push(stmt);
      if (opts.captureDeclarations) {
        for (const decl of stmt.declarations) {
          if (t.isIdentifier(decl.id)) {
            statements.push(reportCall(t.identifier(decl.id.name)));
          }
        }
      }
      continue;
    }
    statements.push(stmt);
  }
  ast.program.body = statements;

  const output = generate(ast.program, { retainLines: false, compact: false });
  return { ok: true, code: output.code, reportCount };
}
