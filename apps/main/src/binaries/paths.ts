/**
 * Binary cache layout (plan D2):
 *   %LOCALAPPDATA%\RuntimeHell\cache\manifest.json
 *   %LOCALAPPDATA%\RuntimeHell\cache\runtimes\{id}\{version}\
 *   %LOCALAPPDATA%\RuntimeHell\cache\engines\{id}\{version}\
 *   %LOCALAPPDATA%\RuntimeHell\cache\tmp\            (staging, atomic renames)
 */
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export function cacheRoot(): string {
  // Test override: RH_CACHE_ROOT redirects the whole cache (unit tests).
  const base = process.env['RH_CACHE_ROOT'] ?? join(process.env['LOCALAPPDATA'] ?? tmpdir(), 'RuntimeHell', 'cache');
  return base;
}

export function manifestPath(): string {
  return join(cacheRoot(), 'manifest.json');
}

export function runtimeDir(id: string, version: string): string {
  return join(cacheRoot(), 'runtimes', id, version);
}

export function engineDir(id: string, version: string): string {
  return join(cacheRoot(), 'engines', id, version);
}

export function supportDir(id: string): string {
  return join(cacheRoot(), 'support', id);
}

export function tmpDir(token: string): string {
  return join(cacheRoot(), 'tmp', token.replace(/[^a-zA-Z0-9_.-]/g, '_'));
}
