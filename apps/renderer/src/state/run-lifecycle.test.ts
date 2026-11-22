import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { RunStartResponse } from '@rh/protocol';

beforeEach(async () => {
  vi.stubGlobal('localStorage', { getItem: () => null });
  const { useUi } = await import('./ui');
  const { useRun } = await import('./run');
  useRun.setState(useRun.getInitialState());
  useUi.getState().openFile({ id: 'default:example.js', relPath: 'example.js', language: 'javascript', content: '1 + 2', dirty: false });
});

afterEach(() => vi.unstubAllGlobals());

it('forwards an early Stop once the matching start response arrives and retains early output', async () => {
  const { useRun } = await import('./run');
  let resolveStart!: (response: RunStartResponse) => void;
  const start = new Promise<RunStartResponse>((resolve) => { resolveStart = resolve; });
  const cancelRun = vi.fn(async () => ({ ok: true }));
  vi.stubGlobal('window', { api: { startRun: () => start, cancelRun } });
  const starting = useRun.getState().requestStart();
  await useRun.getState().requestCancel();
  expect(useRun.getState().phase).toBe('cancelling');
  useRun.getState().handleEvent({ type: 'stdout', runId: 'example-run', data: 'early' });
  resolveStart({ ok: true, runId: 'example-run', runtimeVersion: 'test' });
  await starting;
  expect(cancelRun).toHaveBeenCalledExactlyOnceWith('example-run');
  expect(useRun.getState().lines.map((line) => line.text)).toEqual(['early']);
});

it('recovers the run controls when the start request rejects', async () => {
  const { useRun } = await import('./run');
  vi.stubGlobal('window', { api: { startRun: async () => { throw new Error('workspace write failed'); } } });
  await useRun.getState().requestStart();
  expect(useRun.getState()).toMatchObject({ phase: 'idle', notice: expect.stringContaining('workspace write failed') });
});

it('starts the script in its own workspace', async () => {
  const { useRun } = await import('./run');
  const { useUi } = await import('./ui');
  useUi.getState().openFile({ id: 'second:example.js', workspaceId: 'second', relPath: 'example.js', language: 'javascript', content: '3', dirty: false });
  const startRun = vi.fn(async () => ({ ok: false, stage: 'active' }));
  vi.stubGlobal('window', { api: { startRun } });
  await useRun.getState().requestStart();
  expect(startRun).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'second', content: '3' }));
});

it('restores the snapshot to an open workspace tab and retains unsaved edits when the user declines', async () => {
  const { useUi, restoreRunSnapshot } = await import('./ui');
  vi.useFakeTimers();
  try {
    const ui = useUi.getState();
    ui.openFile({ id: 'second:original.js', workspaceId: 'second', relPath: 'renamed.js', language: 'javascript', content: 'unsaved', dirty: true });
    ui.setActive('default:example.js');
    const confirm = vi.fn(() => false);
    vi.stubGlobal('window', { confirm });
    const snapshot = { relPath: 'renamed.js', contentSnapshot: 'from history' };
    restoreRunSnapshot('second', snapshot);
    expect(useUi.getState().files.find((file) => file.id === 'second:original.js')?.content).toBe('unsaved');
    useUi.setState((state) => ({ files: state.files.map((file) => ({ ...file, dirty: false })) }));
    restoreRunSnapshot('second', snapshot);
    expect(useUi.getState().activeFileId).toBe('default:example.js');
    expect(useUi.getState().files.find((file) => file.id === 'second:original.js')?.content).toBe('unsaved');
    confirm.mockReturnValue(true);
    restoreRunSnapshot('second', snapshot);
    expect(useUi.getState().activeFileId).toBe('second:original.js');
    expect(useUi.getState().files.find((file) => file.id === 'second:original.js')).toMatchObject({ content: 'from history', dirty: true });
  } finally {
    vi.useRealTimers();
  }
});

it('allows Stop to be retried after a cancellation request rejects', async () => {
  const { useRun } = await import('./run');
  vi.stubGlobal('window', { api: { cancelRun: async () => { throw new Error('cancel request failed'); } } });
  useRun.setState({ phase: 'running', runId: 'example-run' });
  await useRun.getState().requestCancel();
  expect(useRun.getState()).toMatchObject({ phase: 'running', runId: 'example-run', notice: expect.stringContaining('cancel request failed') });
});

it('keeps the active run cancellable after an error until its exit arrives', async () => {
  const { useRun } = await import('./run');
  useRun.setState({ phase: 'running', runId: 'example-run' });
  useRun.getState().handleEvent({ type: 'error', runId: 'example-run', message: 'script error' });
  expect(useRun.getState().phase).toBe('running');
  expect(useRun.getState().lines[0]?.text).toContain('script error');
});

it('keeps raw stdout visible beside a bootstrap echo when IPC combines or splits lines', async () => {
  const { useRun } = await import('./run');
  useRun.setState({ phase: 'running', runId: 'example-run' });
  const send = (data: string) => useRun.getState().handleEvent({ type: 'stdout', runId: 'example-run', data });
  send('L1: console text\nraw');
  send(' stdout\n\nnext');
  expect(useRun.getState().lines.map((line) => line.text)).toEqual(['L1: console text', 'raw stdout', '', 'next']);
});
