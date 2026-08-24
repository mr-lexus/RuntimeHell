import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC,
  ListFilesRequestSchema,
  ListFilesResponseSchema,
  PingRequestSchema,
  PingResponseSchema,
  ReadFileRequestSchema,
  ReadFileResponseSchema,
  SaveFileRequestSchema,
  SaveFileResponseSchema
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
  }
};

export type RuntimeHellApi = typeof api;

contextBridge.exposeInMainWorld('api', api);

