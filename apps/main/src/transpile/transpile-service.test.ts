/**
 * TranspileService tests (plan todo 9 QA): REAL esbuild transforms + REAL
 * sourcemap remapping of a runtime error thrown from TS.
 */
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bundleBrowserTo, needsTranspile, outputNameFor, passthroughTo, remapStack, transpileTo } from './transpile-service.js';

const execFileP = promisify(execFile);

let dir: string;
let nodeExe: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'rh-transpile-'));
});

afterAll(async () => {
  delete process.env['RH_CACHE_ROOT'];
  await rm(dir, { recursive: true, force: true });
});

const TS_SOURCE = `interface User { name: string }
function greet(u: User): string {
  const msg: string = \`hello \${u.name}\`;
  throw new Error('boom at known line');
}
greet({ name: 'x' });
`;

describe('transpile-service', () => {
  it('classifies files needing transpile', () => {
    expect(needsTranspile('a.ts')).toBe(true);
    expect(needsTranspile('b.tsx')).toBe(true);
    expect(needsTranspile('c.js')).toBe(false);
    expect(outputNameFor('src/entry.ts')).toBe('entry.cjs');
    expect(outputNameFor('App.tsx')).toBe('App.cjs');
  });

  it('transpiles TS to runnable CJS with sourcemap; runtime stack remaps to original line', async () => {
    process.env['RH_CACHE_ROOT'] = dir;
    const result = await transpileTo(join(dir, '.rhbuild'), 'entry.ts', TS_SOURCE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Execute the generated file and capture the thrown stack (generated positions).
    let generatedStack = '';
    try {
      await execFileP(process.execPath, [result.outputPath]);
      throw new Error('expected child to fail');
    } catch (err) {
      generatedStack = String((err as { stderr?: string }).stderr ?? '');
    }
    expect(generatedStack).toContain('boom at known line');

    if (!result.mapPath) throw new Error('sourcemap missing');
    const remapped = await remapStack(
      generatedStack,
      result.mapPath,
      result.outputPath.replace(/\\/g, '/')
    );
    // The original authored line of the throw is line 4 of entry.ts.
    expect(remapped).toContain(':4:');
  }, 30000);

  it('returns structured diagnostics for syntax errors', async () => {
    process.env['RH_CACHE_ROOT'] = dir;
    const result = await transpileTo(join(dir, '.rhbuild'), 'broken.ts', 'const x: = ;\n');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]?.text).toBeTruthy();
  });

  it('passthrough copies plain JS untouched', async () => {
    process.env['RH_CACHE_ROOT'] = dir;
    const res = await passthroughTo(join(dir, '.rhbuild'), 'plain.js', 'console.log(1);\n');
    expect(res.ok).toBe(true);
    expect(res.mapPath).toBeNull();
  });

  it('transpiles TypeScript selected for a .js source tab', async () => {
    process.env['RH_CACHE_ROOT'] = dir;
    const result = await transpileTo(join(dir, '.rhbuild'), 'entry.js', 'const answer: number = 42; console.log(answer);');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const output = await fs.readFile(result.outputPath, 'utf8');
    expect(output).toContain('answer = 42');
    expect(output).not.toContain(': number');
  });

  it('bundles a CommonJS workspace package for the browser lane', async () => {
    process.env['RH_CACHE_ROOT'] = dir;
    const workspace = join(dir, 'browser-workspace');
    const packageDir = join(workspace, 'node_modules', 'fixture-equal');
    await fs.mkdir(packageDir, { recursive: true });
    await fs.writeFile(join(packageDir, 'package.json'), JSON.stringify({ name: 'fixture-equal', main: 'index.js' }), 'utf8');
    await fs.writeFile(join(packageDir, 'index.js'), 'module.exports = (a, b) => JSON.stringify(a) === JSON.stringify(b);', 'utf8');

    const result = await bundleBrowserTo(
      join(workspace, '.rhbuild'),
      workspace,
      'entry.js',
      "var equal = require('fixture-equal'); __rh.report(0, equal({ foo: 'bar' }, { foo: 'bar' }));"
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const output = await fs.readFile(result.outputPath, 'utf8');
    expect(output).not.toContain("require('fixture-equal')");
    expect(output).toContain('module.exports');
  });
});
