import { contextBridge, ipcRenderer } from 'electron';
import { IPC, PingRequestSchema, PingResponseSchema } from '@rh/protocol';

const api = {
  ping: async (sentAt: number): Promise<unknown> => {
    const req = PingRequestSchema.parse({ sentAt });
    return PingResponseSchema.parse(await ipcRenderer.invoke(IPC.ping, req));
  }
};

export type RuntimeHellApi = typeof api;

contextBridge.exposeInMainWorld('api', api);
