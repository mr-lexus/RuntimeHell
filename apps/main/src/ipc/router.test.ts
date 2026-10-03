import { describe, expect, it, vi } from 'vitest';
import { IPC } from '@rh/protocol';
import { handlePing, registerIpcHandlers, registerPersistenceHandlers, registerPackageHandlers } from './router.js';
import { PackageService } from '../packages/package-service.js';

type Handler = (payload: unknown) => Promise<unknown>;

function registeredHandlers(): Map<string, Handler> {
  const handlers = new Map<string, Handler>();
  registerIpcHandlers((channel, handler) => handlers.set(channel, handler));
  return handlers;
}

function persistenceHandlers(): Map<string, Handler> {
  const handlers = new Map<string, Handler>();
  registerPersistenceHandlers((channel, handler) => handlers.set(channel, handler));
  return handlers;
}

describe('main IPC validation', () => {
  it('validates package import requests before reading installed files', async () => {
    const service = new PackageService({ emit: () => {} });
    const inspect = vi.spyOn(service, 'importInfo').mockResolvedValue({ ok: false, message: 'not installed' });
    const handlers = new Map<string, Handler>();
    registerPackageHandlers((channel, handler) => handlers.set(channel, handler), service);
    const handler = handlers.get(IPC.packagesImportInfo)!;
    await expect(handler({ workspaceId: 'default', name: '../escape' })).rejects.toThrow();
    await expect(handler({ workspaceId: 'default', name: 'demo', path: '/secret' })).rejects.toThrow();
    expect(inspect).not.toHaveBeenCalled();
    await expect(handler({ workspaceId: 'default', name: 'demo' })).resolves.toMatchObject({ ok: false });
    expect(inspect).toHaveBeenCalledExactlyOnceWith('default', 'demo');
  });
  it('rejects malformed ping payloads in the privileged process', async () => {
    await expect(handlePing({ sentAt: 'not-a-number' })).rejects.toThrow();
    await expect(handlePing({ sentAt: 1, extra: true })).rejects.toThrow();
  });

  it.each([
    [IPC.wsSaveFile, { workspaceId: 'default', relPath: '../escape.js', content: '' }],
    [IPC.wsReadFile, { workspaceId: 'default', relPath: 'safe.js', extra: true }],
    [IPC.wsListFiles, { workspaceId: '' }]
  ])('validates %s before invoking workspace filesystem code', async (channel, payload) => {
    const handler = registeredHandlers().get(channel);
    expect(handler).toBeDefined();
    await expect(handler?.(payload)).rejects.toThrow();
  });

  it.each([
    [IPC.wsCreateWorkspace, { id: '../escape', name: 'bad' }],
    [IPC.wsDeleteWorkspace, { workspaceId: 'bad/path' }],
    [IPC.historyList, { workspaceId: '' }]
  ])('validates persistence payload for %s', async (channel, payload) => {
    const handler = persistenceHandlers().get(channel);
    expect(handler).toBeDefined();
    await expect(handler?.(payload)).rejects.toThrow();
  });
});
