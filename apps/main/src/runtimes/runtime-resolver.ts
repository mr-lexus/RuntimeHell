/**
 * Runtime executable resolution (plan todo 12).
 *
 * Displayed order — managed selected version → native nvm version → system
 * installation → offer managed download — is implemented by
 * `resolveRuntimeChoice` and mirrored verbatim in the Runtimes panel UI.
 *
 * NVM selections are encoded as `nvm:X.Y.Z` in the runtimeVersion string;
 * plain versions select managed installs.
 */
import { join } from 'node:path';
import type { ManifestEntry, NvmInfo, SystemRuntimeInfo } from '@rh/protocol';
import { runtimeDir } from '../binaries/paths.js';
import { managedRuntimeExecutablePath } from '../platform.js';

export type RuntimeChoice =
  | { kind: 'managed'; exePath: string; version: string }
  | { kind: 'nvm'; exePath: string; version: string }
  | { kind: 'system'; exePath: string; version: string }
  | { kind: 'none' };

export function installedNodeVersions(entries: ManifestEntry[]): string[] {
  return entries
    .filter((e) => e.kind === 'runtime' && e.id === 'node' && e.installedPath !== undefined)
    .map((e) => e.version)
    .sort((a, b) => b.localeCompare(a));
}

function findNvmVersion(nvm: NvmInfo | null, version: string) {
  return nvm?.versions.find((v) => v.version === version) ?? null;
}

export function resolveRuntimeChoice(
  requestedVersion: string | undefined,
  installed: ManifestEntry[],
  system: SystemRuntimeInfo | null,
  nvm: NvmInfo | null
): RuntimeChoice {
  if (requestedVersion === 'system') {
    return system ? { kind: 'system', exePath: system.exePath, version: system.version } : { kind: 'none' };
  }
  if (requestedVersion !== undefined && requestedVersion !== '') {
    if (requestedVersion.startsWith('nvm:')) {
      const nvmVersion = findNvmVersion(nvm, requestedVersion.slice(4));
      if (nvmVersion) {
        return { kind: 'nvm', exePath: nvmVersion.exePath, version: nvmVersion.version };
      }
      // Selected nvm version vanished → fall through to system.
    } else {
      const match = installed.find(
        (e) => e.kind === 'runtime' && e.id === 'node' && e.version === requestedVersion && e.installedPath !== undefined
      );
      if (match?.installedPath !== undefined) {
        return { kind: 'managed', exePath: managedRuntimeExecutablePath(match.installedPath, 'node'), version: match.version };
      }
      // Selected version vanished (uninstalled mid-session) → try nvm, then system.
      const nvmVersion = findNvmVersion(nvm, requestedVersion);
      if (nvmVersion) {
        return { kind: 'nvm', exePath: nvmVersion.exePath, version: nvmVersion.version };
      }
    }
  } else {
    // Auto: prefer the nvm-active version, then the system installation.
    const active = nvm?.versions.find((v) => v.active);
    if (active) return { kind: 'nvm', exePath: active.exePath, version: active.version };
  }
  if (system) return { kind: 'system', exePath: system.exePath, version: system.version };
  // A local managed install is the final fallback when no global runtime is
  // available. This keeps the sandbox usable on machines without Node PATH.
  const newestManaged = installed
    .filter((e) => e.kind === 'runtime' && e.id === 'node' && e.installedPath !== undefined)
    .sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }))[0];
  if (newestManaged?.installedPath !== undefined) {
    return { kind: 'managed', exePath: managedRuntimeExecutablePath(newestManaged.installedPath, 'node'), version: newestManaged.version };
  }
  return { kind: 'none' };
}

/** Directory a managed node install executes from (used for PATH isolation). */
export function managedRuntimeDir(version: string): string {
  return runtimeDir('node', version);
}
