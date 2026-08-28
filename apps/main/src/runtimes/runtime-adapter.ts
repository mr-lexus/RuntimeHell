/**
 * RuntimeAdapter (plan todo 23): the abstraction extracted from the proven
 * Node implementation (D3 — behavior-preserving refactor). Deno/Bun adapters
 * (todo 27) implement the same interface; call sites consume registries only.
 *
 * Resolution order lives in ONE place (runtime-resolver.ts) and both the
 * adapter and the Runtimes panel UI mirror it.
 */
import type { ManifestEntry, NvmInfo } from '@rh/protocol';
import { join } from 'node:path';
import { detectSystemNode } from './node/node-runtime.js';
import { detectNvmNode, detectSystemRuntime } from './runtime-detection.js';
import { installedNodeVersions, resolveRuntimeChoice } from './runtime-resolver.js';

export interface ResolvedRuntime {
  readonly exePath: string;
  readonly version: string;
}

export interface RuntimeAdapter {
  readonly id: 'node' | 'deno' | 'bun';
  /** Displayed resolution order (todo 12): managed selected → system → none. */
  resolveExecutable(requestedVersion?: string, manifestEntries?: ManifestEntry[]): Promise<ResolvedRuntime | null>;
  /** Installed managed versions, newest first. */
  installedVersions(manifestEntries?: ManifestEntry[]): Promise<string[]>;
}

/** Concrete adapter extracted from the todo-7/12 Node implementation. */
export class NodeRuntimeAdapter implements RuntimeAdapter {
  readonly id = 'node' as const;

  async resolveExecutable(
    requestedVersion?: string,
    manifestEntries?: ManifestEntry[]
  ): Promise<ResolvedRuntime | null> {
    const [entries, system, nvm] = await Promise.all([
      manifestEntries !== undefined ? Promise.resolve(manifestEntries) : this.readEntries(),
      detectSystemNode(),
      detectNvmNode()
    ]);
    const picked = resolveRuntimeChoice(requestedVersion, entries, system, nvm);
    return picked.kind === 'none' ? null : { exePath: picked.exePath, version: picked.version };
  }

  installedVersions(manifestEntries?: ManifestEntry[]): Promise<string[]> {
    if (manifestEntries !== undefined) return Promise.resolve(installedNodeVersions(manifestEntries));
    return this.readEntries().then((entries) => installedNodeVersions(entries));
  }

  private readEntries(): Promise<ManifestEntry[]> {
    return import('../binaries/binary-manager.js')
      .then((m) => m.readManifest())
      .then((manifest) => manifest.entries);
  }
}

/**
 * Deno/Bun adapter (plan todo 27, runtime switching). No nvm lane exists for
 * these runtimes, so resolution is: requested managed version → system
 * installation → (auto only) newest managed version → none. Mirrors the Node
 * adapter's "named version vanished → fall through" resilience.
 */
export class DenoBunRuntimeAdapter implements RuntimeAdapter {
  readonly id: 'deno' | 'bun';

  constructor(id: 'deno' | 'bun') {
    this.id = id;
  }

  async resolveExecutable(
    requestedVersion?: string,
    manifestEntries?: ManifestEntry[]
  ): Promise<ResolvedRuntime | null> {
    const entries = manifestEntries !== undefined ? manifestEntries : await this.readEntries();
    const managed = this.managedEntries(entries);

    if (requestedVersion === 'system') {
      const system = await detectSystemRuntime(this.id);
      return system;
    }

    if (requestedVersion !== undefined && requestedVersion !== '') {
      const match = managed.find((e) => e.version === requestedVersion);
      if (match?.installedPath !== undefined) {
        return { exePath: join(match.installedPath, this.exeName()), version: match.version };
      }
      // Named version vanished (uninstalled mid-session) → fall through to system.
    }

    const system = await detectSystemRuntime(this.id);
    if (system) return system;

    if (requestedVersion === undefined || requestedVersion === '') {
      // Auto: newest managed install (sorted newest first like node).
      const newest = [...managed].sort((a, b) =>
        b.version.localeCompare(a.version, undefined, { numeric: true })
      )[0];
      if (newest?.installedPath !== undefined) {
        return { exePath: join(newest.installedPath, this.exeName()), version: newest.version };
      }
    }
    return null;
  }

  installedVersions(manifestEntries?: ManifestEntry[]): Promise<string[]> {
    const versions = () =>
      this.managedEntries(manifestEntries ?? [])
        .map((e) => e.version)
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    if (manifestEntries !== undefined) return Promise.resolve(versions());
    return this.readEntries().then(versions);
  }

  private managedEntries(entries: ManifestEntry[]): ManifestEntry[] {
    return entries.filter((e) => e.kind === 'runtime' && e.id === this.id && e.installedPath !== undefined);
  }

  private exeName(): string {
    return this.id === 'deno' ? 'deno.exe' : 'bun.exe';
  }

  private readEntries(): Promise<ManifestEntry[]> {
    return import('../binaries/binary-manager.js')
      .then((m) => m.readManifest())
      .then((manifest) => manifest.entries);
  }
}

export interface RuntimeRegistryDeps {
  readonly adapters: RuntimeAdapter[];
}

export class RuntimeRegistry {
  private readonly byId = new Map<string, RuntimeAdapter>();

  constructor(deps: RuntimeRegistryDeps) {
    for (const adapter of deps.adapters) this.byId.set(adapter.id, adapter);
  }

  get(id: 'node' | 'deno' | 'bun'): RuntimeAdapter | null {
    return this.byId.get(id) ?? null;
  }

  ids(): string[] {
    return [...this.byId.keys()];
  }
}
