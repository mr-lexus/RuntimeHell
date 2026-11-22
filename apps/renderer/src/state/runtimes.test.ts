import { afterEach, expect, it, vi } from 'vitest';
import type { BinaryProgressEvent } from '@rh/protocol';
import { useRuntimes } from './runtimes';

afterEach(() => {
  useRuntimes.setState(useRuntimes.getInitialState());
  vi.unstubAllGlobals();
});

it('unlocks an unversioned engine install when the resolved download fails', async () => {
  let emit!: (event: BinaryProgressEvent) => void;
  const installEngine = vi.fn(async () => {
    emit({ kind: 'runtime', id: 'd8-debug', version: '1.2.3', receivedBytes: 100, totalBytes: 200 });
    return { ok: false, message: 'Incomplete download' };
  });
  vi.stubGlobal('window', { api: {
    onBinariesProgress: (callback: typeof emit) => { emit = callback; return () => {}; }, installEngine
  } });
  useRuntimes.getState().bindEvents();
  await useRuntimes.getState().install('engine', 'd8-debug');
  expect(useRuntimes.getState().progress).toEqual({});
  expect(useRuntimes.getState().notice).toContain('Incomplete download');
  await useRuntimes.getState().install('engine', 'd8-debug');
  expect(installEngine).toHaveBeenCalledTimes(2);
});
