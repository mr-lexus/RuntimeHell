/**
 * BinariesController (plan todo 12): assembles the Runtimes panel payload and
 * drives installs with streamed progress. Pure of electron imports — the
 * progress sink is injected (index.ts binds webContents.send).
 *
 * Multi-runtime management (feature): list() now reports system-wide detection
 * for node/deno/bun, nvm-windows Node versions, managed installs, and
 * available versions per runtime. install() dispatches by runtime id.
 */
import type {
  BinaryInstallResponse,
  BinaryProgressEvent,
  BinaryRemoveResponse,
  BinariesListResponse,
  ManifestEntry,
  NvmInfo,
  RuntimeVersionRow,
  SystemRuntimeInfo
} from '@rh/protocol';
import { buildNodeInstall, listNodeVersions, type NodeVersionInfo } from '../runtimes/node/node-runtime.js';
import {
  buildBunInstall,
  buildDenoInstall,
  listBunVersions,
  listDenoVersions
} from '../runtimes/deno-bun.js';
import {
  detectNvmNode,
  detectSystemRuntime,
  type DetectedRuntime,
  type RuntimeId
} from '../runtimes/runtime-detection.js';
import { importLocalArtifact, installArtifact, readManifest, removeEntry } from './binary-manager.js';

export interface BinariesControllerDeps {
  readonly emitProgress: (event: BinaryProgressEvent) => void;
  /** Injectable for tests; default = live nodejs.org / GitHub fetch. */
  readonly fetchAvailable?: (id: string) => Promise<RuntimeVersionRow[]>;
  /** Injectable for tests; default = where.exe detection. */
  readonly detectSystem?: (id: string) => Promise<DetectedRuntime | null>;
  /** Injectable for tests; default = nvm-windows detection. */
  readonly detectNvm?: () => Promise<NvmInfo | null>;
}

const RUNTIME_IDS: RuntimeId[] = ['node', 'deno', 'bun'];

/** GitHub releases API is rate-limited (60 req/hr unauthenticated) — cache 5 min. */
const AVAILABLE_TTL_MS = 5 * 60 * 1000;

function toRows(versions: NodeVersionInfo[]): RuntimeVersionRow[] {
  return versions.map((v) => ({
    version: v.version.replace(/^v/, ''),
    lts: v.lts,
    date: v.date
  }));
}

export class BinariesController {
  private systemCache = new Map<string, Promise<SystemRuntimeInfo | null>>();
  private nvmCache: Promise<NvmInfo | null> | null = null;
  private availableCache = new Map<string, { at: number; rows: RuntimeVersionRow[] }>();

  constructor(private readonly deps: BinariesControllerDeps) {}

  private detectSystem(id: RuntimeId): Promise<SystemRuntimeInfo | null> {
    let p = this.systemCache.get(id);
    if (!p) {
      p = (this.deps.detectSystem?.(id) ?? detectSystemRuntime(id)).then(
        (d): SystemRuntimeInfo | null => (d ? { exePath: d.exePath, version: d.version } : null)
      );
      this.systemCache.set(id, p);
    }
    return p;
  }

  private detectNvm(): Promise<NvmInfo | null> {
    this.nvmCache ??= this.deps.detectNvm?.() ?? detectNvmNode();
    return this.nvmCache;
  }

  private async fetchAvailable(id: RuntimeId): Promise<RuntimeVersionRow[]> {
    const cached = this.availableCache.get(id);
    if (cached && Date.now() - cached.at < AVAILABLE_TTL_MS) return cached.rows;
    const rows = this.deps.fetchAvailable
      ? await this.deps.fetchAvailable(id)
      : id === 'node'
        ? toRows(await listNodeVersions())
        : id === 'deno'
          ? await listDenoVersions()
          : await listBunVersions();
    this.availableCache.set(id, { at: Date.now(), rows });
    return rows;
  }

  async list(): Promise<BinariesListResponse> {
    const [manifest, nvm, ...systems] = await Promise.all([
      readManifest(),
      this.detectNvm(),
      ...RUNTIME_IDS.map((id) => this.detectSystem(id))
    ]);
    const systemRuntimes: Record<string, SystemRuntimeInfo | null> = {};
    RUNTIME_IDS.forEach((id, i) => {
      systemRuntimes[id] = systems[i] ?? null;
    });

    const availableVersions: Record<string, RuntimeVersionRow[]> = {};
    const availableErrors: Record<string, string> = {};
    await Promise.all(
      RUNTIME_IDS.map(async (id) => {
        availableVersions[id] = [];
        try {
          const fetched = await this.fetchAvailable(id);
          if (id === 'node') {
            // UI shows a bounded, useful slice: LTS first (newest), then newest non-LTS.
            const lts = fetched.filter((r) => r.lts).slice(0, 8);
            const current = fetched.filter((r) => !r.lts).slice(0, 3);
            availableVersions[id] = [...lts, ...current];
          } else {
            availableVersions[id] = fetched;
          }
        } catch (err) {
          availableErrors[id] = err instanceof Error ? err.message : String(err);
        }
      })
    );

    // Return every managed binary so the Runtimes panel can manage both
    // complete runtimes and low-level analysis engines from one surface.
    const installed = manifest.entries.filter((e) => e.installedPath !== undefined);
    return { systemRuntimes, nvm, installed, availableVersions, availableErrors };
  }

  async install(kind: 'runtime' | 'engine', id: string, version?: string): Promise<BinaryInstallResponse> {
    try {
      if (kind === 'engine') {
        if (id === 'spidermonkey') {
          const { installSmEngine } = await import('./sm-downloader.js');
          const entry = await installSmEngine({ onProgress: (p) => this.deps.emitProgress({ kind: 'runtime', id, version: p.totalBytes === null ? '' : id, receivedBytes: p.receivedBytes, totalBytes: p.totalBytes }) });
          this.deps.emitProgress({ kind: 'runtime', id, version: entry.version, receivedBytes: 0, totalBytes: null, done: true });
          return { ok: true, entry };
        }
        if (id === 'javascriptcore') {
          // JSC needs the WebKitRequirements DLLs on the CHILD PATH (todo 25).
          const { ensureWebKitRequirements } = await import('./webkit-requirements.js');
          await ensureWebKitRequirements();
          const { installJscEngine } = await import('./jsc-downloader.js');
          const entry = await installJscEngine({ onProgress: (p) => this.deps.emitProgress({ kind: 'runtime', id, version: p.totalBytes === null ? '' : id, receivedBytes: p.receivedBytes, totalBytes: p.totalBytes }) });
          this.deps.emitProgress({ kind: 'runtime', id, version: entry.version, receivedBytes: 0, totalBytes: null, done: true });
          return { ok: true, entry };
        }
        const { installEngine } = await import('./engine-downloader.js');
        const outcome = await installEngine({
          engineId: id as 'v8' | 'd8-debug',
          ...(version !== undefined ? { version } : {}),
          onProgress: (p) => {
            this.deps.emitProgress({
              kind: 'runtime',
              id,
              version: p.version || version || '',
              receivedBytes: p.receivedBytes,
              totalBytes: p.totalBytes
            });
          }
        });
        this.deps.emitProgress({ kind: 'runtime', id, version: outcome.entry.version, receivedBytes: 0, totalBytes: null, done: true });
        return { ok: true, entry: outcome.entry };
      }

      const normalized = version !== undefined && !version.startsWith('v') ? `v${version}` : (version ?? '');
      if (normalized === '') throw new Error('version required for runtime installs');
      // Progress events carry the version WITHOUT the leading 'v' — the UI
      // compares against available-version rows (also v-less).
      const progressVersion = normalized.replace(/^v/, '');
      const built =
        id === 'node'
          ? await buildNodeInstall(normalized, (received, total) => {
              this.deps.emitProgress({ kind: 'runtime', id, version: progressVersion, receivedBytes: received, totalBytes: total });
            })
          : id === 'deno'
            ? await buildDenoInstall(normalized)
            : id === 'bun'
              ? await buildBunInstall(normalized)
              : (() => {
                  throw new Error(`unknown runtime id: ${id}`);
                })();
      const entry: ManifestEntry = await installArtifact({
        entry: built.entry,
        source: { url: built.url, sha256: built.sha256 },
        onProgress: (p) => {
          this.deps.emitProgress({
            kind: 'runtime',
            id,
            version: progressVersion,
            receivedBytes: p.receivedBytes,
            totalBytes: p.totalBytes
          });
        }
      });
      this.deps.emitProgress({ kind: 'runtime', id, version: progressVersion, receivedBytes: 0, totalBytes: null, done: true });
      return { ok: true, entry };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Copy an existing Windows executable/folder into the private cache. */
  async importLocal(
    kind: 'runtime' | 'engine',
    id: string,
    sourcePath: string,
    version?: string
  ): Promise<BinaryInstallResponse> {
    try {
      const normalizedVersion = version?.trim() ?? '';
      if (normalizedVersion === '') throw new Error('version required for local imports');
      const entry = await importLocalArtifact(kind, id, sourcePath, normalizedVersion);
      this.deps.emitProgress({
        kind: 'runtime',
        id,
        version: entry.version,
        receivedBytes: 0,
        totalBytes: null,
        done: true
      });
      return { ok: true, entry };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  async remove(kind: 'runtime' | 'engine' | 'runtime-support', id: string, version: string): Promise<BinaryRemoveResponse> {
    try {
      await removeEntry(kind, id, version);
      if (kind === 'runtime') {
        this.systemCache.delete(id); // re-detect next list
        this.availableCache.delete(id);
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }
}
