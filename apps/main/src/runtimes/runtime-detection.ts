/**
 * Runtime detection (multi-runtime management feature):
 *   - detectSystemRuntime(id): system-wide (PATH) detection for node/deno/bun
 *     via where.exe + `--version` (generalized from node-runtime.ts).
 *   - detectNvmNode(): nvm-windows Node version discovery. nvm-windows keeps
 *     each version in a `vX.Y.Z` directory under NVM_HOME (default
 *     %APPDATA%\nvm) and symlinks the active version at NVM_SYMLINK (default
 *     C:\Program Files\nodejs). We consume these versions read-only — the app
 *     never installs/removes through nvm itself.
 */
import { spawn } from 'node:child_process';
import { access, readdir, realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { NvmInfo, NvmVersionInfo } from '@rh/protocol';

export interface DetectedRuntime {
  exePath: string;
  version: string;
}

export type RuntimeId = 'node' | 'deno' | 'bun';

/**
 * Normalize `<exe> --version` output into a bare `X.Y.Z` version string.
 *   - node: `v24.18.0`
 *   - deno: multi-line — line 1 is `deno 2.3.4 (stable, release, ...)`
 *   - bun:  `1.3.14` (no leading v)
 * Returns null when the output doesn't look like a version at all.
 */
export function parseRuntimeVersionOutput(id: RuntimeId, raw: string): string | null {
  const firstLine = raw.split(/\r?\n/)[0]?.trim() ?? '';
  // The first X.Y.Z token in the first line is the version for all three
  // runtimes: `v24.18.0` (node), `deno 2.3.4 (stable, release, ...)` (deno),
  // `1.3.14` (bun).
  return /(?:v)?(\d+\.\d+\.\d+)/.exec(firstLine)?.[1] ?? null;
}

/** Locate a system runtime via where.exe; returns null when absent. */
export function detectSystemRuntime(id: RuntimeId): Promise<DetectedRuntime | null> {
  return new Promise((resolve) => {
    const child = spawn('where.exe', [id], { windowsHide: true });
    let out = '';
    child.stdout?.on('data', (d) => {
      out += String(d);
    });
    child.on('error', () => resolve(null));
    child.on('close', (code) => {
      if (code !== 0) return resolve(null);
      const first = out.split(/\r?\n/).find((l) => l.trim().toLowerCase().endsWith('.exe'));
      if (!first) return resolve(null);
      const exePath = first.trim();
      const ver = spawn(exePath, ['--version'], { windowsHide: true });
      let vout = '';
      ver.stdout?.on('data', (d) => {
        vout += String(d);
      });
      ver.on('error', () => resolve(null));
      ver.on('close', (vc) => {
        if (vc !== 0) return resolve(null);
        const version = parseRuntimeVersionOutput(id, vout);
        if (version === null) return resolve(null);
        resolve({ exePath, version });
      });
    });
  });
}

/** nvm-windows root directory (NVM_HOME env, else %APPDATA%\nvm). */
export function nvmRoot(): string {
  return process.env['NVM_HOME'] ?? join(process.env['APPDATA'] ?? '', 'nvm');
}

/** nvm-windows active-version symlink (NVM_SYMLINK env, else Program Files\nodejs). */
export function nvmSymlink(): string {
  return process.env['NVM_SYMLINK'] ?? join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'nodejs');
}

/**
 * Pure mapping of nvm directory names to version rows. `activeTarget` is the
 * resolved realpath of the nvm symlink (or null when absent); a version dir
 * whose path equals it (case- and separator-insensitive) is the active one.
 * No fs access — the caller filters unusable rows afterwards.
 */
export function parseNvmVersions(root: string, dirNames: string[], activeTarget: string | null): NvmVersionInfo[] {
  const normalize = (p: string): string => p.replace(/\//g, '\\').toLowerCase();
  const target = activeTarget !== null ? normalize(activeTarget) : null;
  const versions: NvmVersionInfo[] = [];
  for (const name of dirNames) {
    if (!/^v\d+\.\d+\.\d+$/.test(name)) continue;
    const dir = join(root, name);
    const active = target !== null && normalize(dir) === target;
    versions.push({ version: name.replace(/^v/, ''), exePath: join(dir, 'node.exe'), active });
  }
  versions.sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
  return versions;
}

/**
 * Detect nvm-windows installed Node versions. Returns null when nvm is not
 * installed (no root dir) or has no usable versions.
 */
export async function detectNvmNode(): Promise<NvmInfo | null> {
  const root = nvmRoot();
  try {
    const s = await stat(root);
    if (!s.isDirectory()) return null;
  } catch {
    return null;
  }

  let dirNames: string[];
  try {
    dirNames = await readdir(root);
  } catch {
    return null;
  }

  // Resolve the active-version symlink target (may be absent).
  let activeTarget: string | null = null;
  try {
    activeTarget = await realpath(nvmSymlink());
  } catch {
    /* no symlink — no active version */
  }

  const versions = parseNvmVersions(root, dirNames, activeTarget);
  // Keep only rows whose node.exe actually exists.
  const usable: NvmVersionInfo[] = [];
  for (const v of versions) {
    try {
      await access(v.exePath);
      usable.push(v);
    } catch {
      /* skip version dirs without node.exe */
    }
  }
  if (usable.length === 0) return null;
  return { root, versions: usable };
}