/**
 * RuntimeAdapter (plan todo 23): the abstraction extracted from the proven
 * Node implementation (D3 — behavior-preserving refactor). Deno/Bun adapters
 * (todo 27) implement the same interface; call sites consume registries only.
 *
 * Resolution order lives in ONE place (runtime-resolver.ts) and both the
 * adapter and the Runtimes panel UI mirror it.
 */
import type { ManifestEntry } from '@rh/protocol';
import { detectSystemNode } from './node/node-runtime.js';
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
    const [entries, system] = await Promise.all([
      manifestEntries !== undefined ? Promise.resolve(manifestEntries) : this.readEntries(),
      detectSystemNode()
    ]);
    const picked = resolveRuntimeChoice(requestedVersion, entries, system);
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
