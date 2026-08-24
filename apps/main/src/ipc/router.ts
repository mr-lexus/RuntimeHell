/**
 * Pure IPC handler implementations.
 * Kept free of electron imports so they are unit-testable under vitest.
 */
import {
  AnalysisStartRequestSchema,
  BinaryInstallRequestSchema,
  BinaryRemoveRequestSchema,
  BinariesListRequestSchema,
  IPC,
  PkgListRequestSchema,
  PkgOpRequestSchema,
  PkgSearchRequestSchema,
  PingResponseSchema,
  RunCancelRequestSchema,
  RunStartRequestSchema,
  type PingResponse
} from '@rh/protocol';
import { listFiles, readFile, saveFile } from '../workspace/files.js';
import { createWorkspace, deleteWorkspace, listWorkspaces } from '../workspace/workspace-store.js';
import { loadSettings, updateSettings } from '../workspace/settings-store.js';
import { readHistory } from '../workspace/history.js';
import type { ExecutionManager } from '../execution/execution-manager.js';
import type { BinariesController } from '../binaries/binaries-controller.js';
import type { PackageService } from '../packages/package-service.js';
import type { AnalysisManager } from '../engines/analysis-manager.js';

type Register = (channel: string, handler: (payload: unknown) => Promise<unknown>) => void;

/**
 * Validate-and-build the ping response. Pure function; the ipcMain wiring in
 * index.ts simply awaits this.
 */
export async function handlePing(payload: unknown): Promise<PingResponse> {
  const req = (payload ?? {}) as { sentAt?: number };
  return PingResponseSchema.parse({
    pong: true,
    receivedAt: Date.now(),
    ...(typeof req.sentAt === 'number' ? { echoSentAt: req.sentAt } : {})
  });
}

/** Execution handlers bound to a manager instance (todo 11). */
export function registerExecutionHandlers(register: Register, manager: ExecutionManager): void {
  register(IPC.runStart, async (payload) => {
    const req = RunStartRequestSchema.parse(payload);
    return manager.start(req);
  });
  register(IPC.runCancel, async (payload) => {
    const req = RunCancelRequestSchema.parse(payload);
    return { ok: await manager.cancel(req.runId) };
  });
}

/** Binaries handlers bound to a controller instance (todo 12). */
export function registerBinariesHandlers(register: Register, controller: BinariesController): void {
  register(IPC.binariesList, async (payload) => {
    BinariesListRequestSchema.parse(payload ?? {});
    return controller.list();
  });
  register(IPC.binariesInstall, async (payload) => {
    const req = BinaryInstallRequestSchema.parse(payload);
    return controller.install(req.kind, req.id, req.version);
  });
  register(IPC.binariesRemove, async (payload) => {
    const req = BinaryRemoveRequestSchema.parse(payload);
    return controller.remove(req.kind, req.id, req.version);
  });
}

/** Packages handlers bound to a service instance (todo 13). */
export function registerPackageHandlers(register: Register, service: PackageService): void {
  register(IPC.packagesInstall, async (payload) => {
    const req = PkgOpRequestSchema.parse(payload);
    return service.install(req.workspaceId, req.name, req.versionRange, true, undefined, req.managedNodeVersion ?? null);
  });
  register(IPC.packagesRemove, async (payload) => {
    const req = PkgOpRequestSchema.parse(payload);
    return service.uninstall(req.workspaceId, req.name, true, undefined, req.managedNodeVersion ?? null);
  });
  register(IPC.packagesList, async (payload) => {
    const req = PkgListRequestSchema.parse(payload);
    return { ok: true as const, dependencies: await service.list(req.workspaceId) };
  });
  register(IPC.packagesSearch, async (payload) => {
    const req = PkgSearchRequestSchema.parse(payload);
    const rows = await service.search(req.query, req.size);
    if ('error' in rows) return { ok: false as const, message: rows.error };
    return { ok: true as const, results: rows };
  });
}

/** Analysis handlers bound to a manager instance (todo 19). */
export function registerAnalysisHandlers(register: Register, manager: AnalysisManager): void {
  register(IPC.analysisRequest, async (payload) => {
    const req = AnalysisStartRequestSchema.parse(payload);
    void manager.start(req); // results stream via analysisEvent
    return { accepted: true as const, requestId: req.requestId };
  });
  register(IPC.analysisCancel, async (payload) => {
    const req = (payload ?? {}) as { requestId?: string };
    if (typeof req.requestId !== 'string') throw new Error('requestId required');
    return { ok: await manager.cancel(req.requestId) };
  });
}

/** Workspace/settings/history handlers (todo 21). */
export function registerPersistenceHandlers(register: Register): void {
  register(IPC.wsListWorkspaces, async () => listWorkspaces());
  register(IPC.wsCreateWorkspace, async (payload) => {
    const req = (payload ?? {}) as { id?: string; name?: string };
    return createWorkspace(typeof req.id === 'string' && req.id !== '' ? req.id : undefined, req.name);
  });
  register(IPC.wsDeleteWorkspace, async (payload) => {
    const req = (payload ?? {}) as { workspaceId?: string };
    if (typeof req.workspaceId !== 'string') throw new Error('workspaceId required');
    await deleteWorkspace(req.workspaceId);
    return { ok: true as const };
  });
  register(IPC.settingsGet, async () => (await loadSettings()).settings);
  register(IPC.settingsSet, async (payload) => updateSettings((payload ?? {}) as never));
  register(IPC.historyList, async (payload) => {
    const req = (payload ?? {}) as { workspaceId?: string };
    if (typeof req.workspaceId !== 'string') throw new Error('workspaceId required');
    return { ok: true as const, records: await readHistory(req.workspaceId) };
  });
}

/** Wire all main-process IPC handlers onto a registrar (real or fake). */
export function registerIpcHandlers(register: Register): void {
  register(IPC.ping, handlePing);
  register(IPC.wsSaveFile, (p) => saveFile(p as never));
  register(IPC.wsReadFile, (p) => readFile(p as never));
  register(IPC.wsListFiles, (p) => listFiles(p as never));
}
