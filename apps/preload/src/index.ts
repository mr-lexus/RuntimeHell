import { contextBridge, ipcRenderer } from 'electron';

import {
  IPC,
  ListFilesRequestSchema,
  ListFilesResponseSchema,
  PingRequestSchema,
  PingResponseSchema,
  ReadFileRequestSchema,
  ReadFileResponseSchema,
  RunCancelRequestSchema,
  RunCancelResponseSchema,
  RunEventSchema,
  RunStartRequestSchema,
  RunStartResponseSchema,
  SaveFileRequestSchema,
  SaveFileResponseSchema,
  BinaryInstallRequestSchema,
  BinaryInstallResponseSchema,
  type BinaryInstallResponse,
  BinaryProgressEventSchema,
  BinaryRemoveRequestSchema,
  BinaryRemoveResponseSchema,
  BinariesListRequestSchema,
  BinariesListResponseSchema,
  PkgListRequestSchema,
  PkgListResponseSchema,
  PkgEventSchema,
  PkgOpRequestSchema,
  PkgOpResponseSchema,
  PkgSearchRequestSchema,
  PkgSearchResponseSchema,
  AnalysisEventSchema,
  AnalysisStartRequestSchema,
  AnalysisStartResponseSchema,
  type AnalysisEvent,
  type AnalysisStartResponse,
  type BinaryProgressEvent,
  type BinaryRemoveResponse,
  type BinariesListResponse,
  type PkgEvent,
  type PkgListResponse,
  type PkgOpResponse,
  type PkgSearchResponse,
  type RunCancelResponse,
  type RunEvent,
  type RuntimeId,
  type RunStartResponse,
  AppSettingsSchema,
  SettingsPatchSchema,
  type AppSettings,
  type SettingsPatch,
  PerformanceStartRequestSchema,
  PerformanceStartResponseSchema,
  PerformanceCancelRequestSchema,
  PerformanceCancelResponseSchema,
  PerformanceEventSchema,
  PerformanceCatalogResponseSchema,
  type PerformanceEvent,
  type PerformanceCatalogResponse,
  type PerformanceStartResponse,
  type PerformanceCancelResponse
} from '@rh/protocol';
import { isLegacyPerformanceContractError, toLegacyPerformanceStartRequest } from './performance-compat.js';

const api = {
  /** Read-only host information needed for platform-specific window chrome. */
  platform: process.platform,
  ping: async (sentAt: number): Promise<unknown> => {
    const req = PingRequestSchema.parse({ sentAt });
    return PingResponseSchema.parse(await ipcRenderer.invoke(IPC.ping, req));
  },
  windowMinimize: async (): Promise<void> => {
    await ipcRenderer.invoke(IPC.windowMinimize);
  },
  windowToggleMaximize: async (): Promise<boolean> => {
    const result = (await ipcRenderer.invoke(IPC.windowToggleMaximize)) as { maximized?: unknown };
    return result.maximized === true;
  },
  windowClose: async (): Promise<void> => {
    await ipcRenderer.invoke(IPC.windowClose);
  },
  windowState: async (): Promise<{ maximized: boolean }> => {
    const result = (await ipcRenderer.invoke(IPC.windowState)) as { maximized?: unknown };
    return { maximized: result.maximized === true };
  },
  saveFile: async (req: { workspaceId: string; relPath: string; content: string }): Promise<unknown> => {
    return SaveFileResponseSchema.parse(await ipcRenderer.invoke(IPC.wsSaveFile, SaveFileRequestSchema.parse(req)));
  },
  readFile: async (req: { workspaceId: string; relPath: string }): Promise<unknown> => {
    return ReadFileResponseSchema.parse(await ipcRenderer.invoke(IPC.wsReadFile, ReadFileRequestSchema.parse(req)));
  },
  listFiles: async (req: { workspaceId: string }): Promise<unknown> => {
    return ListFilesResponseSchema.parse(await ipcRenderer.invoke(IPC.wsListFiles, ListFilesRequestSchema.parse(req)));
  },
  // --- execution (todo 11) -------------------------------------------------
  startRun: async (req: { workspaceId: string; relPath: string; content: string; timeoutMs: number; runtimeId?: RuntimeId; runtimeVersion?: string; lang?: 'js' | 'ts' }): Promise<RunStartResponse> => {
    return RunStartResponseSchema.parse(
      await ipcRenderer.invoke(IPC.runStart, RunStartRequestSchema.parse(req))
    );
  },
  cancelRun: async (runId: string): Promise<RunCancelResponse> => {
    return RunCancelResponseSchema.parse(await ipcRenderer.invoke(IPC.runCancel, RunCancelRequestSchema.parse({ runId })));
  },
  /** Subscribe to streamed run events. Returns an unsubscribe function. */
  onRunEvent: (cb: (event: RunEvent) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
      const parsed = RunEventSchema.safeParse(payload);
      if (parsed.success) cb(parsed.data);
    };
    ipcRenderer.on(IPC.runEvent, handler);
    return () => {
      ipcRenderer.removeListener(IPC.runEvent, handler);
    };
  },
  // --- runtimes panel (todo 12) --------------------------------------------
  listBinaries: async (): Promise<BinariesListResponse> => {
    return BinariesListResponseSchema.parse(
      await ipcRenderer.invoke(IPC.binariesList, BinariesListRequestSchema.parse({}))
    );
  },
  installRuntime: async (id: string, version: string): Promise<BinaryInstallResponse> => {
    return BinaryInstallResponseSchema.parse(
      await ipcRenderer.invoke(
        IPC.binariesInstall,
        BinaryInstallRequestSchema.parse({ kind: 'runtime', id, version })
      )
    );
  },
  /** Install a managed engine. The main process validates the concrete id. */
  installEngine: async (id: string, version?: string): Promise<BinaryInstallResponse> => {
    return BinaryInstallResponseSchema.parse(
      await ipcRenderer.invoke(
        IPC.binariesInstall,
        BinaryInstallRequestSchema.parse({ kind: 'engine', id, ...(version !== undefined ? { version } : {}) })
      )
    );
  },
  /** Copy an existing Windows executable/folder into the private sandbox. */
  importLocalBinary: async (
    kind: 'runtime' | 'engine',
    id: string,
    sourcePath: string,
    version: string
  ): Promise<BinaryInstallResponse> => {
    return BinaryInstallResponseSchema.parse(
      await ipcRenderer.invoke(
        IPC.binariesInstall,
        BinaryInstallRequestSchema.parse({ kind, id, sourcePath, version })
      )
    );
  },
  removeRuntime: async (id: string, version: string): Promise<BinaryRemoveResponse> => {
    return BinaryRemoveResponseSchema.parse(
      await ipcRenderer.invoke(
        IPC.binariesRemove,
        BinaryRemoveRequestSchema.parse({ kind: 'runtime', id, version })
      )
    );
  },
  /** Remove one managed engine version from the binary manifest/cache. */
  removeEngine: async (id: string, version: string): Promise<BinaryRemoveResponse> => {
    return BinaryRemoveResponseSchema.parse(
      await ipcRenderer.invoke(
        IPC.binariesRemove,
        BinaryRemoveRequestSchema.parse({ kind: 'engine', id, version })
      )
    );
  },
  onBinariesProgress: (cb: (event: BinaryProgressEvent) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
      const parsed = BinaryProgressEventSchema.safeParse(payload);
      if (parsed.success) cb(parsed.data);
    };
    ipcRenderer.on(IPC.binariesProgress, handler);
    return () => {
      ipcRenderer.removeListener(IPC.binariesProgress, handler);
    };
  },
  // --- packages panel (todo 13) ---------------------------------------------
  pkgInstall: async (req: { workspaceId: string; name: string; versionRange?: string; managedNodeVersion?: string; ignoreScripts?: boolean }): Promise<PkgOpResponse> => {
    return PkgOpResponseSchema.parse(await ipcRenderer.invoke(IPC.packagesInstall, PkgOpRequestSchema.parse(req)));
  },
  pkgRemove: async (req: { workspaceId: string; name: string; managedNodeVersion?: string; ignoreScripts?: boolean }): Promise<PkgOpResponse> => {
    return PkgOpResponseSchema.parse(await ipcRenderer.invoke(IPC.packagesRemove, PkgOpRequestSchema.parse(req)));
  },
  pkgList: async (workspaceId: string): Promise<PkgListResponse> => {
    return PkgListResponseSchema.parse(await ipcRenderer.invoke(IPC.packagesList, PkgListRequestSchema.parse({ workspaceId })));
  },
  pkgSearch: async (query: string, size?: number): Promise<PkgSearchResponse> => {
    return PkgSearchResponseSchema.parse(
      await ipcRenderer.invoke(IPC.packagesSearch, PkgSearchRequestSchema.parse({ query, ...(size !== undefined ? { size } : {}) }))
    );
  },
  onPkgEvent: (cb: (event: PkgEvent) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
      const parsed = PkgEventSchema.safeParse(payload);
      if (parsed.success) cb(parsed.data);
    };
    ipcRenderer.on(IPC.packagesEvent, handler);
    return () => {
      ipcRenderer.removeListener(IPC.packagesEvent, handler);
    };
  },
  // --- analysis drawer (todo 19) ---------------------------------------------
  enginesList: async (): Promise<unknown> => {
    return ipcRenderer.invoke(IPC.enginesList, {});
  },
  engineCapabilities: async (engineId: string): Promise<unknown> => {
    return ipcRenderer.invoke(IPC.engineCapabilities, { engineId });
  },
  analyze: async (req: {
    requestId: string;
    engineId: 'v8' | 'd8-debug' | 'spidermonkey' | 'javascriptcore';
    code: string;
    analysisTypes: Array<'ast' | 'bytecode' | 'optcode' | 'ir-graph' | 'deopts' | 'gc'>;
    functionName?: string;
    timeoutMs?: number;
    workspaceId?: string;
  }): Promise<AnalysisStartResponse> => {
    return AnalysisStartResponseSchema.parse(
      await ipcRenderer.invoke(IPC.analysisRequest, AnalysisStartRequestSchema.parse(req))
    );
  },
  cancelAnalysis: async (requestId: string): Promise<{ ok: boolean }> => {
    return (await ipcRenderer.invoke(IPC.analysisCancel, { requestId })) as { ok: boolean };
  },
  onAnalysisEvent: (cb: (event: AnalysisEvent) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
      const parsed = AnalysisEventSchema.safeParse(payload);
      if (parsed.success) cb(parsed.data);
    };
    ipcRenderer.on(IPC.analysisEvent, handler);
    return () => {
      ipcRenderer.removeListener(IPC.analysisEvent, handler);
    };
  },
  // --- performance lab ------------------------------------------------------
  performanceCatalog: async (): Promise<PerformanceCatalogResponse> => {
    return PerformanceCatalogResponseSchema.parse(await ipcRenderer.invoke(IPC.performanceCatalog, {}));
  },
  performanceStart: async (req: unknown): Promise<PerformanceStartResponse> => {
    const request = PerformanceStartRequestSchema.parse(req);
    try {
      return PerformanceStartResponseSchema.parse(await ipcRenderer.invoke(IPC.performanceStart, request));
    } catch (error) {
      if (!isLegacyPerformanceContractError(error)) throw error;
      return PerformanceStartResponseSchema.parse(
        await ipcRenderer.invoke(IPC.performanceStart, toLegacyPerformanceStartRequest(request))
      );
    }
  },
  performanceCancel: async (requestId: string): Promise<PerformanceCancelResponse> => {
    return PerformanceCancelResponseSchema.parse(await ipcRenderer.invoke(IPC.performanceCancel, PerformanceCancelRequestSchema.parse({ requestId })));
  },
  onPerformanceEvent: (cb: (event: PerformanceEvent) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
      const parsed = PerformanceEventSchema.safeParse(payload);
      if (parsed.success) cb(parsed.data);
    };
    ipcRenderer.on(IPC.performanceEvent, handler);
    return () => ipcRenderer.removeListener(IPC.performanceEvent, handler);
  },
  // --- persistence (todo 21) --------------------------------------------------
  settingsGet: async (): Promise<AppSettings> => {
    return AppSettingsSchema.parse(await ipcRenderer.invoke(IPC.settingsGet, {}));
  },
  settingsSet: async (patch: SettingsPatch): Promise<AppSettings> => {
    return AppSettingsSchema.parse(await ipcRenderer.invoke(IPC.settingsSet, SettingsPatchSchema.parse(patch)));
  },
  listWorkspaces: async (): Promise<unknown> => {
    return ipcRenderer.invoke(IPC.wsListWorkspaces, {});
  },
  createWorkspace: async (name?: string): Promise<unknown> => {
    return ipcRenderer.invoke(IPC.wsCreateWorkspace, name !== undefined ? { name } : {});
  },
  deleteWorkspace: async (workspaceId: string): Promise<unknown> => {
    return ipcRenderer.invoke(IPC.wsDeleteWorkspace, { workspaceId });
  },
  historyList: async (workspaceId: string): Promise<unknown> => {
    return ipcRenderer.invoke(IPC.historyList, { workspaceId });
  }
};

export type RuntimeHellApi = typeof api;

contextBridge.exposeInMainWorld('api', api);
