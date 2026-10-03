/**
 * PackageService (plan todo 13, D7): npm operations scoped to a workspace.
 *
 * npm binary resolution order (D7): managed active runtime's bundled npm →
 * PATH npm → structured error with setup guidance. Installs run with
 * `--ignore-scripts` unless explicitly enabled (settings toggle lands todo 21;
 * the flag is a parameter today, default ON). All npm stdout/stderr lines are
 * streamed verbatim through an injected sink so the Packages panel can show
 * failures exactly as npm reported them.
 */
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import type { PkgEvent, PkgOpResponse, PkgSearchRow } from '@rh/protocol';
import { z } from 'zod';
import { workspaceRoot } from '../workspace/files.js';
import { managedRuntimeDir } from '../runtimes/runtime-resolver.js';
import { lookupCommand } from '../runtimes/runtime-detection.js';
import { executableName, isWindows, managedRuntimeExecutablePath } from '../platform.js';
import { inspectPackageImport } from './package-import.js';

export interface PackageServiceDeps {
  readonly emit: (event: PkgEvent) => void;
  /** Selected managed node version, when one exists (drives npm resolution). */
  readonly managedNodeVersion?: () => string | null;
}

export interface SpawnedCli {
  code: number | null;
  stdout: string;
  stderr: string;
}

export type CliRunner = (
  exe: string,
  args: string[],
  cwd: string,
  onLine: (stream: 'stdout' | 'stderr', text: string) => void
) => Promise<SpawnedCli>;

const MAX_CLI_CAPTURE_CHARS = 1024 * 1024;
const MAX_STREAM_LINE_CHARS = 64 * 1024;
const DependencyMapSchema = z.record(z.string(), z.string());

function appendTail(current: string, text: string): string {
  const combined = current + text;
  return combined.length <= MAX_CLI_CAPTURE_CHARS ? combined : combined.slice(-MAX_CLI_CAPTURE_CHARS);
}

/** Default CLI runner: real child process, line-buffered output. */
export const nodeCliRunner: CliRunner = (exe, args, cwd, onLine) =>
  new Promise((resolve) => {
    const child = spawn(exe, args, { cwd, windowsHide: true });
    const collected = { stdout: '', stderr: '' };
    const pending = { stdout: '', stderr: '' };
    let settled = false;

    const makePump =
      (stream: 'stdout' | 'stderr') =>
      (chunk: Buffer): void => {
        const text = chunk.toString('utf8');
        collected[stream] = appendTail(collected[stream], text);
        pending[stream] += text;
        let newline = pending[stream].indexOf('\n');
        while (newline !== -1 || pending[stream].length >= MAX_STREAM_LINE_CHARS) {
          const splitAt = newline !== -1 && newline < MAX_STREAM_LINE_CHARS ? newline : MAX_STREAM_LINE_CHARS;
          const line = pending[stream].slice(0, splitAt).replace(/\r$/, '');
          pending[stream] = pending[stream].slice(splitAt + (splitAt === newline ? 1 : 0));
          onLine(stream, line);
          newline = pending[stream].indexOf('\n');
        }
      };

    const finish = (code: number | null, spawnError?: Error): void => {
      if (settled) return;
      settled = true;
      if (spawnError !== undefined) {
        collected.stderr = appendTail(collected.stderr, spawnError.message);
        pending.stderr += spawnError.message;
      }
      for (const stream of ['stdout', 'stderr'] as const) {
        if (pending[stream] !== '') onLine(stream, pending[stream].replace(/\r$/, ''));
      }
      resolve({ code, stdout: collected.stdout, stderr: collected.stderr });
    };

    const pumpOut = makePump('stdout');
    const pumpErr = makePump('stderr');
    child.stdout?.on('data', pumpOut);
    child.stderr?.on('data', pumpErr);

    child.on('error', (error) => finish(-1, error));
    child.on('close', (code) => finish(code));
  });

/**
 * Resolved npm execution strategy. We prefer running npm-cli.js DIRECTLY with
 * a sibling Node executable (no shell, no quoting hazards). A PATH executable
 * is a POSIX fallback; Windows .cmd shims are rejected if the direct layout
 * cannot be resolved safely.
 */
export type NpmResolution =
  | { kind: 'direct'; nodeExe: string; cliJs: string; origin: 'managed' | 'path' }
  | { kind: 'shell'; exePath: string; origin: 'path' }
  | { error: string };

export async function resolveNpm(
  managedVersion: string | null,
  probeFile: (p: string) => Promise<boolean> = defaultProbe,
  whereNpm: () => Promise<string | null> = defaultWhereNpm
): Promise<NpmResolution> {
  const npmCliRelative = isWindows()
    ? join('node_modules', 'npm', 'bin', 'npm-cli.js')
    : join('lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');

  // 1) Managed active runtime: bundled Node + its npm-cli.js.
  if (managedVersion !== null) {
    const dir = managedRuntimeDir(managedVersion);
    const nodeExe = managedRuntimeExecutablePath(dir, 'node');
    const cliJs = join(dir, npmCliRelative);
    if ((await probeFile(nodeExe)) && (await probeFile(cliJs))) {
      return { kind: 'direct', nodeExe, cliJs, origin: 'managed' };
    }
  }

  // 2) PATH npm (or npm.cmd) → derive sibling Node + npm-cli.js when present.
  const pathNpmCmd = await whereNpm();
  if (pathNpmCmd !== null) {
    const dir = dirname(pathNpmCmd);
    const nodeExe = join(dir, executableName('node'));
    const cliJs = join(dir, npmCliRelative);
    if ((await probeFile(nodeExe)) && (await probeFile(cliJs))) {
      return { kind: 'direct', nodeExe, cliJs, origin: 'path' };
    }
    if (isWindows()) {
      return { error: 'npm.cmd was found, but its adjacent node.exe/npm-cli.js could not be resolved safely' };
    }
    return { kind: 'shell', exePath: pathNpmCmd, origin: 'path' };
  }

  return {
    error:
      'npm not found — install Node.js (or a managed runtime in the Runtimes panel) and ensure npm is on PATH'
  };
}

async function defaultProbe(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function defaultWhereNpm(): Promise<string | null> {
  return lookupCommand('npm');
}

async function ensureWorkspacePackageJson(root: string): Promise<void> {
  const pkgPath = join(root, 'package.json');
  try {
    await fs.access(pkgPath);
    return;
  } catch {
    /* create below */
  }
  await fs.writeFile(pkgPath, JSON.stringify({ name: 'playground', private: true, type: 'commonjs' }, null, 2), 'utf8');
}

async function readDependencies(root: string): Promise<Record<string, string>> {
  try {
    const raw = await fs.readFile(join(root, 'package.json'), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || !('dependencies' in parsed)) return {};
    const dependencies = DependencyMapSchema.safeParse(parsed.dependencies);
    return dependencies.success ? dependencies.data : {};
  } catch {
    return {};
  }
}

const SEARCH_ENDPOINT = 'https://registry.npmjs.org/-/v1/search';
const RegistrySearchResponseSchema = z.object({
  objects: z.array(z.object({
    package: z.object({
      name: z.string().min(1),
      version: z.string().min(1),
      description: z.string().optional()
    }).passthrough(),
    score: z.object({ final: z.number().finite() }).passthrough().optional()
  }).passthrough()).default([])
}).passthrough();

export class PackageService {
  constructor(private readonly deps: PackageServiceDeps) {}

  private workspace(workspaceId: string): string {
    return workspaceRoot(workspaceId); // validates id
  }

  /** Install/uninstall shared path. */
  private async op(
    workspaceId: string,
    verb: 'install' | 'uninstall',
    spec: string,
    ignoreScripts: boolean,
    runCli: CliRunner,
    managedNodeVersion: string | null
  ): Promise<PkgOpResponse> {
    let root: string;
    try {
      root = this.workspace(workspaceId);
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err), stderrTail: '' };
    }
    await fs.mkdir(root, { recursive: true });
    await ensureWorkspacePackageJson(root);

    const npm = await resolveNpm(managedNodeVersion ?? this.deps.managedNodeVersion?.() ?? null);
    if ('error' in npm) return { ok: false, message: npm.error, stderrTail: '' };

    const verbArgs =
      verb === 'install'
        ? ['install', '--no-audit', '--no-fund', ...(ignoreScripts ? ['--ignore-scripts'] : []), spec]
        : ['uninstall', '--no-audit', '--no-fund', ...(ignoreScripts ? ['--ignore-scripts'] : []), spec];

    const sink = (stream: 'stdout' | 'stderr', text: string): void => {
      this.deps.emit({ workspaceId, stream, text });
    };

    let result: SpawnedCli;
    if (npm.kind === 'direct') {
      result = await runCli(npm.nodeExe, [npm.cliJs, ...verbArgs], root, sink);
    } else {
      result = await runCli(npm.exePath, verbArgs, root, sink);
    }

    if (result.code !== 0) {
      const stderrTail = result.stderr.split('\n').slice(-12).join('\n');
      return {
        ok: false,
        message: `npm ${verb} failed (exit ${String(result.code)}), see panel log for full output`,
        stderrTail
      };
    }
    return { ok: true, dependencies: await readDependencies(root) };
  }

  install(
    workspaceId: string,
    name: string,
    versionRange: string | undefined,
    ignoreScripts: boolean,
    runCli: CliRunner = nodeCliRunner,
    managedNodeVersion: string | null = this.deps.managedNodeVersion?.() ?? null
  ): Promise<PkgOpResponse> {
    return this.op(workspaceId, 'install', versionRange === undefined ? name : `${name}@${versionRange}`, ignoreScripts, runCli, managedNodeVersion);
  }

  uninstall(
    workspaceId: string,
    name: string,
    ignoreScripts: boolean,
    runCli: CliRunner = nodeCliRunner,
    managedNodeVersion: string | null = this.deps.managedNodeVersion?.() ?? null
  ): Promise<PkgOpResponse> {
    return this.op(workspaceId, 'uninstall', name, ignoreScripts, runCli, managedNodeVersion);
  }

  async list(workspaceId: string): Promise<Record<string, string>> {
    return readDependencies(this.workspace(workspaceId));
  }

  importInfo(workspaceId: string, name: string): Promise<import('@rh/protocol').PkgImportResponse> {
    return inspectPackageImport(this.workspace(workspaceId), name);
  }

  /**
   * Registry search (D7 endpoint). Aborts after 10s; renderer additionally
   * debounces and discards stale responses by query token.
   */
  async search(query: string, size: number): Promise<PkgSearchRow[] | { error: string }> {
    try {
      const res = await fetch(`${SEARCH_ENDPOINT}?text=${encodeURIComponent(query)}&size=${size}`, {
        signal: AbortSignal.timeout(10_000)
      });
      if (!res.ok) return { error: `registry search failed: ${res.status}` };
      const body = RegistrySearchResponseSchema.parse(await res.json());
      const rows: PkgSearchRow[] = [];
      for (const obj of body.objects) {
        const pkg = obj.package;
        rows.push({
          name: pkg.name,
          version: pkg.version,
          description: pkg.description ?? '',
          score: obj.score?.final ?? 0
        });
      }
      return rows;
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }
}
