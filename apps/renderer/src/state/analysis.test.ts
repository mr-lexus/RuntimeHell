import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAnalysis } from './analysis';
import { useUi } from './ui';

vi.hoisted(() => vi.stubGlobal('localStorage', { getItem: () => null }));
beforeEach(() => useAnalysis.getState().reset());
afterEach(() => vi.unstubAllGlobals());

describe('analysis request lifecycle', () => {
  it('analyzes the active file in its own workspace', () => {
    const analyze = vi.fn().mockResolvedValue({ accepted: true });
    vi.stubGlobal('window', { api: { analyze } });
    useUi.getState().openFile({ id: 'project:index.js', workspaceId: 'project', relPath: 'index.js', language: 'js', content: '1', dirty: false });
    useAnalysis.getState().requestFromSelection(null, '1', ['ast']);
    expect(analyze).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'project' }));
  });
  it('selects results requested from the editor even when a different type was open', () => {
    vi.stubGlobal('window', { api: { analyze: vi.fn().mockResolvedValue({ accepted: true }) } });
    const state = useAnalysis.getState();
    state.requestFromSelection(null, '1', ['gc']);
    expect(useAnalysis.getState().selectedAnalysisType).toBe('gc');
    state.handleEvent({ t: 'done', requestId: useAnalysis.getState().requestId! });
    state.requestFromSelection(null, '1', ['ast']);
    expect(useAnalysis.getState().selectedAnalysisType).toBe('ast');
  });

  it('finishes only pending types when an engine fails after partial results', () => {
    vi.stubGlobal('window', { api: { analyze: vi.fn().mockResolvedValue({ accepted: true }) } });
    const state = useAnalysis.getState();
    state.requestFromSelection(null, '1', ['ast', 'bytecode']);
    const requestId = useAnalysis.getState().requestId!;
    state.handleEvent({ t: 'unsupported', requestId, analysisType: 'ast', reason: 'release build' });
    state.handleEvent({ t: 'error', requestId, message: 'engine failed' });
    state.handleEvent({ t: 'done', requestId });
    expect(useAnalysis.getState()).toMatchObject({
      requestId: null, lastError: 'engine failed',
      types: { ast: { status: 'unsupported' }, bytecode: { status: 'error', reason: 'engine failed' } }
    });
  });

  it('ignores a start rejection for a request reset after editing the file', async () => {
    let reject!: (error: Error) => void;
    const pending = new Promise<void>((_, no) => { reject = no; });
    vi.stubGlobal('window', { api: { analyze: vi.fn().mockReturnValueOnce(pending).mockResolvedValue({ accepted: true }) } });
    const state = useAnalysis.getState();
    state.requestFromSelection(null, '1', ['bytecode']);
    state.reset();
    state.requestFromSelection(null, '2', ['bytecode']);
    const requestId = useAnalysis.getState().requestId;
    reject(new Error('old request'));
    await Promise.resolve();
    expect(useAnalysis.getState()).toMatchObject({ requestId, lastError: null, types: { bytecode: { status: 'running' } } });
  });

  it.each([false, true])('keeps a run cancellable and reports a failed Stop (reject=%s)', async (reject) => {
    const cancelAnalysis = reject ? vi.fn().mockRejectedValue(new Error('offline')) : vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal('window', { api: { cancelAnalysis, analyze: vi.fn().mockResolvedValue({ accepted: true }) } });
    useAnalysis.getState().requestFromSelection(null, '1', ['ast']);
    const requestId = useAnalysis.getState().requestId;
    await useAnalysis.getState().cancel();
    expect(useAnalysis.getState()).toMatchObject({ requestId, lastError: expect.stringContaining('Could not stop') });
    cancelAnalysis.mockResolvedValue({ ok: true });
    await useAnalysis.getState().cancel();
    useAnalysis.getState().handleEvent({ t: 'cancelled', requestId: requestId! });
    expect(useAnalysis.getState()).toMatchObject({ requestId: null, cancelledNotice: true, lastError: null });
  });
});
