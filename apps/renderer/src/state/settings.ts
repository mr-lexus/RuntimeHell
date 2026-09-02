import { create } from 'zustand';
import type { AppSettings, SettingsPatch } from '@rh/protocol';

export const DEFAULT_RENDERER_SETTINGS: AppSettings = {
  schemaVersion: 2,
  prefs: { timeoutMs: 5000, autorun: false, ignoreScripts: true, defaultRuntime: 'node' },
  appearance: { theme: 'dark', accent: 'cyan', background: 'topology', intensity: 'standard', motion: 'system', density: 'compact', uiScale: 100 },
  editor: {
    fontSize: 13,
    fontLigatures: true,
    tabSize: 2,
    insertSpaces: true,
    wordWrap: 'off',
    lineNumbers: 'on',
    minimap: false,
    folding: true,
    renderWhitespace: 'selection',
    bracketPairColorization: true,
    smoothScrolling: true,
    stickyScroll: false,
    cursorStyle: 'line',
    inlineInspector: true,
    vimMode: false
  },
  layout: { drawerOpen: true, drawerRatio: 0.35, drawerTab: 'console', inlineOutputWidth: 320 },
  session: { tabs: [], activeRelPath: null }
};

interface SettingsState {
  settings: AppSettings;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  patch: (patch: SettingsPatch) => Promise<void>;
  resetAppearance: () => Promise<void>;
  resetEditor: () => Promise<void>;
  resetAll: () => Promise<void>;
}

function legacyPatch(): SettingsPatch {
  const patch: SettingsPatch = {};
  const theme = localStorage.getItem('rh.theme');
  if (theme === 'rh-light' || theme === 'rh-dark') patch.appearance = { theme: theme === 'rh-light' ? 'light' : 'dark' };
  const inspector = localStorage.getItem('rh.inspector');
  if (inspector !== null) patch.editor = { inlineInspector: inspector !== '0' };
  const ratio = Number(localStorage.getItem('rh.ui.drawerRatio'));
  if (Number.isFinite(ratio) && ratio > 0.05 && ratio < 0.9) patch.layout = { drawerRatio: ratio };
  const width = Number(localStorage.getItem('rh.inspector-width'));
  if (Number.isFinite(width) && width >= 180 && width <= 720) patch.layout = { ...patch.layout, inlineOutputWidth: Math.round(width) };
  return patch;
}

// Settings responses contain the complete object. Keep writes ordered and only
// accept a response when no newer optimistic patch has been applied locally.
let patchQueue: Promise<void> = Promise.resolve();
let localPatchRevision = 0;

export const useSettings = create<SettingsState>((set, get) => ({
  settings: DEFAULT_RENDERER_SETTINGS,
  hydrated: false,
  hydrate: async () => {
    if (get().hydrated) return;
    const remote = await window.api?.settingsGet().catch(() => undefined);
    let settings = remote ?? DEFAULT_RENDERER_SETTINGS;
    if (localStorage.getItem('rh.settings-v2-imported') !== '1') {
      const patch = legacyPatch();
      if (Object.keys(patch).length > 0 && window.api) {
        settings = await window.api.settingsSet(patch).catch(() => settings);
      }
      localStorage.setItem('rh.settings-v2-imported', '1');
    }
    set({ settings, hydrated: true });
  },
  patch: async (patch) => {
    const revision = ++localPatchRevision;
    set((state) => ({ settings: {
      ...state.settings,
      prefs: { ...state.settings.prefs, ...patch.prefs },
      appearance: { ...state.settings.appearance, ...patch.appearance },
      editor: { ...state.settings.editor, ...patch.editor },
      layout: { ...state.settings.layout, ...patch.layout },
      session: { ...state.settings.session, ...patch.session }
    } }));

    const request = patchQueue.then(async () => {
      const next = await window.api?.settingsSet(patch).catch(() => undefined);
      if (next && revision === localPatchRevision) set({ settings: next });
    });
    patchQueue = request.catch(() => undefined);
    await request;
  },
  resetAppearance: async () => get().patch({ appearance: DEFAULT_RENDERER_SETTINGS.appearance }),
  resetEditor: async () => get().patch({ editor: DEFAULT_RENDERER_SETTINGS.editor }),
  resetAll: async () => get().patch({ appearance: DEFAULT_RENDERER_SETTINGS.appearance, editor: DEFAULT_RENDERER_SETTINGS.editor })
}));
