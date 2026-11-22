import { afterEach, beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
  vi.useFakeTimers();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const file = { id: 'work:main.ts', workspaceId: 'work', relPath: 'main.ts', content: 'initial', language: 'typescript', dirty: false };

it('retains the original tab when renaming to an existing file', async () => {
  vi.stubGlobal('window', { api: { saveFile: vi.fn().mockRejectedValue(new Error('File already exists')) } });
  const { useUi } = await import('./ui');
  const ui = useUi.getState();
  ui.openFile(file);
  await ui.renameFile(file.id, 'taken.ts');
  expect(useUi.getState().files).toEqual([file]);
  expect(useUi.getState().saveErrors[file.id]).toMatch(/already exists/i);
});

it('saves edits made during a rename to the newly acquired name', async () => {
  let finish!: () => void;
  const save = vi.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }))
    .mockResolvedValue({ ok: true, bytes: 6 });
  vi.stubGlobal('window', { api: { saveFile: save } });
  const { useUi } = await import('./ui');
  const ui = useUi.getState();
  ui.openFile(file);
  const renaming = ui.renameFile(file.id, 'renamed.ts');
  await vi.advanceTimersByTimeAsync(0);
  expect(save).toHaveBeenCalledWith({ workspaceId: 'work', relPath: 'renamed.ts', content: 'initial', createOnly: true });
  ui.updateContent(file.id, 'edited');
  const closing = ui.closeFile(file.id);
  finish();
  await renaming;
  await closing;
  expect(save).toHaveBeenLastCalledWith({ workspaceId: 'work', relPath: 'renamed.ts', content: 'edited' });
  expect(useUi.getState().files).toHaveLength(0);
});

it('keeps a dirty tab open when the write on close fails', async () => {
  vi.stubGlobal('window', { api: { saveFile: vi.fn().mockRejectedValue(new Error('disk full')) } });
  const { useUi } = await import('./ui');
  const ui = useUi.getState();
  ui.openFile(file);
  ui.updateContent(file.id, 'edited');
  await ui.closeFile(file.id);
  expect(useUi.getState().files).toMatchObject([{ content: 'edited', dirty: true }]);
  expect(useUi.getState().saveErrors[file.id]).toContain('disk full');
  const other = { ...file, id: 'work:other.ts', relPath: 'other.ts' };
  vi.stubGlobal('window', { api: { saveFile: vi.fn().mockResolvedValue({ ok: true, bytes: 7 }) } });
  ui.openFile(other);
  await ui.saveFile(other.id);
  expect(useUi.getState().saveErrors[file.id]).toContain('disk full');
  await ui.closeFile(file.id);
  expect(useUi.getState().files).toEqual([other]);
  expect(useUi.getState().saveErrors[file.id]).toBeUndefined();
});

it('keeps newer edits dirty while an earlier autosave is completing', async () => {
  let finishWrite!: () => void;
  const save = vi.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { finishWrite = resolve; }))
    .mockResolvedValue({ ok: true, bytes: 6 });
  vi.stubGlobal('window', { api: { saveFile: save } });
  const { useUi } = await import('./ui');
  const ui = useUi.getState();
  ui.openFile(file);
  ui.updateContent(file.id, 'first');
  await vi.advanceTimersByTimeAsync(500);
  expect(save).toHaveBeenCalledWith({ workspaceId: 'work', relPath: 'main.ts', content: 'first' });
  ui.updateContent(file.id, 'second');
  await vi.advanceTimersByTimeAsync(500);
  expect(save).toHaveBeenCalledTimes(1);
  expect(useUi.getState().files[0]?.dirty).toBe(true);
  finishWrite();
  await vi.advanceTimersByTimeAsync(0);
  expect(save).toHaveBeenLastCalledWith({ workspaceId: 'work', relPath: 'main.ts', content: 'second' });
  expect(useUi.getState().files[0]?.dirty).toBe(false);
});
