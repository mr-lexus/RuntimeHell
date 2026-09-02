import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings } from '@rh/protocol';
import { DEFAULT_RENDERER_SETTINGS, useSettings } from './settings';

function settingsWithEditor(editorPatch: Partial<AppSettings['editor']>): AppSettings {
  return {
    ...DEFAULT_RENDERER_SETTINGS,
    prefs: { ...DEFAULT_RENDERER_SETTINGS.prefs },
    appearance: { ...DEFAULT_RENDERER_SETTINGS.appearance },
    editor: { ...DEFAULT_RENDERER_SETTINGS.editor, ...editorPatch },
    layout: { ...DEFAULT_RENDERER_SETTINGS.layout },
    session: { ...DEFAULT_RENDERER_SETTINGS.session, tabs: [] }
  };
}

function resetStore(): void {
  useSettings.setState({ settings: settingsWithEditor({}), hydrated: true });
}

describe('settings patching', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetStore();
  });

  it('keeps independent editor settings when patches are made in quick succession', async () => {
    const resolvers: Array<(settings: AppSettings) => void> = [];
    let resolveSecondStarted!: () => void;
    const secondStarted = new Promise<void>((resolve) => {
      resolveSecondStarted = resolve;
    });
    const settingsSet = vi.fn(() => {
      if (settingsSet.mock.calls.length === 2) resolveSecondStarted();
      return new Promise<AppSettings>((resolve) => resolvers.push(resolve));
    });
    vi.stubGlobal('window', { api: { settingsSet } });
    resetStore();

    const lineNumbersPatch = useSettings.getState().patch({ editor: { lineNumbers: 'relative' } });
    const vimModePatch = useSettings.getState().patch({ editor: { vimMode: true } });

    expect(useSettings.getState().settings.editor.lineNumbers).toBe('relative');
    expect(useSettings.getState().settings.editor.vimMode).toBe(true);

    await Promise.resolve();
    expect(settingsSet).toHaveBeenCalledTimes(1);

    // An older complete response must not overwrite the newer optimistic patch.
    resolvers[0]!(settingsWithEditor({ lineNumbers: 'on', vimMode: false }));
    await secondStarted;
    expect(settingsSet).toHaveBeenCalledTimes(2);
    expect(useSettings.getState().settings.editor.lineNumbers).toBe('relative');
    expect(useSettings.getState().settings.editor.vimMode).toBe(true);

    resolvers[1]!(settingsWithEditor({ lineNumbers: 'relative', vimMode: true }));
    await Promise.all([lineNumbersPatch, vimModePatch]);

    expect(useSettings.getState().settings.editor.lineNumbers).toBe('relative');
    expect(useSettings.getState().settings.editor.vimMode).toBe(true);
  });
});
