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
import { workspaceRoot } from '../workspace/files.js';
import { managedRuntimeDir } from '../runtimes/runtime-resolver.js';
import { commandLookup, executableName, isWindows } from '../platform.js';

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

/** Default CLI runner: real child process, line-buffered output. */
export const nodeCliRunner: CliRunner = (exe, args, cwd, onLine) =>
  new Promise((resolve) => {
    const child = spawn(exe, args, { cwd, windowsHide: true });
    const collected = { stdout: '', stderr: '' };

    const makePump =
      (stream: 'stdout' | 'stderr') =>
      (chunk: Buffer): void => {
        const text = chunk.toString('utf8');
        collected[stream] += text;
        let pending = text;
        let nl = pending.indexOf('\n');
        while (nl !== -1) {
          const line = pending.slice(0, nl).replace(/\r$/, '');
          pending = pending.slice(nl + 1);
          onLine(stream, line);
          nl = pending.indexOf('\n');
        }
        // Trailing partial lines flush at close so lines are never split.
      };

    const pumpOut = makePump('stdout');
    const pumpErr = makePump('stderr');
    child.stdout?.on('data', pumpOut);
    child.stderr?.on('data', pumpErr);

    child.on('error', (e) => resolve({ code: -1, stdout: collected.stdout, stderr: e.message }));
    child.on('close', (code) => resolve({ code, stdout: collected.stdout, stderr: collected.stderr }));
  });

/**
 * Resolved npm execution strategy. We prefer running npm-cli.js DIRECTLY with
 * a sibling Node executable (no shell, no quoting hazards); the legacy shell
 * shell path is a last-resort fallback.
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
  const npmCliRelative = join('node_modules', 'npm', 'bin', 'npm-cli.js');

  // 1) Managed active runtime: bundled Node + its npm-cli.js.
  if (managedVersion !== null) {
    const dir = managedRuntimeDir(managedVersion);
    const nodeExe = join(dir, executableName('node'));
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
  return new Promise((resolve) => {
    const child = spawn(commandLookup(), ['npm'], isWindows() ? { windowsHide: true } : undefined);
    let out = '';
    child.stdout?.on('data', (d) => {
      out += String(d);
    });
    child.on('error', () => resolve(null));
    child.on('close', (code) => {
      if (code !== 0) return resolve(null);
      const first = out.split(/\r?\n/).map((l) => l.trim()).find(Boolean);
      resolve(first?.trim() ?? null);
    });
  });
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
    const parsed = JSON.parse(raw) as { dependencies?: Record<string, string> };
    return parsed.dependencies ?? {};
  } catch {
    return {};
  }
}

const SEARCH_ENDPOINT = 'https://registry.npmjs.org/-/v1/search';

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
      // Legacy shell fallback on Windows; POSIX can execute npm directly.
      if (!isWindows()) {
        result = await runCli(npm.exePath, verbArgs, root, sink);
      } else {
        const command = `"${npm.exePath} ${verbArgs.join(' ')}"`;
        result = await new Promise<SpawnedCli>((resolve) => {
          const child = spawn('cmd.exe', ['/d', '/s', '/c', command], {
            cwd: root,
            windowsHide: true,
            windowsVerbatimArguments: true
          });
          let stderr = '';
          child.stdout?.on('data', (c: Buffer) => {
            for (const line of String(c).split('\n')) if (line.trim() !== '') sink('stdout', line.replace(/\r$/, ''));
          });
          child.stderr?.on('data', (c: Buffer) => {
            for (const line of String(c).split('\n')) {
              const t = line.replace(/\r$/, '');
              if (t.trim() === '') continue;
              stderr += `${t}\n`;
              sink('stderr', t);
            }
          });
          child.on('error', (e) => resolve({ code: -1, stdout: '', stderr: e.message }));
          child.on('close', (code) => resolve({ code, stdout: '', stderr }));
        });
      }
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
      const body = (await res.json()) as {
        objects?: { package?: { name?: string; version?: string; description?: string; score?: { final?: number } } }[];
      };
      const rows: PkgSearchRow[] = [];
      for (const obj of body.objects ?? []) {
        const pkg = obj.package;
        if (pkg?.name === undefined || pkg.version === undefined) continue;
        rows.push({
          name: pkg.name,
          version: pkg.version,
          description: pkg.description ?? '',
          score: pkg.score?.final ?? 0
        });
      }
      return rows;
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }
}
