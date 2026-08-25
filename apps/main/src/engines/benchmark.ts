/**
 * Benchmark harness (plan todo 29): wraps a selection into a timing
 * benchmark, runs it on the current runtime, and returns structured results.
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { IsolatedRun } from '../execution/isolation.js';

export interface BenchResult {
  readonly opsPerSec: number;
  readonly meanMs: number;
  readonly p50: number | null;
  readonly p95: number | null;
  readonly samples: number;
  readonly error: string | null;
}

const HARNESS_TEMPLATE = `
async function main() {
  try {
    const fn = new Function('return (' + SNIPPET_PLACEHOLDER + ')')();
    if (typeof fn !== 'function') { console.error('[bench] not a function'); process.exit(1); }
    for (let i = 0; i < 100; i++) fn();
    const samples = [];
    for (let i = 0; i < 50; i++) {
      const t0 = performance.now();
      fn();
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const p50 = samples[Math.floor(samples.length * 0.5)] ?? null;
    const p95 = samples[Math.floor(samples.length * 0.95)] ?? null;
    const opsPerSec = mean > 0 ? 1000 / mean : 0;
    print(JSON.stringify({ opsPerSec, meanMs: mean, p50, p95, samples: samples.length, error: null }));
  } catch (e) {
    console.error('[bench-error] ' + (e && e.message ? e.message : String(e)));
    process.exit(1);
  }
}
main();
`;

export async function runBenchmark(
  code: string,
  exePath: string,
  workDir: string,
  timeoutMs: number,
  runIsolated: IsolatedRun
): Promise<BenchResult> {
  await fs.mkdir(workDir, { recursive: true });
  const benchFile = join(workDir, 'bench.js');
  const harness = HARNESS_TEMPLATE.replace('SNIPPET_PLACEHOLDER', JSON.stringify(code));
  await fs.writeFile(benchFile, harness, 'utf8');

  const run = await runIsolated({
    exePath,
    args: [benchFile],
    cwd: workDir,
    timeoutMs
  });

  const output = run.stdout.trim();
  try {
    const lines = output.split('\n');
    let jsonLine: string | undefined;
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (line !== undefined && line.startsWith('{')) { jsonLine = line; break; }
    }
    if (jsonLine !== undefined) return JSON.parse(jsonLine) as BenchResult;
  } catch {
    /* fall through */
  }
  return { opsPerSec: 0, meanMs: 0, p50: null, p95: null, samples: 0, error: output.slice(0, 500) || 'no output' };
}
