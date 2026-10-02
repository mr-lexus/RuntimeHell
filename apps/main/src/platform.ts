import { arch as osArch, homedir, platform as osPlatform } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import type { Arch, Platform } from '@rh/protocol';

/** Runtime platform identifiers used by the managed binary manifest. */
export function hostPlatform(): Platform {
  const value = osPlatform();
  if (value === 'win32') return 'win64';
  if (value === 'darwin') return osArch() === 'arm64' ? 'mac64arm' : 'mac64';
  if (value === 'linux') return 'linux64';
  throw new Error(`unsupported host platform: ${value}`);
}

/** Normalize Node's architecture names to the manifest vocabulary. */
export function hostArch(): Arch {
  const value = osArch();
  if (value === 'arm64') return 'arm64';
  if (value === 'x64') return 'x64';
  throw new Error(`unsupported host architecture: ${value}`);
}

export function isWindows(): boolean {
  return osPlatform() === 'win32';
}

export function executableName(base: string): string {
  return isWindows() ? `${base}.exe` : base;
}

/**
 * Managed runtime archives do not all use the Windows flat layout. Node's
 * macOS/Linux distributions keep the executable under `bin/`, while the
 * Windows zip places `node.exe` at the archive root. Keep this detail in one
 * place so execution, npm, imports, and performance targets agree.
 */
export function managedRuntimeExecutableRelativePath(id: string, host = osPlatform()): string {
  const executable = host === 'win32' ? `${id}.exe` : id;
  return id === 'node' && host !== 'win32' ? join('bin', executable) : executable;
}

export function managedRuntimeExecutablePath(root: string, id: string): string {
  return join(root, managedRuntimeExecutableRelativePath(id));
}

export function pathListSeparator(): string {
  return isWindows() ? ';' : ':';
}

export function commandLookup(): string {
  return isWindows() ? 'where.exe' : 'which';
}

/**
 * Normalize a filesystem path for equality checks without assuming that all
 * hosts are case-insensitive. macOS can use a case-sensitive APFS volume, so
 * only Windows paths are folded to lower case.
 */
export function normalizePathForComparison(value: string, host = osPlatform()): string {
  let normalized = value;
  if (/^file:/i.test(normalized)) {
    try {
      if (host === 'win32') normalized = fileURLToPath(normalized);
      else {
        const url = new URL(normalized);
        if (url.hostname !== '' && url.hostname !== 'localhost') return value;
        normalized = decodeURIComponent(url.pathname);
      }
    } catch { /* compare the original value */ }
  }
  normalized = normalized.replace(/\\/g, '/');
  if (normalized !== '/' && !/^[a-zA-Z]:\/$/.test(normalized)) normalized = normalized.replace(/\/+$/, '');
  return host === 'win32' ? normalized.toLowerCase() : normalized;
}

/** Compare paths after resolving aliases such as macOS `/var` → `/private/var`. */
export async function sameFilesystemPath(left: string, right: string): Promise<boolean> {
  if (normalizePathForComparison(left) === normalizePathForComparison(right)) return true;
  const canonical = async (value: string): Promise<string> => {
    try {
      const path = /^file:/i.test(value) ? new URL(value) : value;
      return normalizePathForComparison(await fs.realpath(path));
    } catch {
      return normalizePathForComparison(value);
    }
  };
  const [canonicalLeft, canonicalRight] = await Promise.all([canonical(left), canonical(right)]);
  return canonicalLeft === canonicalRight;
}

export function userConfigDir(): string {
  if (isWindows()) return process.env['APPDATA'] || joinHome('AppData', 'Roaming');
  if (osPlatform() === 'darwin') return joinHome('Library', 'Application Support');
  const configured = process.env['XDG_CONFIG_HOME'];
  return configured && isAbsolute(configured) ? configured : joinHome('.config');
}

export function userCacheDir(): string {
  if (isWindows()) return process.env['LOCALAPPDATA'] || joinHome('AppData', 'Local');
  if (osPlatform() === 'darwin') return joinHome('Library', 'Caches');
  const configured = process.env['XDG_CACHE_HOME'];
  return configured && isAbsolute(configured) ? configured : joinHome('.cache');
}

function joinHome(...parts: string[]): string {
  return join(homedir(), ...parts);
}
