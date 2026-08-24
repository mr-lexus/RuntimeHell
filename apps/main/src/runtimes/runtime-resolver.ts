/**
 * Runtime executable resolution (plan todo 12).
 *
 * Displayed order — managed selected version → system installation → offer
 * managed download — is implemented by `resolveRuntimeChoice` and mirrored
 * verbatim in the Runtimes panel UI.
 */
import { join } from 'node:path';
import type { ManifestEntry, SystemRuntimeInfo } from '@rh/protocol';
import { runtimeDir } from '../binaries/paths.js';

export type RuntimeChoice =
  | { kind: 'managed'; exePath: string; version: string }
  | { kind: 'system'; exePath: string; version: string }
  | { kind: 'none' };

export function installedNodeVersions(entries: ManifestEntry[]): string[] {
  return entries
    .filter((e) => e.kind === 'runtime' && e.id === 'node' && e.installedPath !== undefined)
    .map((e) => e.version)
    .sort((a, b) => b.localeCompare(a));
}

export function resolveRuntimeChoice(
  requestedVersion: string | undefined,
  installed: ManifestEntry[],
  system: SystemRuntimeInfo | null
): RuntimeChoice {
  if (requestedVersion !== undefined && requestedVersion !== '') {
    const match = installed.find(
      (e) => e.kind === 'runtime' && e.id === 'node' && e.version === requestedVersion && e.installedPath !== undefined
    );
    if (match?.installedPath !== undefined) {
      return { kind: 'managed', exePath: join(match.installedPath, 'node.exe'), version: match.version };
    }
    // Selected version vanished (uninstalled mid-session) → fall through.
  }
  if (system) return { kind: 'system', exePath: system.exePath, version: system.version };
  return { kind: 'none' };
}

/** Directory a managed node install executes from (used for PATH isolation). */
export function managedRuntimeDir(version: string): string {
  return runtimeDir('node', version);
}
