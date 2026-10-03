/**
 * Pure IPC handler implementations.
 * Kept free of electron imports so they are unit-testable under vitest.
 */
import {
  AnalysisCancelRequestSchema,
  AnalysisCancelResponseSchema,
  AnalysisStartRequestSchema,
  PerformanceCancelRequestSchema,
  PerformanceStartRequestSchema,
  BinaryInstallRequestSchema,
  BinaryRemoveRequestSchema,
  BinariesListRequestSchema,
  CreateWorkspaceRequestSchema,
  DeleteWorkspaceRequestSchema,
  DeleteWorkspaceResponseSchema,
  HistoryListRequestSchema,
  HistoryListResponseSchema,
  IPC,
  ListFilesRequestSchema,
  ListWorkspacesResponseSchema,
  PkgListRequestSchema,
  PkgImportRequestSchema,
  PkgOpRequestSchema,
  PkgSearchRequestSchema,
  PingRequestSchema,
  PingResponseSchema,
  ReadFileRequestSchema,
  RunCancelRequestSchema,
  RunStartRequestSchema,
  SaveFileRequestSchema,
  SettingsPatchSchema,
  WorkspaceMetaSchema,
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
import type { PerformanceManager } from '../performance/performance-manager.js';

type Register = (channel: string, handler: (payload: unknown) => Promise<unknown>) => void;

/**
 * Validate-and-build the ping response. Pure function; the ipcMain wiring in
 * index.ts simply awaits this.
 */
export async function handlePing(payload: unknown): Promise<PingResponse> {
  const req = PingRequestSchema.parse(payload);
  return PingResponseSchema.parse({
    pong: true,
    receivedAt: Date.now(),
    echoSentAt: req.sentAt
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
    if (req.sourcePath !== undefined) {
      return controller.importLocal(req.kind, req.id, req.sourcePath, req.version);
    }
    return controller.install(req.kind, req.id, req.version);
  });
  register(IPC.binariesRemove, async (payload) => {
    const req = BinaryRemoveRequestSchema.parse(payload);
    return controller.remove(req.kind, req.id, req.version);
  });
}

/** Packages handlers bound to a service instance (todo 13). */
export function registerPackageHandlers(register: Register, service: PackageService): void {
  register(IPC.packagesImportInfo, async (payload) => {
    const req = PkgImportRequestSchema.parse(payload);
    return service.importInfo(req.workspaceId, req.name);
  });
  register(IPC.packagesInstall, async (payload) => {
    const req = PkgOpRequestSchema.parse(payload);
    return service.install(req.workspaceId, req.name, req.versionRange, req.ignoreScripts, undefined, req.managedNodeVersion ?? null);
  });
  register(IPC.packagesRemove, async (payload) => {
    const req = PkgOpRequestSchema.parse(payload);
    return service.uninstall(req.workspaceId, req.name, req.ignoreScripts, undefined, req.managedNodeVersion ?? null);
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
    const req = AnalysisCancelRequestSchema.parse(payload);
    return AnalysisCancelResponseSchema.parse({ ok: await manager.cancel(req.requestId) });
  });
}

/** Performance Lab handlers. Results and progress are streamed by the manager. */
export function registerPerformanceHandlers(register: Register, manager: PerformanceManager): void {
  register(IPC.performanceCatalog, async () => manager.catalog());
  register(IPC.performanceStart, async (payload) => {
    const req = PerformanceStartRequestSchema.parse(payload);
    return manager.start(req);
  });
  register(IPC.performanceCancel, async (payload) => {
    const req = PerformanceCancelRequestSchema.parse(payload);
    return manager.cancel(req.requestId);
  });
}

/** Workspace/settings/history handlers (todo 21). */
export function registerPersistenceHandlers(register: Register): void {
  register(IPC.wsListWorkspaces, async () => ListWorkspacesResponseSchema.parse(await listWorkspaces()));
  register(IPC.wsCreateWorkspace, async (payload) => {
    const req = CreateWorkspaceRequestSchema.parse(payload ?? {});
    return WorkspaceMetaSchema.parse(await createWorkspace(req.id, req.name));
  });
  register(IPC.wsDeleteWorkspace, async (payload) => {
    const req = DeleteWorkspaceRequestSchema.parse(payload);
    await deleteWorkspace(req.workspaceId);
    return DeleteWorkspaceResponseSchema.parse({ ok: true });
  });
  register(IPC.settingsGet, async () => (await loadSettings()).settings);
  register(IPC.settingsSet, async (payload) => updateSettings(SettingsPatchSchema.parse(payload ?? {})));
  register(IPC.historyList, async (payload) => {
    const req = HistoryListRequestSchema.parse(payload);
    return HistoryListResponseSchema.parse({ ok: true, records: await readHistory(req.workspaceId) });
  });
}

/** Wire all main-process IPC handlers onto a registrar (real or fake). */
export function registerIpcHandlers(register: Register): void {
  register(IPC.ping, handlePing);
  register(IPC.wsSaveFile, async (payload) => saveFile(SaveFileRequestSchema.parse(payload)));
  register(IPC.wsReadFile, async (payload) => readFile(ReadFileRequestSchema.parse(payload)));
  register(IPC.wsListFiles, async (payload) => listFiles(ListFilesRequestSchema.parse(payload)));
}
