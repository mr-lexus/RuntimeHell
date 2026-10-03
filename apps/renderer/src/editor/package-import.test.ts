import { describe, expect, it } from 'vitest';
import type { PkgImportInfo } from '@rh/protocol';
import { planPackageImport } from './package-import';

const info: PkgImportInfo = { name: 'demo-lib', version: '1.2.3', bindings: [{ kind: 'named', imported: 'create', local: 'create' }], source: 'readme', example: "import { create } from 'demo-lib';\nconsole.log(create());", workspaceModuleType: 'commonjs', supportsImport: true, supportsRequire: true };
function insert(code: string, options: Partial<PkgImportInfo> = {}, path = 'entry.ts', example = false): string {
  const plan = planPackageImport(code, path, { ...info, ...options }, example);
  if (!plan.ok) throw new Error(plan.message);
  return [...plan.edits].sort((a, b) => b.offset - a.offset).reduce((text, edit) => text.slice(0, edit.offset) + edit.text + text.slice(edit.offset), code);
}

describe('safe package import edits', () => {
  it('comments every line of untrusted version metadata too', () => {
    const code = insert('', { version: '1\nthrow Error("unsafe");\u2028//' }, 'entry.ts', true);
    expect(code).toContain('// throw Error("unsafe");');
    expect(code.split('\n').filter((line) => line.trim() && !line.startsWith('//'))).toEqual(["import { create } from 'demo-lib';"]);
  });
  it('inserts before code, never inside a function or string', () => {
    const code = 'function demo() {\n  return "example";\n}\ndemo();';
    expect(insert(code)).toBe("import { create } from 'demo-lib';\n" + code);
  });
  it('preserves a shebang, directives, file headers and CRLF', () => {
    const code = '#!/usr/bin/env node\r\n// @ts-nocheck\r\n"use strict";\r\nconst value = 1;';
    expect(insert(code)).toBe('#!/usr/bin/env node\r\n// @ts-nocheck\r\n"use strict";\r\nimport { create } from \'demo-lib\';\r\n\r\nconst value = 1;');
  });
  it('keeps a leading JSDoc attached to its declaration', () => {
    const code = '// @ts-check\n/** Does useful work. */\nfunction example() {}';
    expect(insert(code)).toBe("// @ts-check\nimport { create } from 'demo-lib';\n\n/** Does useful work. */\nfunction example() {}");
  });
  it('inserts after a multiline import and its inline comment, preserving quote style', () => {
    const code = 'import {\n  value\n} from "existing"; // explanation\n/** keep attached */\nfunction work() {}';
    expect(insert(code)).toBe('import {\n  value\n} from "existing"; // explanation\nimport { create } from "demo-lib";\n\n/** keep attached */\nfunction work() {}');
  });
  it.each([
    "import { other } from 'demo-lib';",
    "import * as api from 'demo-lib';",
    "import 'demo-lib';",
    "const api = require('demo-lib');",
    "const api = await import('demo-lib');",
    "import api = require('demo-lib');",
    "import api from 'npm:demo-lib';"
  ])('does not duplicate %s', (code) => {
    expect(planPackageImport(code, 'entry.ts', info, true)).toMatchObject({ ok: false, message: expect.stringContaining('already imported') });
  });
  it('does not mistake a type-only import or a comment for a runtime import', () => {
    const code = "import type { create } from 'demo-lib';\n// require('demo-lib')\nconst text = 'require(';";
    expect(insert(code)).toContain("import { create as create2 } from 'demo-lib';");
  });
  it('avoids conflicts with identifiers in nested scopes and globals', () => {
    expect(insert('function x(create: string) { return create; }')).toContain('create as create2');
    expect(insert('', { name: 'console', source: 'namespace', bindings: [{ kind: 'namespace', local: 'packageApi' }] })).toContain('import * as console2');
  });
  it('makes valid aliases for scoped, hyphenated, numeric and reserved names', () => {
    for (const [name, alias] of [['@scope/some-lib', 'someLib'], ['123-lib', 'pkg123Lib'], ['class', 'classPackage']]) {
      expect(insert('', { name, source: 'namespace', bindings: [{ kind: 'namespace', local: 'packageApi' }] })).toContain(`import * as ${alias} from`);
    }
  });
  it.each(['entry.cjs', 'entry.cts'])('uses require in %s without making it a module', (path) => {
    expect(insert('const value = 42;', {}, path)).toBe("const demoLib = require('demo-lib');\nconst value = 42;");
  });
  it('keeps existing CommonJS style but never guesses require support for an ESM-only package', () => {
    expect(insert("const fs = require('fs');")).toContain("const demoLib = require('demo-lib');");
    expect(planPackageImport('module.exports = {};', 'entry.js', { ...info, supportsRequire: false }, false).ok).toBe(false);
  });
  it('refuses incomplete syntax, declarations and non-source files without any edits', () => {
    for (const [code, path] of [['function x(', 'entry.ts'], ['{}', 'package.json'], ['', 'types.d.ts']]) {
      expect(planPackageImport(code!, path!, info, true).ok).toBe(false);
    }
  });
  it('supports JSX and TSX without corrupting generic TypeScript assertions', () => {
    expect(insert('const x = <div />;', {}, 'entry.tsx')).toContain('const x = <div />;');
    expect(insert('const x = <number>42;', {}, 'entry.ts')).toContain('const x = <number>42;');
  });
  it('keeps README examples inert, including comment terminators and Unicode newlines', () => {
    const code = 'const original = 42; // no final newline';
    const result = insert(code, { example: '*/ alert(1);\u2028alert(2);\u2029alert(3);\ralert(4);' }, 'entry.ts', true);
    expect(result).toContain(code + '\n\n// Example from');
    expect(result).toContain('// */ alert(1);\n// alert(2);\n// alert(3);\n// alert(4);');
  });
  it('combines the import and example into one edit for an empty file', () => {
    const result = planPackageImport('', 'entry.ts', info, true);
    expect(result.ok && result.edits.length).toBe(1);
  });
  it('rejects files whose script syntax cannot safely become an ES module', () => {
    expect(planPackageImport('with (object) { value(); }', 'entry.mjs', info, false).ok).toBe(false);
  });
  it('respects the workspace module type for JS and explicit module extensions', () => {
    expect(insert('console.log(42);', {}, 'entry.js')).toContain("const demoLib = require('demo-lib');");
    expect(insert('', { workspaceModuleType: 'module' }, 'entry.js')).toContain('import { create }');
    expect(insert('', {}, 'entry.mjs')).toContain('import { create }');
  });
  it('honors the editor language override rather than only the filename', () => {
    const ts = planPackageImport('const x: number = 42;', 'entry.js', info, false, 'typescript');
    expect(ts.ok && ts.edits[0]?.text).toContain('import { create }');
    const js = planPackageImport('console.log(42);', 'entry.ts', info, false, 'javascript');
    expect(js.ok && js.edits[0]?.text).toContain("const demoLib = require('demo-lib');");
  });
});
