import { afterEach, expect, it, vi } from 'vitest';
import { usePackages } from './packages';

const state = usePackages.getState;
function pendingResponse<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
afterEach(() => {
  usePackages.setState(usePackages.getInitialState());
  vi.unstubAllGlobals();
});

it('clears an outstanding search and its results when the input is cleared', async () => {
  const pending = pendingResponse<{ ok: true; results: [] }>();
  vi.stubGlobal('window', { api: { pkgSearch: () => pending.promise } });
  state().setQuery('react');
  const request = state().search();
  expect(state().searching).toBe(true);
  state().setQuery('');
  pending.resolve({ ok: true, results: [] });
  await request;
  expect(state()).toMatchObject({ searching: false, results: [] });
});

it('keeps only the newest result when a query is searched twice', async () => {
  const first = pendingResponse<unknown>();
  const second = pendingResponse<unknown>();
  const pkgSearch = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  vi.stubGlobal('window', { api: { pkgSearch } });
  state().setQuery('react');
  const oldRequest = state().search();
  state().setQuery('');
  state().setQuery('react');
  const newRequest = state().search();
  second.resolve({ ok: true, results: [{ name: 'react' }] });
  await newRequest;
  first.resolve({ ok: false, message: 'old request' });
  await oldRequest;
  expect(state().results.map((row) => row.name)).toEqual(['react']);
  expect(state().log).toEqual([]);
});

it('releases the package controls and reports a rejected install', async () => {
  vi.stubGlobal('window', { api: { pkgInstall: vi.fn().mockRejectedValue(new Error('disconnected')) } });
  await state().install('react');
  expect(state().busy).toBe(false);
  expect(state().log).toContain('install failed: disconnected');
});

it('reports remove failures returned by npm', async () => {
  vi.stubGlobal('window', { api: { pkgRemove: async () => ({ ok: false, message: 'Access denied' }) } });
  await state().remove('react');
  expect(state().busy).toBe(false);
  expect(state().log).toContain('remove failed: Access denied');
});

it('does not replace the new workspace dependencies when an old install finishes', async () => {
  const install = pendingResponse<unknown>();
  const pkgInstall = vi.fn(() => install.promise);
  vi.stubGlobal('window', { api: { pkgInstall, pkgList: (workspaceId: string) =>
    Promise.resolve({ ok: true, dependencies: { [workspaceId]: '1' } }) }, dispatchEvent: vi.fn() });
  await state().selectWorkspace('first');
  const run = state().install('demo');
  await state().selectWorkspace('second');
  install.resolve({ ok: true, dependencies: { demo: '1' } });
  await run;
  expect(pkgInstall).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'first' }));
  expect(state().installed).toEqual({ second: '1' });
});

it('allows a failed version lookup to be retried', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({
    ok: true, json: async () => ({ versions: { '1.0.0': {} } })
  }));
  await state().fetchMeta('demo');
  expect(state().metaErrors.demo).toBe('offline');
  await state().fetchMeta('demo');
  expect(state().meta.demo?.latest).toBe('1.0.0');
  expect(state().metaErrors.demo).toBeUndefined();
});

it('shares a version lookup when a picker is quickly reopened', async () => {
  const response = pendingResponse<Response>();
  const fetch = vi.fn(() => response.promise);
  vi.stubGlobal('fetch', fetch);
  const first = state().fetchMeta('demo');
  const second = state().fetchMeta('demo');
  response.resolve(Response.json({ versions: { '1.0.0': {} } }));
  await Promise.all([first, second]);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(state().meta.demo?.latest).toBe('1.0.0');
});
