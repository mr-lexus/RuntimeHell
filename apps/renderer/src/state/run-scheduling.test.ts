import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('cancels an already queued auto-run without changing the user preference', async () => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
  const { useRun, AUTORUN_DEBOUNCE_MS } = await import('./run');
  vi.useFakeTimers();
  const original = useRun.getState().requestStart;
  const requestStart = vi.fn().mockResolvedValue(undefined);
  useRun.setState({ autoRun: true, requestStart });
  try {
    useRun.getState().scheduleAutoRun();
    useRun.getState().cancelScheduledRun();
    await vi.advanceTimersByTimeAsync(AUTORUN_DEBOUNCE_MS + 1);
    expect(requestStart).not.toHaveBeenCalled();
    expect(useRun.getState().autoRun).toBe(true);
    useRun.getState().scheduleAutoRun();
    await vi.advanceTimersByTimeAsync(AUTORUN_DEBOUNCE_MS + 1);
    expect(requestStart).toHaveBeenCalledTimes(1);
  } finally { useRun.getState().setAutoRun(false); useRun.setState({ requestStart: original }); }
});
