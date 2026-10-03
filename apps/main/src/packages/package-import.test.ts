import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { inspectPackageImport, readmeImport } from './package-import.js';

let sandbox = '';
let root = '';
beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'rh-import-'));
  root = join(sandbox, 'workspace');
  await mkdir(root);
  await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: { 'demo-lib': '^1', '@scope/demo': '^1', '@types/demo': '^1' } }));
});
afterEach(async () => { await rm(sandbox, { recursive: true, force: true }); });

async function fixture(manifest: object = {}, readme?: string, name = 'demo-lib'): Promise<string> {
  const dir = join(root, 'node_modules', name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name, version: '1.2.3', main: 'index.js', ...manifest }));
  await writeFile(join(dir, 'index.js'), 'throw new Error("Package code must never be executed to inspect imports");');
  if (readme) await writeFile(join(dir, 'README.md'), readme);
  return dir;
}

describe('installed package import metadata', () => {
  it('reads an installed README, not latest registry data, without executing code', async () => {
    await fixture({}, "```js\nimport { create as make } from 'demo-lib';\nconsole.log(make());\n```\n");
    expect(await inspectPackageImport(root, 'demo-lib')).toMatchObject({ ok: true, info: { name: 'demo-lib', version: '1.2.3', source: 'readme', bindings: [{ kind: 'named', imported: 'create', local: 'make' }], supportsImport: true, supportsRequire: true } });
  });
  it('uses a namespace fallback for absent or unsuitable examples', async () => {
    await fixture({}, "```js\nimport x from 'another-package';\nx();\n```\n");
    expect(await inspectPackageImport(root, 'demo-lib')).toMatchObject({ ok: true, info: { source: 'namespace', example: null } });
  });
  it('keeps CommonJS examples as inert documentation without assuming ESM named exports', async () => {
    await fixture({}, "```js\nconst lib = require('demo-lib');\nlib();\n```\n");
    expect(await inspectPackageImport(root, 'demo-lib')).toMatchObject({ ok: true, info: { source: 'namespace', example: expect.stringContaining('require') } });
  });
  it('supports scoped packages and dual module exports', async () => {
    const dir = await fixture({ type: 'module', exports: { '.': { import: './index.mjs', require: './index.cjs' } } }, undefined, '@scope/demo');
    await writeFile(join(dir, 'index.mjs'), 'export default 42;');
    await writeFile(join(dir, 'index.cjs'), 'module.exports = 42;');
    expect(await inspectPackageImport(root, '@scope/demo')).toMatchObject({ ok: true, info: { supportsImport: true, supportsRequire: true } });
  });
  it('respects conditional default fallback and rejects ESM-only require', async () => {
    await fixture({ type: 'module', exports: { node: { types: './types.d.ts' }, default: './index.js' } });
    expect(await inspectPackageImport(root, 'demo-lib')).toMatchObject({ ok: true, info: { supportsImport: true, supportsRequire: false } });
  });
  it.each([{ exports: { './subpath': './index.js' } }, { exports: null }, { exports: { '.': null } }, { exports: '../private.js' }, { main: 'data.json' }])('does not invent a root JS entry: %j', async (manifest) => {
    await fixture(manifest);
    expect((await inspectPackageImport(root, 'demo-lib')).ok).toBe(false);
  });
  it('refuses traversal, uninstalled packages and type-only packages', async () => {
    for (const name of ['../private', 'not-installed', '@types/demo']) expect((await inspectPackageImport(root, name)).ok).toBe(false);
  });
  it('refuses package symlinks outside the workspace', async () => {
    const outside = join(sandbox, 'outside');
    await mkdir(outside);
    await writeFile(join(outside, 'package.json'), '{"version":"1.0.0"}');
    await mkdir(join(root, 'node_modules'));
    await symlink(outside, join(root, 'node_modules', 'demo-lib'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(await inspectPackageImport(root, 'demo-lib')).toMatchObject({ ok: false, message: expect.stringContaining('outside this workspace') });
  });
  it('ignores oversized README files but does not reject large code bundles', async () => {
    const dir = await fixture({}, 'x'.repeat(1024 * 1024 + 1));
    await writeFile(join(dir, 'index.js'), '// large bundle\n' + ' '.repeat(1024 * 1024 + 1));
    expect(await inspectPackageImport(root, 'demo-lib')).toMatchObject({ ok: true, info: { example: null } });
  });
  it('ignores incomplete, type-only and oversized snippets', () => {
    for (const code of ["import type { X } from 'demo-lib';", "import x from 'demo-lib';\nx(", "import x from 'demo-lib';\n" + '// comment\n'.repeat(60)]) expect(readmeImport('```ts\n' + code + '\n```', 'demo-lib')).toBeNull();
  });
});
