/**
 * Pure IPC handler implementations.
 * Kept free of electron imports so they are unit-testable under vitest.
 */
import { IPC, PingResponseSchema, type PingRequest, type PingResponse } from '@rh/protocol';

type Register = (channel: string, handler: (payload: unknown) => Promise<unknown>) => void;

/**
 * Validate-and-build the ping response. Pure function; the ipcMain wiring in
 * index.ts simply awaits this.
 */
export async function handlePing(payload: unknown): Promise<PingResponse> {
  const req = (payload ?? {}) as Partial<PingRequest>;
  return PingResponseSchema.parse({
    pong: true,
    receivedAt: Date.now(),
    ...(typeof req.sentAt === 'number' ? { echoSentAt: req.sentAt } : {})
  });
}

/** Wire all main-process IPC handlers onto a registrar (real or fake). */
export function registerIpcHandlers(register: Register): void {
  register(IPC.ping, handlePing);
}
