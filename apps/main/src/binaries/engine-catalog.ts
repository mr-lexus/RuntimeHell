/**
 * Engine artifact catalog (plan todo 15, D2 constraints, C-lane section).
 *
 * Sources are OFFICIAL endpoints only:
 *   - V8 rel/dbg: Chromium V8 official canary bucket (evidence fact 1)
 *   - SpiderMonkey: Mozilla taskcluster/jsvu-compatible shells (todo 24)
 *   - JavaScriptCore: jsvu win64 builds + WebKitRequirements support DLLs (todo 25)
 *
 * Engines marked `enabled: false` are schema-ready placeholders wired to their
 * implementing todo; the UI must never offer them as downloads before then.
 * Combos without an official prebuilt land in the C-LANE — surfaced ONLY as
 * a "requires custom build" state, never as a normal download button.
 */
import type { Platform, Arch } from '@rh/protocol';

export type EngineId = 'v8' | 'd8-debug' | 'spidermonkey' | 'javascriptcore' | 'quickjs';
export type EngineKey = `${EngineId}:${Platform}:${Arch}`;

export const V8_CANARY_BASE = 'https://storage.googleapis.com/chromium-v8/official/canary';

export interface EngineSource {
  kind: 'v8-canary' | 'sm-shell' | 'jsc-shell' | 'support-artifact' | 'future';
  enabled: boolean;
  /** Present when kind === 'support-artifact': the required companion id. */
  requiresSupport?: string;
  /** C-lane pointer when no official prebuilt exists. */
  customBuildRequired?: boolean;
  reason?: string;
}

/**
 * Decision table. Rows mirror the capability matrix's "win64 stock binary"
 * line and the C-lane spec; tested exhaustively in engine-catalog.test.ts.
 */
export function resolveEngineArtifact(engineId: EngineId, platform: Platform, arch: Arch): EngineSource {
  const key: EngineKey = `${engineId}:${platform}:${arch}`;
  void key;

  switch (engineId) {
    case 'v8':
    case 'd8-debug': {
      // Official canary covers win64/x64 here; other platform zips exist on
      // the same bucket and are added when those targets ship (P10+).
      if (platform === 'win64' && arch === 'x64') return { kind: 'v8-canary', enabled: true };
      return {
        kind: 'v8-canary',
        enabled: false,
        customBuildRequired: true,
        reason: `no managed download for ${engineId}/${platform}/${arch} yet`
      };
    }
    case 'spidermonkey':
      // Schema-ready; adapter lands in todo 24.
      return { kind: 'sm-shell', enabled: false, reason: 'SpiderMonkey analysis lands in a later milestone' };
    case 'javascriptcore':
      // jsvu win64 build REQUIRES WebKitRequirements bin64 DLLs (evidence 3).
      if (platform === 'win64' && arch === 'x64') {
        return { kind: 'jsc-shell', enabled: false, requiresSupport: 'webkit-requirements', reason: 'JSC analysis lands in a later milestone' };
      }
      return { kind: 'jsc-shell', enabled: false, requiresSupport: undefined, reason: 'JSC analysis lands in a later milestone' };
    case 'quickjs':
      return { kind: 'future', enabled: false, reason: 'QuickJS-ng adapter is a post-v0.x target' };
  }
}

/** Latest-version discovery JSON next to each canary zip (evidence fact 1). */
export function v8LatestJsonUrl(variant: 'rel' | 'dbg', platform = 'win64'): string {
  return `${V8_CANARY_BASE}/v8-${platform}-${variant}-latest.json`;
}

export function v8ZipUrl(version: string, variant: 'rel' | 'dbg', platform = 'win64'): string {
  return `${V8_CANARY_BASE}/v8-${platform}-${variant}-${version}.zip`;
}

export interface V8LatestResponse {
  version: string;
}

/** Defensive parse of the -latest.json payload. */
export function parseV8Latest(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as Partial<V8LatestResponse>;
    return typeof parsed.version === 'string' && /^\d+\.\d+\.\d+(\.\d+)?$/.test(parsed.version) ? parsed.version : null;
  } catch {
    return null;
  }
}
