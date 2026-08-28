/**
 * Capture prelude tests (runtime switching): the SELF-CONTAINED Deno/Bun
 * prelude (templates/capture-prelude.cjs) executed under the REAL system node
 * — node is guaranteed present, and the prelude's stderr writer falls back to
 * process.stderr.write when `Deno` is undefined — proving the sentinel frames
 * it emits parse with the same ProcessRunner parsers used for the Node lane.
 * Deno/Bun-specific execution is covered by runtime-switch.net.test.ts.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { injectCapture } from './result-capture.js';
import { parseConsoleFrame, parseReportFrame, type ConsoleFrame, type ReportFrame } from './report-transport.js';

// Vitest executes this spec from its source location, so __dirname is
// reliable (same pattern as process-runner.reports.test.ts).
const PRELUDE = readFileSync(join(__dirname, 'templates', 'capture-prelude.cjs'), 'utf8');

let sandbox: string;
let seq = 0;

beforeAll(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'rh-prelude-'));
});

afterAll(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

interface RunOut {
  stdout: string;
  stderr: string;
}

/** Write prelude+program and execute it under the real system node. */
function runProgram(program: string): Promise<RunOut> {
  const file = join(sandbox, `program-${++seq}.cjs`);
  return writeFile(file, `${PRELUDE}\n${program}`, 'utf8').then(
    () =>
      new Promise<RunOut>((resolve, reject) => {
        const child = spawn(process.execPath, [file], { windowsHide: true });
        let stdout = '';
        let stderr = '';
        child.stdout?.on('data', (d) => {
          stdout += String(d);
        });
        child.stderr?.on('data', (d) => {
          stderr += String(d);
        });
        child.on('error', reject);
        child.on('close', () => resolve({ stdout, stderr }));
      })
  );
}

/** Parse every sentinel line of a kind out of stderr. */
function reportFrames(stderr: string): ReportFrame[] {
  return stderr
    .split(/\r?\n/)
    .filter((l) => l.startsWith('__RH__') && !l.startsWith('__RH_CONSOLE__'))
    .map((l) => parseReportFrame(l.slice('__RH__'.length)))
    .filter((f): f is ReportFrame => f !== null);
}

function consoleFrames(stderr: string): ConsoleFrame[] {
  return stderr
    .split(/\r?\n/)
    .filter((l) => l.startsWith('__RH_CONSOLE__'))
    .map((l) => parseConsoleFrame(l.slice('__RH_CONSOLE__'.length)))
    .filter((f): f is ConsoleFrame => f !== null);
}

describe('capture prelude (executed under real node)', () => {
  it('emits __RH__ report frames that parse with the standard parser', async () => {
    const { stderr } = await runProgram('__rh.report(0, { a: 1, b: [1, 2] }, 1);\n');
    const frames = reportFrames(stderr);
    expect(frames).toHaveLength(1);
    const f = frames[0];
    expect(f?.index).toBe(0);
    expect(f?.phase).toBe('immediate');
    expect(f?.line).toBe(1);
    expect(f?.nonce).toBe(1);
    expect(f?.value?.t).toBe('object');
    expect(f?.value?.children?.map((c) => c.k)).toEqual(['a', 'b', '[[Prototype]]']);
    expect(f?.value?.children?.[1]?.node.t).toBe('array');
  });

  it('emits __RH_CONSOLE__ frames with serialized args', async () => {
    const { stderr } = await runProgram("__rh.console(2, 'log', ['hi', 42]);\n");
    const frames = consoleFrames(stderr);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ line: 2, level: 'log', text: 'hi 42' });
    expect(frames[0]?.args).toEqual([
      { t: 'string', prim: 'hi' },
      { t: 'number', prim: '42' }
    ]);
  });

  it('serializes Map/Set/circular refs/Date/Error like the node serializer', async () => {
    const program = [
      'var m = new Map([["k", 1]]);',
      'var s = new Set([7]);',
      'var c = { name: "root" }; c.self = c;',
      'var d = new Date("2026-01-02T03:04:05.000Z");',
      'var e = new TypeError("boom");',
      '__rh.report(0, m, 1); __rh.report(1, s, 2); __rh.report(2, c, 3); __rh.report(3, d, 4); __rh.report(4, e, 5);'
    ].join('\n');
    const { stderr } = await runProgram(program);
    const frames = reportFrames(stderr);
    expect(frames).toHaveLength(5);

    expect(frames[0]?.value).toMatchObject({ t: 'map', size: 1 });
    expect(frames[0]?.value?.children?.map((c) => c.k)).toEqual(['[0] key', '[0] value']);
    expect(frames[1]?.value).toMatchObject({ t: 'set', size: 1 });
    expect(frames[2]?.value?.t).toBe('object');
    const selfEdge = frames[2]?.value?.children?.find((c) => c.k === 'self')?.node;
    expect(selfEdge?.refId).toBe(0);
    expect(frames[3]?.value).toMatchObject({ t: 'date', prim: '2026-01-02T03:04:05.000Z' });
    expect(frames[4]?.value?.t).toBe('error');
    expect(frames[4]?.value?.label).toBe('TypeError');
  });

  it('emits the complete class prototype chain for inspector and console consumers', async () => {
    const program = [
      'class Base { baseMethod() {} }',
      'class Child extends Base { childMethod() {} }',
      '__rh.report(0, new Child(), 1);',
      '__rh.console(2, "log", [new Child()]);'
    ].join('\n');
    const { stderr } = await runProgram(program);
    const reports = reportFrames(stderr);
    const report = reports[0]?.value;
    const childProto = report?.children?.find((c) => c.k === '[[Prototype]]')?.node;
    const baseProto = childProto?.children?.find((c) => c.k === '[[Prototype]]')?.node;
    const objectProto = baseProto?.children?.find((c) => c.k === '[[Prototype]]')?.node;
    const nullProto = objectProto?.children?.find((c) => c.k === '[[Prototype]]')?.node;

    expect(childProto?.label).toBe('Child');
    expect(baseProto?.label).toBe('Base');
    expect(objectProto?.label).toBe('Object');
    expect(nullProto).toEqual({ t: 'null' });
    expect(consoleFrames(stderr)[0]?.args?.[0]?.children?.some((c) => c.k === '[[Prototype]]')).toBe(true);
  });

  it('ships promise settlement frames (immediate placeholder + fulfilled)', async () => {
    const { stderr } = await runProgram('__rh.report(0, Promise.resolve(42), 3);\n');
    const frames = reportFrames(stderr);
    expect(frames.map((f) => f.phase)).toEqual(['immediate', 'fulfilled']);
    expect(frames[0]?.value?.t).toBe('promise');
    expect(frames[1]?.value).toEqual({ t: 'number', prim: '42' });
    expect(frames[1]?.nonce).toBeGreaterThan(frames[0]?.nonce ?? 0);
  });

  it('composes with injectCapture output: report + console frames with authored lines', async () => {
    const captured = injectCapture('const x = 1 + 1;\nconsole.log("hi");\n');
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;

    const { stderr } = await runProgram(captured.code);
    const frames = reportFrames(stderr);
    // idx0 = x binding (line 1), idx1 = the replaced console call (line 2).
    expect(frames.find((f) => f.index === 0)?.value).toEqual({ t: 'number', prim: '2' });
    expect(frames.find((f) => f.index === 0)?.line).toBe(1);

    const consoles = consoleFrames(stderr);
    expect(consoles).toHaveLength(1);
    expect(consoles[0]).toMatchObject({ line: 2, level: 'log', text: 'hi' });
  });
});
