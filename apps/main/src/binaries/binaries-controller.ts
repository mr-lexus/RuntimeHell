/**
 * BinariesController (plan todo 12): assembles the Runtimes panel payload and
 * drives installs with streamed progress. Pure of electron imports — the
 * progress sink is injected (index.ts binds webContents.send).
 */
import type {
  BinaryInstallResponse,
  BinaryProgressEvent,
  BinaryRemoveResponse,
  BinariesListResponse,
  ManifestEntry,
  NodeVersionRow,
  SystemRuntimeInfo
} from '@rh/protocol';
import { buildNodeInstall, detectSystemNode, listNodeVersions, type DetectedNode } from '../runtimes/node/node-runtime.js';
import { installArtifact, readManifest, removeEntry } from './binary-manager.js';

export interface BinariesControllerDeps {
  readonly emitProgress: (event: BinaryProgressEvent) => void;
  /** Injectable for tests; default = live nodejs.org index fetch. */
  readonly fetchAvailable?: () => Promise<NodeVersionRow[]>;
  /** Injectable for tests; default = where.exe detection. */
  readonly detectSystem?: () => Promise<DetectedNode | null>;
}

function toRows(versions: { version: string; lts: boolean; date: string }[]): NodeVersionRow[] {
  return versions.map((v) => ({
    version: v.version.replace(/^v/, ''),
    lts: v.lts,
    date: v.date
  }));
}

export class BinariesController {
  private systemCache: Promise<SystemRuntimeInfo | null> | null = null;

  constructor(private readonly deps: BinariesControllerDeps) {}

  private detectSystem(): Promise<SystemRuntimeInfo | null> {
    this.systemCache ??= (this.deps.detectSystem?.() ?? detectSystemNode()).then(
      (d): SystemRuntimeInfo | null => (d ? { exePath: d.exePath, version: d.version } : null)
    );
    return this.systemCache;
  }

  async list(): Promise<BinariesListResponse> {
    const [manifest, system] = await Promise.all([readManifest(), this.detectSystem()]);
    let available: NodeVersionRow[] = [];
    let availableError: string | undefined;
    try {
      const fetched = this.deps.fetchAvailable ? await this.deps.fetchAvailable() : toRows(await listNodeVersions());
      // UI shows a bounded, useful slice: LTS first (newest), then newest non-LTS.
      const lts = fetched.filter((r) => r.lts).slice(0, 8);
      const current = fetched.filter((r) => !r.lts).slice(0, 3);
      available = [...lts, ...current];
    } catch (err) {
      availableError = err instanceof Error ? err.message : String(err);
    }
    const installed = manifest.entries.filter((e) => e.kind === 'runtime');
    return { system, installed, available, ...(availableError !== undefined ? { availableError } : {}) };
  }

  async install(kind: 'runtime' | 'engine', id: string, version?: string): Promise<BinaryInstallResponse> {
    try {
      if (kind === 'engine') {
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
      const built = await buildNodeInstall(normalized, (received, total) => {
        this.deps.emitProgress({ kind: 'runtime', id, version: normalized, receivedBytes: received, totalBytes: total });
      });
      const entry: ManifestEntry = await installArtifact({
        entry: built.entry,
        source: { url: built.url, sha256: built.sha256 },
        onProgress: (p) => {
          this.deps.emitProgress({
            kind: 'runtime',
            id,
            version: normalized,
            receivedBytes: p.receivedBytes,
            totalBytes: p.totalBytes
          });
        }
      });
      this.deps.emitProgress({ kind: 'runtime', id, version: normalized, receivedBytes: 0, totalBytes: null, done: true });
      return { ok: true, entry };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  async remove(kind: 'runtime' | 'engine' | 'runtime-support', id: string, version: string): Promise<BinaryRemoveResponse> {
    try {
      await removeEntry(kind, id, version);
      if (kind === 'runtime' && id === 'node') this.systemCache = null; // re-detect next list
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }
}
