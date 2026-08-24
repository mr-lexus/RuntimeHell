/**
 * Pure IPC handler implementations.
 * Kept free of electron imports so they are unit-testable under vitest.
 */
import {
  BinaryInstallRequestSchema,
  BinaryRemoveRequestSchema,
  BinariesListRequestSchema,
  IPC,
  PingResponseSchema,
  RunCancelRequestSchema,
  RunStartRequestSchema,
  type PingResponse
} from '@rh/protocol';
import { listFiles, readFile, saveFile } from '../workspace/files.js';
import type { ExecutionManager } from '../execution/execution-manager.js';
import type { BinariesController } from '../binaries/binaries-controller.js';

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

/** Wire all main-process IPC handlers onto a registrar (real or fake). */
export function registerIpcHandlers(register: Register): void {
  register(IPC.ping, handlePing);
  register(IPC.wsSaveFile, (p) => saveFile(p as never));
  register(IPC.wsReadFile, (p) => readFile(p as never));
  register(IPC.wsListFiles, (p) => listFiles(p as never));
}
