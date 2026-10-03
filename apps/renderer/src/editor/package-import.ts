import { parse, type ParserOptions } from '@babel/parser';
import { PkgImportInfoSchema, type PkgImportInfo } from '@rh/protocol';

export type PackageImportResult = { ok: boolean; message: string };
export interface PackageImportController {
  insert: (path: string, info: PkgImportInfo, example: boolean) => PackageImportResult;
}
export type PackageImportPlan = { ok: true; edits: { offset: number; text: string }[]; message: string } | { ok: false; message: string };

function identifiers(tree: unknown): { names: Set<string>; commonjs: boolean } {
  const names = new Set(['console', 'Object', 'JSON', 'Math', 'Promise', 'String', 'Number', 'Array', 'require', 'module', 'exports', 'process', 'globalThis']);
  let commonjs = false;
  const pending: unknown[] = [tree];
  while (pending.length) {
    const item = pending.pop();
    if (!item || typeof item !== 'object') continue;
    if (Array.isArray(item)) { pending.push(...item); continue; }
    const node = item as Record<string, unknown>;
    const callee = node.callee as Record<string, unknown> | undefined;
    const target = node.object as Record<string, unknown> | undefined;
    const property = node.property as Record<string, unknown> | undefined;
    if (node.type === 'CallExpression' && callee?.type === 'Identifier' && callee.name === 'require') commonjs = true;
    if (node.type === 'MemberExpression' && target?.type === 'Identifier' && (target.name === 'exports' || (target.name === 'module' && (property?.name === 'exports' || property?.value === 'exports')))) commonjs = true;
    if (node.type === 'Identifier' && typeof node.name === 'string') names.add(node.name);
    for (const [key, value] of Object.entries(node)) if (!['loc', 'comments', 'leadingComments', 'trailingComments', 'extra'].includes(key)) pending.push(value);
  }
  return { names, commonjs };
}

function packageName(name: string): string {
  const base = (name.split('/').pop() ?? 'package').replace(/[^\w$]+(.)?/g, (_match, next: string | undefined) => next?.toUpperCase() ?? '');
  return /^[A-Za-z_$]/.test(base) ? base : `pkg${base}`;
}

/** Offset-only edits preserve the rest of the document byte for byte. */
export function planPackageImport(code: string, path: string, info: PkgImportInfo, withExample: boolean, language?: string): PackageImportPlan {
  const validated = PkgImportInfoSchema.safeParse(info);
  if (!validated.success) return { ok: false, message: 'Invalid package import information. No code was changed.' };
  info = validated.data;
  if (!/\.(?:[cm]?[jt]s|[jt]sx)$/i.test(path) || /\.d\.[cm]?ts$/i.test(path)) return { ok: false, message: 'Open a JavaScript or TypeScript source file first.' };
  if (code.length > 1_000_000) return { ok: false, message: 'Automatic import is limited to source files under 1 MB. No code was changed.' };
  const typescript = language ? language === 'typescript' : /\.(?:[cm]?ts|tsx)$/i.test(path);
  const options: ParserOptions = { sourceType: 'unambiguous', allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true, plugins: typescript ? /\.tsx$/i.test(path) ? ['typescript', 'jsx'] : ['typescript'] : ['jsx'] };
  try {
    const ast = parse(code, options);
    const imports = ast.program.body.filter((node) => node.type === 'ImportDeclaration');
    const samePackage = (value: string): boolean => value === info.name || value === `npm:${info.name}`;
    for (const node of ast.program.body) {
      if (node.type === 'ImportDeclaration' && samePackage(node.source.value) && node.importKind !== 'type' && (node.specifiers.length === 0 || node.specifiers.some((specifier) => specifier.type !== 'ImportSpecifier' || specifier.importKind !== 'type'))) return { ok: false, message: `${info.name} is already imported. No duplicate was added.` };
      if (node.type === 'TSImportEqualsDeclaration' && node.importKind !== 'type' && node.moduleReference.type === 'TSExternalModuleReference' && samePackage(node.moduleReference.expression.value)) return { ok: false, message: `${info.name} is already imported. No duplicate was added.` };
      const expressions = node.type === 'VariableDeclaration' ? node.declarations.map((item) => item.init) : node.type === 'ExpressionStatement' ? [node.expression] : [];
      for (let expression of expressions) {
        if (expression?.type === 'AwaitExpression') expression = expression.argument;
        if ((expression?.type === 'CallExpression' && expression.callee.type === 'Identifier' && expression.callee.name === 'require' && expression.arguments[0]?.type === 'StringLiteral' && samePackage(expression.arguments[0].value)) || (expression?.type === 'ImportExpression' && expression.source.type === 'StringLiteral' && samePackage(expression.source.value))) return { ok: false, message: `${info.name} is already imported. No duplicate was added.` };
      }
    }
    const facts = identifiers(ast.program);
    const taken = facts.names;
    const commonjs = /\.c[jt]s$/i.test(path) || (!/\.m[jt]s$/i.test(path) && ast.program.sourceType !== 'module' && (facts.commonjs || (!typescript && info.workspaceModuleType === 'commonjs')));
    if (commonjs && !info.supportsRequire) return { ok: false, message: 'This package has no confirmed CommonJS entry. Use an ES-module file or import it manually.' };
    if (!commonjs && !info.supportsImport) return { ok: false, message: 'This package does not expose a root ES-module import. Use its documented entry point.' };
    const fresh = (suggested: string): string => {
      let base = suggested;
      try { parse(`import ${base} from 'pkg';`, { sourceType: 'module' }); } catch { base = `${base}Package`; }
      let candidate = base;
      for (let index = 2; taken.has(candidate); index++) candidate = `${base}${index}`;
      taken.add(candidate);
      return candidate;
    };
    const quote = imports[0]?.source.extra?.raw?.toString().startsWith('"') ? '"' : "'";
    const specifier = `${quote}${info.name}${quote}`;
    let declaration: string;
    if (commonjs) {
      // require returns module.exports directly, not an ESM namespace wrapper.
      const local = fresh(packageName(info.name));
      declaration = `const ${local} = require(${specifier});`;
    } else {
      const bindings = info.bindings.map((binding) => ({ ...binding, local: fresh(info.source === 'namespace' ? packageName(info.name) : binding.local) }));
      const defaultBinding = bindings.find((binding) => binding.kind === 'default');
      const namespace = bindings.find((binding) => binding.kind === 'namespace');
      const named = bindings.filter((binding) => binding.kind === 'named').map((binding) => binding.local === binding.imported ? binding.imported : `${binding.imported} as ${binding.local}`);
      const pieces = [defaultBinding?.local, namespace ? `* as ${namespace.local}` : named.length ? `{ ${named.join(', ')} }` : undefined].filter(Boolean);
      declaration = `import ${pieces.join(', ')} from ${specifier};`;
    }
    let offset = code.charCodeAt(0) === 0xfeff ? 1 : 0;
    offset = Math.max(offset, ast.program.interpreter?.end ?? 0, ast.program.directives.at(-1)?.end ?? 0);
    const lastImport = imports.at(-1);
    if (lastImport) {
      offset = lastImport.end ?? offset;
      // Keep same-line comments attached to their existing import.
      for (const comment of lastImport.trailingComments ?? []) {
        if (comment.start === undefined || comment.end === undefined) continue;
        if (comment.start >= offset && !/[\r\n]/.test(code.slice(offset, comment.start))) offset = comment.end;
      }
    } else {
      const firstStatement = ast.program.body[0]?.start ?? code.length;
      for (const comment of ast.comments ?? []) {
        if (comment.start === undefined || comment.end === undefined) continue;
        if (comment.start < offset || comment.end > firstStatement) continue;
        // Preserve file headers and TS directives, but don't detach JSDoc
        // from the function/class it documents.
        if (comment.type === 'CommentBlock' && comment.value.startsWith('*') && !/@license|@preserve/.test(comment.value)) break;
        if (code.slice(offset, comment.start).trim() === '') offset = comment.end;
      }
    }
    const newline = code.includes('\r\n') ? '\r\n' : '\n';
    const prefix = offset > 0 && !/[\r\n\u2028\u2029]/.test(code[offset - 1] ?? '') && code[offset - 1] !== '\uFEFF' ? newline : '';
    const edits = [{ offset, text: `${prefix}${declaration}${newline}` }];
    if (withExample && info.example) {
      // Each physical line is commented separately, including JS Unicode
      // line separators. A hostile README cannot terminate this comment.
      const example = `Example from ${info.name}@${info.version} README (adapt before using):\n${info.example}`.split(/\r\n|[\n\r\u2028\u2029]/).map((line) => `// ${line}`).join(newline);
      const text = `${newline}${newline}${example}${newline}`;
      if (offset === code.length) edits[0]!.text += text;
      else edits.push({ offset: code.length, text });
    }
    const next = [...edits].sort((a, b) => b.offset - a.offset).reduce((value, edit) => value.slice(0, edit.offset) + edit.text + value.slice(edit.offset), code);
    parse(next, options); // Refuse edits that would make a valid file invalid.
    return { ok: true, edits, message: `Imported ${info.name} into ${path}${withExample && info.example ? ' with a commented README example' : ''}. Undo restores the previous code.` };
  } catch {
    return { ok: false, message: 'Finish or fix the current syntax before inserting an import. No code was changed.' };
  }
}
