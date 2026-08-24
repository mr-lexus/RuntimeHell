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
  startRun: async (req: { workspaceId: string; relPath: string; content: string; timeoutMs: number }): Promise<RunStartResponse> => {
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
  }
};

export type RuntimeHellApi = typeof api;

contextBridge.exposeInMainWorld('api', api);
