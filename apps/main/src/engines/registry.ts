/**
 * EngineRegistry (plan todo 16): id-keyed engine descriptions backed by the
 * binary manifest, with sha256-keyed capability caching. analyze() dispatch
 * is a stub here — concrete adapters land in todos 17/24/25 and register
 * themselves; the registry NEVER contains per-engine flag strings beyond the
 * probe module.
 */
import type { EngineCapabilities, EngineId } from '@rh/protocol';
import { readManifest } from '../binaries/binary-manager.js';
import { join } from 'node:path';
import { executableName } from '../platform.js';
import { hashBinary, probeV8Binary, realExecutor, type ExecuteBinary } from './probe.js';
import type { AnalysisEvent, AnalysisStartRequest } from '@rh/protocol';
import type { EngineAdapter } from './engine-adapter.js';

export interface EngineDescription {
  readonly id: EngineId | 'd8-debug';
  readonly version: string | null;
  readonly binaryPath: string | null;
  /** Null until probed (or when no binary is installed). */
  readonly capabilities: EngineCapabilities | null;
  readonly reason: string | null;
}

const ENGINE_BINARY_NAME: Record<string, string> = {
  v8: executableName('d8'),
  'd8-debug': executableName('d8'),
  spidermonkey: executableName('js'),
  javascriptcore: executableName('jsc')
};
/** Registry ids map to manifest entry ids; 'd8-debug' IS its own entry id. */
const KNOWN_IDS: (EngineId | 'd8-debug')[] = ['v8', 'd8-debug', 'spidermonkey', 'javascriptcore'];

export interface EngineRegistryDeps {
  readonly execute?: ExecuteBinary;
  readonly hash?: (exePath: string) => Promise<string>;
}

export class EngineRegistry {
  private readonly capsByHash = new Map<string, EngineCapabilities>();
  private readonly adapters = new Map<string, EngineAdapter>();
  private readonly execute: ExecuteBinary;
  private readonly hash: (exePath: string) => Promise<string>;

  constructor(private readonly deps: EngineRegistryDeps = {}) {
    this.execute = deps.execute ?? realExecutor;
    this.hash = deps.hash ?? hashBinary;
  }

  /** Latest installed version per engine id from the manifest. */
  async installedEngines(): Promise<{ id: string; version: string; binaryPath: string }[]> {
    const manifest = await readManifest();
    const byId = new Map<string, { version: string; installedPath: string }>();
    for (const entry of manifest.entries) {
      if (entry.kind !== 'engine' || !KNOWN_IDS.includes(entry.id as never)) continue;
      if (!entry.installedPath) continue;
      const prev = byId.get(entry.id);
      if (prev === undefined || compareVersions(entry.version, prev.version) > 0) {
        byId.set(entry.id, { version: entry.version, installedPath: entry.installedPath });
      }
    }
    return [...byId.entries()].map(([id, v]) => ({
      id,
      version: v.version,
      binaryPath: join(v.installedPath, ENGINE_BINARY_NAME[id] ?? executableName('engine'))
    }));
  }

  /**
   * Probe one binary. Results cached by sha256 so repeated UI queries never
   * re-spawn the engine.
   */
  async capabilities(binaryPath: string): Promise<EngineCapabilities> {
    const digest = await this.hash(binaryPath).catch(() => `unreadable:${binaryPath}`);
    const cached = this.capsByHash.get(digest);
    if (cached) return cached;
    const caps = await probeV8Binary(binaryPath, this.execute);
    this.capsByHash.set(digest, caps);
    return caps;
  }

  async describe(id: EngineId | 'd8-debug'): Promise<EngineDescription> {
    const engines = await this.installedEngines();
    const match = engines.find((e) => e.id === id);
    if (!match) {
      return {
        id,
        version: null,
        binaryPath: null,
        capabilities: null,
        reason: `${id} is not installed — install it from the Runtimes/engines panel`
      };
    }
    const exists = await import('node:fs').then((fs) =>
      fs.promises.access(match.binaryPath).then(
        () => true,
        () => false
      )
    );
    if (!exists) {
      return { id, version: match.version, binaryPath: match.binaryPath, capabilities: null, reason: 'binary missing on disk' };
    }
    const capabilities = await this.capabilities(match.binaryPath);
    return {
      id,
      version: match.version,
      binaryPath: match.binaryPath,
      capabilities,
      reason: capabilities.notes.find((n) => n.startsWith('not a valid')) ?? null
    };
  }

  async list(): Promise<EngineDescription[]> {
    return Promise.all(KNOWN_IDS.map((id) => this.describe(id)));
  }

  /** Adapter registration (todo 23): V8 registers in index.ts; SM/JSC follow. */
  registerAdapter(adapter: EngineAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  getAdapter(id: EngineId | 'd8-debug'): EngineAdapter | null {
    return this.adapters.get(id) ?? null;
  }

  /** Dispatch through the registered adapter for this engine id. */
  async analyze(
    req: AnalysisStartRequest,
    ctx: import('./engine-adapter.js').AnalysisContext
  ): Promise<void> {
    const adapter = this.getAdapter(req.engineId);
    if (!adapter) throw new Error(`no engine adapter registered for '${req.engineId}'`);
    await adapter.analyze({ ...req, binaryPath: '' }, ctx);
  }
}

function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da - db;
  }
  return 0;
}
