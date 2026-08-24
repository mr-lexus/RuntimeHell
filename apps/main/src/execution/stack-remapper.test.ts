/**
 * StackLineRemapper integration tests (plan todo 11): REAL esbuild-generated
 * sourcemaps, authored positions restored from generated .cjs frames.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { transform } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StackLineRemapper } from './stack-remapper.js';

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'rh-remap-'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function buildFixture(source: string): Promise<{ entryPath: string; mapPath: string }> {
  const result = await transform(source, {
    loader: 'ts',
    format: 'cjs',
    target: 'node22',
    sourcemap: true,
    sourcefile: 'entry.ts'
  });
  const entryPath = join(dir, 'entry.cjs');
  const mapPath = `${entryPath}.map`;
  await writeFile(entryPath, result.code, 'utf8');
  await writeFile(mapPath, result.map ?? '', 'utf8');
  return { entryPath, mapPath };
}

describe('StackLineRemapper', () => {
  it('rewrites frames pointing at the generated file to authored positions', async () => {
    const source = [
      '// authored line 1',
      'function boom(): never {',
      '  throw new Error("x");',
      '}',
      'try { boom(); } catch {}'
    ].join('\n');
    const { entryPath, mapPath } = await buildFixture(source);
    const collected: string[] = [];
    const remapper = new StackLineRemapper(mapPath, entryPath, (line) => collected.push(line));

    remapper.push(`    at boom (${entryPath}:2:9)\n`);
    remapper.push(`    at Object.<anonymous> (${entryPath}:5:7)\n`);
    remapper.flush();
    await remapper.settle();

    expect(collected.length).toBe(2);
    expect(collected[0]).toContain('entry.ts:');
    expect(collected[0]).not.toContain('.cjs');
    expect(collected[1]).toContain('entry.ts:');
  });

  it('leaves foreign files and non-frame lines untouched', async () => {
    const { entryPath, mapPath } = await buildFixture('const a = 1;\n');
    const collected: string[] = [];
    const remapper = new StackLineRemapper(mapPath, entryPath, (line) => collected.push(line));

    remapper.push('plain error text\n');
    remapper.push('    at other (C:\\elsewhere\\other.cjs:1:1)\n');
    remapper.flush();
    await remapper.settle();

    // The callback receives the raw line; newline termination is the host's
    // concern (the manager re-appends it when emitting protocol events).
    expect(collected).toEqual(['plain error text', '    at other (C:\\elsewhere\\other.cjs:1:1)']);
  });

  it('preserves arrival order across async mapping', async () => {
    const { entryPath, mapPath } = await buildFixture('const a = 1;\nconst b = a;\n');
    const collected: string[] = [];
    const remapper = new StackLineRemapper(mapPath, entryPath, (line) => collected.push(line));

    for (let i = 1; i <= 20; i++) {
      remapper.push(`    at f (${entryPath}:${i}:1)\n`);
    }
    await remapper.settle();

    expect(collected.length).toBe(20);
    const lines = collected.map((l) => /:(\d+):/.exec(l)?.[1]);
    const sorted = [...lines].sort((a, b) => Number(a) - Number(b));
    expect(lines).toEqual(sorted);
  });

  it('passes everything through when no map exists', async () => {
    const collected: string[] = [];
    const remapper = new StackLineRemapper(null, join(dir, 'x.cjs'), (line) => collected.push(line));
    remapper.push('    at whatever (x.cjs:9:1)\n');
    remapper.flush();
    await remapper.settle();
    expect(collected).toEqual(['    at whatever (x.cjs:9:1)']);
  });
});
