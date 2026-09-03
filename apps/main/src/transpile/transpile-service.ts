/**
 * TranspileService (plan todo 9, D5): TS/TSX → CJS via esbuild API in the main
 * process, with external source maps for stack remapping. Non-TS files pass
 * through unchanged. Transform failures return structured diagnostics; the
 * runner is never invoked for broken sources.
 */
import { build, transform, type BuildFailure, type TransformFailure } from 'esbuild';
import { dirname, join } from 'node:path';
import { promises as fs } from 'node:fs';
import { originalPositionFor, TraceMap, type TraceMap as TraceMapType } from '@jridgewell/trace-mapping';

export interface TranspileSuccess {
  ok: true;
  outputPath: string;
  mapPath: string | null;
}

export interface TranspileFailure {
  ok: false;
  errors: { text: string; line?: number; column?: number }[];
}

export type TranspileResult = TranspileSuccess | TranspileFailure;

/**
 * Browser bundles are written to the same build directory as regular entries.
 * The browser lane has no Node module loader, so workspace imports and
 * CommonJS `require('package')` calls must be resolved before the source is
 * handed to Chromium. Keeping this beside the regular transpiler makes the
 * boundary explicit and gives the caller structured esbuild diagnostics.
 */
export async function bundleBrowserTo(
  buildDir: string,
  workspaceDir: string,
  relPath: string,
  source: string
): Promise<TranspileResult> {
  const outName = outputNameFor(relPath);
  const outputPath = join(buildDir, outName);
  const resolveDir = join(workspaceDir, dirname(relPath));
  const loader = relPath.endsWith('.tsx') ? 'tsx' : relPath.endsWith('.ts') || relPath.endsWith('.mts') ? 'ts' : 'js';

  try {
    const result = await build({
      stdin: { contents: source, loader, sourcefile: relPath, resolveDir },
      bundle: true,
      write: false,
      format: 'iife',
      platform: 'browser',
      target: 'es2020',
      treeShaking: false,
      sourcemap: false,
      logLevel: 'silent'
    });
    const output = result.outputFiles[0];
    if (output === undefined) throw new Error('esbuild returned no browser bundle');
    await fs.mkdir(dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, output.text, 'utf8');
    return { ok: true, outputPath, mapPath: null };
  } catch (err) {
    const failure = err as BuildFailure & { errors?: { text: string; location?: { line?: number; column?: number } }[] };
    if (failure.errors) {
      return {
        ok: false,
        errors: failure.errors.map((e) => ({
          text: e.text,
          line: e.location?.line,
          column: e.location?.column
        }))
      };
    }
    return { ok: false, errors: [{ text: err instanceof Error ? err.message : String(err) }] };
  }
}

export function needsTranspile(relPath: string): boolean {
  return relPath.endsWith('.ts') || relPath.endsWith('.tsx') || relPath.endsWith('.mts');
}

export function outputNameFor(relPath: string): string {
  const base = relPath.split(/[\\/]/).pop() ?? 'entry';
  if (relPath.endsWith('.tsx')) return base.replace(/\.tsx$/, '.cjs');
  if (relPath.endsWith('.mts')) return base.replace(/\.mts$/, '.cjs');
  return base.replace(/\.ts$/, '.cjs');
}

/**
 * Transpile `source` (from workspace file `relPath`) into the build dir.
 * Returns the runnable .cjs path plus a sourcemap for remapping.
 *
 * `opts.banner` (runtime switching): contents prepended to the OUTPUT file —
 * used to inject the self-contained capture prelude for Deno/Bun. esbuild
 * keeps banner lines OUT of the source map (verified: `mappings` starts at
 * the first real source line), so stack remapping stays offset-correct even
 * though the prelude shifts generated line numbers.
 */
export async function transpileTo(
  buildDir: string,
  relPath: string,
  source: string,
  opts: { banner?: string } = {}
): Promise<TranspileResult> {
  const outName = outputNameFor(relPath);
  const outputPath = join(buildDir, outName);
  const loader = relPath.endsWith('.tsx') ? 'tsx' : 'ts';

  try {
    const result = await transform(source, {
      loader,
      format: 'cjs',
      target: 'node22',
      sourcemap: true,
      sourcefile: relPath,
      jsx: 'transform',
      ...(opts.banner !== undefined && opts.banner !== '' ? { banner: opts.banner } : {})
    });
    await fs.mkdir(dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, result.code, 'utf8');
    let mapPath: string | null = null;
    if (result.map) {
      mapPath = `${outputPath}.map`;
      await fs.writeFile(mapPath, result.map, 'utf8');
    }
    return { ok: true, outputPath, mapPath };
  } catch (err) {
    const failure = err as TransformFailure & { errors?: { text: string; location?: { line: number; column: number } }[] };
    if (failure.errors) {
      return {
        ok: false,
        errors: failure.errors.map((e) => ({
          text: e.text,
          line: e.location?.line,
          column: e.location?.column
        }))
      };
    }
    return { ok: false, errors: [{ text: err instanceof Error ? err.message : String(err) }] };
  }
}

/** Copy-through for plain JS files (no transform needed). */
export async function passthroughTo(buildDir: string, relPath: string, source: string): Promise<TranspileSuccess> {
  const outName = relPath.split(/[\\/]/).pop() ?? 'entry.js';
  const outputPath = join(buildDir, outName);
  await fs.mkdir(dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, source, 'utf8');
  return { ok: true, outputPath, mapPath: null };
}

// ---------------------------------------------------------------------------
// Stack remapping
// ---------------------------------------------------------------------------

const traceMaps = new Map<string, TraceMapType>();

export async function loadTraceMap(mapPath: string): Promise<TraceMapType> {
  const cached = traceMaps.get(mapPath);
  if (cached) return cached;
  const raw = JSON.parse(await fs.readFile(mapPath, 'utf8'));
  const tm = new TraceMap(raw);
  traceMaps.set(mapPath, tm);
  return tm;
}

export interface MappedFrame {
  originalLine: number | null;
  originalColumn: number | null;
  originalSource: string | null;
}

export async function mapFrame(
  mapPath: string,
  generatedLine: number,
  generatedColumn: number
): Promise<MappedFrame> {
  const tm = await loadTraceMap(mapPath);
  const pos = originalPositionFor(tm, { line: generatedLine, column: generatedColumn - 1 });
  return {
    originalLine: pos.line ?? null,
    originalColumn: pos.column !== null ? pos.column + 1 : null,
    originalSource: pos.source ?? null
  };
}

/**
 * Rewrite a node-style stack so frames pointing at the generated .cjs map back
 * to the authored .ts positions. Unmappable frames pass through untouched.
 */
export async function remapStack(stack: string, mapPath: string, generatedFile: string): Promise<string> {
  const norm = (p: string): string => p.replace(/\\/g, '/').toLowerCase();
  const target = norm(generatedFile);
  const out: string[] = [];

  for (const line of stack.split('\n')) {
    // Frame shape: "    at fn (PATH:L:C)" or "    at PATH:L:C".
    const frameMatch = /^\s*at\s+(?:(.*?)\s+\()?(.*):(\d+):(\d+)\)?\s*$/.exec(line);
    if (!frameMatch) {
      out.push(line);
      continue;
    }
    const genLine = Number(frameMatch[3]);
    const genCol = Number(frameMatch[4]);
    const rawPath = frameMatch[2] ?? '';
    if (norm(rawPath) !== target) {
      out.push(line);
      continue;
    }
    try {
      const mapped = await mapFrame(mapPath, genLine, genCol);
      if (mapped.originalLine !== null) {
        const fn = frameMatch[1] ? `${frameMatch[1]} (` : '';
        out.push(`    at ${fn}${rawPath}:${mapped.originalLine}:${mapped.originalColumn})`);
        continue;
      }
    } catch {
      /* fall through to raw frame */
    }
    out.push(line);
  }
  return out.join('\n');
}
