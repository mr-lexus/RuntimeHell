import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => vi.unstubAllGlobals());

it('completes automatic type acquisition for source with no imports', async () => {
  const scope = { postMessage: vi.fn(), onmessage: undefined as undefined | ((event: { data: { code: string } }) => void) };
  vi.stubGlobal('self', scope);
  await import('./ata.worker');
  scope.onmessage!({ data: { code: 'const answer = 42;' } });
  await vi.waitFor(() => expect(scope.postMessage).toHaveBeenCalledWith({ type: 'done', count: 0 }));
  expect(scope.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
});
