/**
 * Deno + Bun runtime adapters (plan todo 27).
 *
 * Both runtimes execute TS natively — TranspileService is bypassed when
 * `capabilities.supportsTypeScriptNative` is true. Download URLs verified:
 *   Deno: https://github.com/denoland/deno/releases (deno-x86_64-pc-windows-msvc.zip)
 *   Bun:  https://github.com/oven-sh/bun/releases     (bun-windows-x64.zip)
 * Neither publishes sha256 alongside the zip; record-mode sha256 applies.
 */
import type { RuntimeCapabilities } from '@rh/protocol';

export interface DenoBunCapabilities {
  readonly supportsTypeScriptNative: boolean;
  readonly supportsNpm: boolean;
  readonly supportsCommonJS: boolean;
  readonly supportsESM: boolean;
}

export const DENO_CAPS: DenoBunCapabilities = {
  supportsTypeScriptNative: true,
  supportsNpm: true, // via npm: specifiers
  supportsCommonJS: false,
  supportsESM: true
};

export const BUN_CAPS: DenoBunCapabilities = {
  supportsTypeScriptNative: true,
  supportsNpm: true, // bun install compatible
  supportsCommonJS: true,
  supportsESM: true
};

/** Deno permission flags mapped from UI checkboxes (default deny). */
export interface DenoPermissions {
  allowAll: boolean;
  allowRead: boolean;
  allowWrite: boolean;
  allowNet: boolean;
  allowEnv: boolean;
  allowRun: boolean;
}

export function denoPermissionFlags(perms: DenoPermissions): string[] {
  if (perms.allowAll) return ['--allow-all'];
  const flags: string[] = [];
  if (perms.allowRead) flags.push('--allow-read');
  if (perms.allowWrite) flags.push('--allow-write');
  if (perms.allowNet) flags.push('--allow-net');
  if (perms.allowEnv) flags.push('--allow-env');
  if (perms.allowRun) flags.push('--allow-run');
  return flags;
}

export function denoArtifactName(version: string): string {
  return `deno-x86_64-pc-windows-msvc.zip`;
}

export function denoDownloadUrl(version: string): string {
  const v = version.startsWith('v') ? version : `v${version}`;
  return `https://github.com/denoland/deno/releases/download/${v}/deno-x86_64-pc-windows-msvc.zip`;
}

export function bunArtifactName(version: string): string {
  return `bun-windows-x64.zip`;
}

export function bunDownloadUrl(version: string): string {
  const v = version.startsWith('v') ? version : `v${version}`;
  return `https://github.com/oven-sh/bun/releases/download/${v}/bun-windows-x64.zip`;
}
