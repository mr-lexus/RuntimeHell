import { arch as osArch, homedir, platform as osPlatform } from 'node:os';
import { isAbsolute, join } from 'node:path';
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

export function pathListSeparator(): string {
  return isWindows() ? ';' : ':';
}

export function commandLookup(): string {
  return isWindows() ? 'where.exe' : 'which';
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
