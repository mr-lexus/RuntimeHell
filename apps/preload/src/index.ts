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
  type RunStartResponse
} from '@rh/protocol';

const api = {
  ping: async (sentAt: number): Promise<unknown> => {
    const req = PingRequestSchema.parse({ sentAt });
    return PingResponseSchema.parse(await ipcRenderer.invoke(IPC.ping, req));
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
  startRun: async (req: { workspaceId: string; relPath: string; content: string; timeoutMs: number; runtimeVersion?: string }): Promise<RunStartResponse> => {
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
  installRuntime: async (version: string): Promise<BinaryInstallResponse> => {
    return BinaryInstallResponseSchema.parse(
      await ipcRenderer.invoke(
        IPC.binariesInstall,
        BinaryInstallRequestSchema.parse({ kind: 'runtime', id: 'node', version })
      )
    );
  },
  installEngine: async (id: 'v8' | 'd8-debug', version?: string): Promise<BinaryInstallResponse> => {
    return BinaryInstallResponseSchema.parse(
      await ipcRenderer.invoke(
        IPC.binariesInstall,
        BinaryInstallRequestSchema.parse({ kind: 'engine', id, ...(version !== undefined ? { version } : {}) })
      )
    );
  },
  removeRuntime: async (version: string): Promise<BinaryRemoveResponse> => {
    return BinaryRemoveResponseSchema.parse(
      await ipcRenderer.invoke(
        IPC.binariesRemove,
        BinaryRemoveRequestSchema.parse({ kind: 'runtime', id: 'node', version })
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
  pkgInstall: async (req: { workspaceId: string; name: string; versionRange?: string; managedNodeVersion?: string }): Promise<PkgOpResponse> => {
    return PkgOpResponseSchema.parse(await ipcRenderer.invoke(IPC.packagesInstall, PkgOpRequestSchema.parse(req)));
  },
  pkgRemove: async (req: { workspaceId: string; name: string; managedNodeVersion?: string }): Promise<PkgOpResponse> => {
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
  // --- persistence (todo 21) --------------------------------------------------
  settingsGet: async (): Promise<unknown> => {
    return ipcRenderer.invoke(IPC.settingsGet, {});
  },
  settingsSet: async (patch: unknown): Promise<unknown> => {
    return ipcRenderer.invoke(IPC.settingsSet, patch);
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
