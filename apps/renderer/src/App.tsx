import { useEffect, useRef, useState } from 'react';
import { exposeMonacoForTests, setRhTheme } from './editor/monaco-setup';
import { useMemo } from 'react';
import { createAtaController, getAtaStatus, onAtaStatus, type AtaStatus } from './editor/ata';
import { typescriptDefaults } from './editor/monaco-setup';
import { emitRunRequested, getActiveFile, onRunRequested, useActiveFile, useUi, type DrawerTab, type OpenFile } from './state/ui';
import type { SelectionInfo } from './editor/selection-service';
import { resolveRunLanguage, useRun } from './state/run';
import { useRuntimes } from './state/runtimes';
import { ANALYSIS_ALL_TYPES } from './state/analysis';
import { useAnalysis } from './state/analysis';
import { useSettings, DEFAULT_RENDERER_SETTINGS } from './state/settings';
import { usePerformance } from './state/performance';
import type { PaletteCommand } from './ui/CommandPalette';
import { WorkbenchShell } from './ui/WorkbenchShell';
import type { SettingsPatch } from '@rh/protocol';
import { ANALYSIS_DEMO_CODE } from './panels/analysis/analysis-demo';
import { primaryShortcut } from './platform-ui';

const WORKSPACE_ID = 'default';

const DARK_THEME_MODES = new Set(['dark', 'midnight', 'forest', 'amethyst', 'cinder']);

const DEMO_FILE = {
  id: 'default:entry.ts',
  relPath: 'entry.ts',
  language: 'typescript',
  dirty: false,
  content: ANALYSIS_DEMO_CODE
};

const DRAWER_TABS: DrawerTab[] = ['console', 'inspector', 'analysis', 'packages', 'runtimes', 'performance'];

export function App(): React.JSX.Element {
  const files = useUi((s) => s.files);
  const activeFileId = useUi((s) => s.activeFileId);
  const drawerTab = useUi((s) => s.drawerTab);
  const drawerRatio = useUi((s) => s.drawerRatio);
  const openFile = useUi((s) => s.openFile);
  const closeFile = useUi((s) => s.closeFile);
  const moveFile = useUi((s) => s.moveFile);
  const renameFile = useUi((s) => s.renameFile);
  const setActive = useUi((s) => s.setActive);
  const updateContent = useUi((s) => s.updateContent);
  const markSaved = useUi((s) => s.markSaved);
  const setDrawerTab = useUi((s) => s.setDrawerTab);
  const setDrawerRatio = useUi((s) => s.setDrawerRatio);
  const appSettings = useSettings((s) => s.settings);
  const settingsHydrated = useSettings((s) => s.hydrated);
  const hydrateSettings = useSettings((s) => s.hydrate);
  const patchSettings = useSettings((s) => s.patch);
  const resetAppearance = useSettings((s) => s.resetAppearance);
  const resetEditor = useSettings((s) => s.resetEditor);
  const resetAllSettings = useSettings((s) => s.resetAll);
  const [workspaceView, setWorkspaceView] = useState<'editor' | 'settings'>('editor');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [systemThemeTick, setSystemThemeTick] = useState(0);
  const runtimeSettingsReadyRef = useRef(false);
  const activeRuntime = useRuntimes((s) => s.activeRuntime);

  useEffect(() => {
    if (!settingsHydrated) return;
    // The first hydrated render applies the persisted preference to the
    // runtime store; do not immediately write the store's pre-hydration
    // default back over that preference.
    if (!runtimeSettingsReadyRef.current) {
      runtimeSettingsReadyRef.current = true;
      return;
    }
    if (appSettings.prefs.defaultRuntime !== activeRuntime) {
      void patchSettings({ prefs: { defaultRuntime: activeRuntime } });
    }
  }, [activeRuntime, appSettings.prefs.defaultRuntime, patchSettings, settingsHydrated]);

  // Keep execution state live even when settings arrive from persistence or
  // another settings action rather than through the local toolbar callback.
  useEffect(() => {
    useRun.getState().setTimeoutMs(appSettings.prefs.timeoutMs);
    useRun.getState().setAutoRun(appSettings.prefs.autorun);
    if (useRuntimes.getState().activeRuntime !== appSettings.prefs.defaultRuntime) {
      useRuntimes.getState().setActiveRuntime(appSettings.prefs.defaultRuntime);
    }
  }, [appSettings.prefs.autorun, appSettings.prefs.defaultRuntime, appSettings.prefs.timeoutMs]);

  const phase = useRun((s) => s.phase);
  const runtimeVersion = useRun((s) => s.runtimeVersion);
  const lastRuntimeId = useRun((s) => s.lastRuntimeId);
  const lastExit = useRun((s) => s.lastExit);
  const autoRun = useRun((s) => s.autoRun);
  const setAutoRun = useRun((s) => s.setAutoRun);
  const scheduleAutoRun = useRun((s) => s.scheduleAutoRun);
  const requestCancel = useRun((s) => s.requestCancel);
  const languageMode = useRun((s) => s.lang);
  const setLang = useRun((s) => s.setLang);

  const activeFile = useActiveFile();
  // Re-resolve on every tab identity/language change as well as on edits. A
  // tab switch can otherwise retain the previous tab's header icon when both
  // files currently have the same content or one is still being hydrated.
  const lang = useMemo(() => resolveRunLanguage(languageMode, activeFile), [activeFileId, activeFile?.content, activeFile?.language, activeFile?.relPath, languageMode]);
  const analysisEngines = useAnalysis((s) => s.engines);
  const analysisEngineId = useAnalysis((s) => s.engineId);
  const analyzeActions = ANALYSIS_ALL_TYPES.map((type) => {
    const caps = analysisEngines.find((e) => e.id === analysisEngineId)?.capabilities;
    const key = type as keyof typeof caps;
    const supported = typeof caps === 'object' && caps !== null ? caps[key] !== false : true;
    return { type, label: `Analyze ▸ ${type}`, supported };
  });
  const [status, setStatus] = useState<string>('ready');
  const lastSelectionRef = useRef<SelectionInfo | null>(null);

  // Analysis is explicit: changing the source or engine clears stale results
  // and cancels any in-flight request, but never starts a replacement probe.
  const activeFileContent = activeFile?.content ?? '';
  useEffect(() => {
    const analysis = useAnalysis.getState();
    if (analysis.requestId !== null) void analysis.cancel();
    analysis.reset();
  }, [activeFileContent, activeFileId, analysisEngineId]);

  useEffect(() => {
    exposeMonacoForTests();
    // Analysis may be requested while the drawer is on another tab, so the
    // engine catalogue must be available outside AnalysisPanel as well.
    void useAnalysis.getState().refreshEngines();
    // Temporary e2e diagnostics (todo 22): expose store snapshots.
    (window as unknown as Record<string, unknown>)['__rh_debug'] = {
      drawerTab: () => useUi.getState().drawerTab,
      analysis: () => {
        const s = useAnalysis.getState();
        return {
          requestId: s.requestId,
          engineId: s.engineId,
          engines: s.engines.map((e) => ({ id: e.id, version: e.version, missing: e.binaryPath === null })),
          lastError: s.lastError,
          types: Object.fromEntries(ANALYSIS_ALL_TYPES.map((t) => [t, s.types[t].status]))
        };
      }
    };
    let disposed = false;
    // Session restore (todo 21): settings-driven tabs/prefs; demo file only
    // when nothing was previously open.
    void (async () => {
      await hydrateSettings();
      const settings = useSettings.getState().settings;
      if (disposed) return;
      useRun.getState().setTimeoutMs(settings.prefs.timeoutMs);
      useRun.getState().setAutoRun(settings.prefs.autorun);
      setDrawerOpen(settings.layout.drawerOpen);
      setDrawerRatio(settings.layout.drawerRatio);
      setDrawerTab(settings.layout.drawerTab);
      useRuntimes.getState().setActiveRuntime(settings.prefs.defaultRuntime);
      for (const tab of settings.session.tabs) {
        const read = await window.api?.readFile({ workspaceId: tab.workspaceId, relPath: tab.relPath });
        const content = read?.ok === true ? read.content : '';
        const language = tab.relPath.endsWith('.ts') || tab.relPath.endsWith('.tsx') ? 'typescript' : 'javascript';
        openFile({ id: `${tab.workspaceId}:${tab.relPath}`, relPath: tab.relPath, language, content, dirty: false });
      }
      if (settings.session.activeRelPath !== null) {
        const match = useUi.getState().files.find((f) => f.relPath === settings.session.activeRelPath);
        if (match !== undefined) useUi.getState().setActive(match.id);
      }
      if (!disposed && useUi.getState().files.length === 0) openFile(DEMO_FILE);
    })();
    // Real executor wiring (todo 11): Ctrl+Enter and toolbar both funnel into
    // the run store; streamed events update it via the preload bridge.
    const offRun = onRunRequested(() => { void useRun.getState().requestStart(); });
    const offEvents = window.api?.onRunEvent((event) => useRun.getState().handleEvent(event));
    const offAnalysis = window.api?.onAnalysisEvent((event) => useAnalysis.getState().handleEvent(event));
    const offPerformance = usePerformance.getState().bindEvents();
    return () => {
      disposed = true;
      offRun();
      offEvents?.();
      offAnalysis?.();
      offPerformance?.();
    };
  }, [openFile]);

  // ATA (todo 14): debounced type acquisition for imports + status chip.
  const ataRef = useRef<ReturnType<typeof createAtaController> | null>(null);
  const [ataStatus, setAtaStatus] = useState<AtaStatus>(getAtaStatus());
  const inlineByLine = useRun((s) => s.inlineByLine);
  const resultByLine = useRun((s) => s.resultByLine);
  const [showOutputColumn, setShowOutputColumn] = useState<boolean>(DEFAULT_RENDERER_SETTINGS.editor.inlineInspector);
  const [scrollTop, setScrollTop] = useState(0);
  const [lineCount, setLineCount] = useState(1);
  useEffect(() => {
    setShowOutputColumn(appSettings.editor.inlineInspector);
    setDrawerOpen(appSettings.layout.drawerOpen);
    if (useUi.getState().drawerRatio !== appSettings.layout.drawerRatio) setDrawerRatio(appSettings.layout.drawerRatio);
  }, [appSettings.editor.inlineInspector, appSettings.layout.drawerOpen, appSettings.layout.drawerRatio, setDrawerRatio]);
  useEffect(() => {
    if (appSettings.appearance.theme !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = (): void => setSystemThemeTick((value) => value + 1);
    media.addEventListener?.('change', onChange);
    return () => media.removeEventListener?.('change', onChange);
  }, [appSettings.appearance.theme]);
  const resolvedTheme = appSettings.appearance.theme === 'system'
    ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
    : DARK_THEME_MODES.has(appSettings.appearance.theme) ? 'dark' : 'light';
  const colorTheme = appSettings.appearance.theme === 'system' ? resolvedTheme : appSettings.appearance.theme;
  void systemThemeTick;
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolvedTheme);
    document.documentElement.setAttribute('data-color-theme', colorTheme);
    document.documentElement.setAttribute('data-accent', appSettings.appearance.accent);
    const customAccent = /^#[0-9a-fA-F]{6}$/.test(appSettings.appearance.accent);
    if (customAccent) {
      document.documentElement.style.setProperty('--accent', appSettings.appearance.accent);
      document.documentElement.style.setProperty(
        '--accent-strong',
        `color-mix(in srgb, ${appSettings.appearance.accent} 70%, ${resolvedTheme === 'light' ? '#000000' : '#ffffff'})`
      );
    } else {
      // Built-in accent selectors own these values; remove any inline custom
      // override when the user returns to a preset.
      document.documentElement.style.removeProperty('--accent');
      document.documentElement.style.removeProperty('--accent-strong');
    }
    document.documentElement.setAttribute('data-density', appSettings.appearance.density);
    document.documentElement.setAttribute('data-intensity', appSettings.appearance.intensity);
    document.documentElement.setAttribute('data-motion', appSettings.appearance.motion);
    document.documentElement.setAttribute('data-ui-scale', String(appSettings.appearance.uiScale));
    // Resolve Monaco colors after the document tokens are updated so the
    // editor matches the selected theme and accent immediately.
    setRhTheme(resolvedTheme === 'light' ? 'rh-light' : 'rh-dark');
  }, [resolvedTheme, colorTheme, appSettings.appearance.theme, appSettings.appearance.accent, appSettings.appearance.density, appSettings.appearance.intensity, appSettings.appearance.motion, appSettings.appearance.uiScale]);
  // Restore persisted lang override once on mount. After mount, the user
  // toggles it freely and the useEffect below auto-tracks file extensions.
  const langHydratedRef = useRef(false);
  useEffect(() => {
    if (langHydratedRef.current) return;
    const stored = localStorage.getItem('rh.lang');
    if (stored === 'auto' || stored === 'js' || stored === 'ts') useRun.getState().setLang(stored);
    langHydratedRef.current = true;
  }, []);
  useEffect(() => {
    if (!langHydratedRef.current) return;
    localStorage.setItem('rh.lang', languageMode);
  }, [languageMode]);
  useEffect(() => {
    ataRef.current ??= createAtaController({
      spawnWorker: () => {
        const worker = new Worker(new URL('./editor/ata.worker.ts', import.meta.url), { type: 'module' });
        type WorkerMsg = { type: 'file' | 'error' | 'done'; code?: string; path?: string; message?: string; count?: number };
        return {
          postMessage: (data: { code: string }) => worker.postMessage(data),
          setOnMessage: (cb: (msg: WorkerMsg) => void) => {
            worker.addEventListener('message', (event: MessageEvent<WorkerMsg>) => cb(event.data));
          }
        };
      },
      addExtraLib: (code, path) => typescriptDefaults.addExtraLib(code, path)
    });
    const offStatus = onAtaStatus(setAtaStatus);
    // Re-acquire when dependencies change (package.json mutation signal).
    const onPkgsChanged = (): void => {
      const file = useUi.getState().files.find((f) => f.id === useUi.getState().activeFileId);
      if (file !== undefined) ataRef.current?.schedule(file.content, true);
    };
    window.addEventListener('rh:packages-changed', onPkgsChanged);
    return () => {
      offStatus();
      window.removeEventListener('rh:packages-changed', onPkgsChanged);
    };
  }, []);
  const scheduleAta = (code: string): void => {
    ataRef.current?.schedule(code);
  };

  // Autosave (todo 21): 500ms debounce after edits; session tabs persisted.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (saveTimer.current !== null) clearTimeout(saveTimer.current);
    if (activeFile?.dirty === true) {
      const file = activeFile;
      saveTimer.current = setTimeout(() => {
        void window.api
          ?.saveFile({ workspaceId: WORKSPACE_ID, relPath: file.relPath, content: file.content })
          .then(() => markSaved(file.id))
          .catch(() => {});
      }, 500);
    }
    if (sessionTimer.current !== null) clearTimeout(sessionTimer.current);
    sessionTimer.current = setTimeout(() => {
      void window.api?.settingsSet({
        session: {
          tabs: files.map((f) => ({ workspaceId: WORKSPACE_ID, relPath: f.relPath })),
          activeRelPath: getActiveFile()?.relPath ?? null
        }
      });
    }, 500);
  }, [files, activeFile, markSaved]);

  const saveFile = (file: OpenFile, content = file.content): void => {
    if (!file) return;
    void window.api
      .saveFile({ workspaceId: WORKSPACE_ID, relPath: file.relPath, content })
      .then(() => {
        markSaved(file.id);
        setStatus(`saved ${file.relPath}`);
      })
      .catch((err: unknown) => setStatus(`save failed: ${String(err)}`));
  };
  const onSave = (content: string): void => {
    if (activeFile) saveFile(activeFile, content);
  };

  const loadAnalysisDemo = (): void => {
    const demoId = `${WORKSPACE_ID}:analysis-demo.ts`;
    const existing = useUi.getState().files.find((file) => file.id === demoId);
    if (existing !== undefined) {
      updateContent(existing.id, ANALYSIS_DEMO_CODE);
      setActive(existing.id);
    } else {
      openFile({
        id: demoId,
        relPath: 'analysis-demo.ts',
        language: 'typescript',
        content: ANALYSIS_DEMO_CODE,
        dirty: true
      });
    }
    setDrawerTab('analysis');
    setDrawerOpen(true);
  };

  // Tab management: create a fresh untitled tab, close existing ones.
  const createTab = (): void => {
    const files = useUi.getState().files;
    let n = files.length + 1;
    let id = `${WORKSPACE_ID}:untitled-${n}.ts`;
    while (files.some((f) => f.id === id)) {
      n += 1;
      id = `${WORKSPACE_ID}:untitled-${n}.ts`;
    }
    openFile({
      id,
      relPath: `untitled-${n}.ts`,
      language: 'typescript',
      content: `// untitled-${n}.ts — ${primaryShortcut('Enter')} runs\nconsole.log('hello from tab ${n}');\n`,
      dirty: false
    });
  };

  const applySettingsPatch = (patch: SettingsPatch): void => {
    void patchSettings(patch);
    if (patch.prefs?.timeoutMs !== undefined) useRun.getState().setTimeoutMs(patch.prefs.timeoutMs);
    if (patch.prefs?.autorun !== undefined) setAutoRun(patch.prefs.autorun);
    if (patch.prefs?.defaultRuntime !== undefined) useRuntimes.getState().setActiveRuntime(patch.prefs.defaultRuntime);
    if (patch.editor?.inlineInspector !== undefined) setShowOutputColumn(patch.editor.inlineInspector);
    if (patch.layout?.drawerOpen !== undefined) setDrawerOpen(patch.layout.drawerOpen);
    if (patch.layout?.drawerRatio !== undefined) setDrawerRatio(patch.layout.drawerRatio);
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && key === 'p') { event.preventDefault(); setPaletteOpen(true); }
      else if (event.key === 'F1') { event.preventDefault(); setPaletteOpen(true); }
      else if ((event.ctrlKey || event.metaKey) && key === ',') { event.preventDefault(); setWorkspaceView('settings'); }
      else if ((event.ctrlKey || event.metaKey) && key === 'j') { event.preventDefault(); setDrawerOpen((value) => !value); }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);
  const commands: readonly PaletteCommand[] = [
    { id: 'run', label: 'Run current file', category: 'Execution', shortcut: primaryShortcut('Enter'), enabled: Boolean(activeFile) && phase === 'idle', run: () => emitRunRequested() },
    { id: 'cancel', label: 'Cancel active run', category: 'Execution', enabled: phase !== 'idle', run: () => void requestCancel() },
    { id: 'save', label: 'Save current file', category: 'File', shortcut: primaryShortcut('S'), enabled: Boolean(activeFile), run: () => { if (activeFile) onSave(activeFile.content); } },
    { id: 'new-tab', label: 'New untitled tab', category: 'File', shortcut: primaryShortcut('N'), run: createTab },
    ...DRAWER_TABS.map((tab) => ({ id: `tool-${tab}`, label: `Focus ${tab}`, category: 'View', run: () => { setDrawerTab(tab); setDrawerOpen(true); } })),
    { id: 'settings', label: 'Open Settings', category: 'View', shortcut: primaryShortcut(','), run: () => setWorkspaceView('settings') },
    { id: 'vim-mode', label: appSettings.editor.vimMode ? 'Disable Vim mode' : 'Enable Vim mode', category: 'Editor', keywords: 'vim neovim modal normal insert', run: () => applySettingsPatch({ editor: { vimMode: !appSettings.editor.vimMode } }) },
    { id: 'theme-dark', label: 'Use dark theme', category: 'Appearance', run: () => applySettingsPatch({ appearance: { theme: 'dark' } }) },
    { id: 'theme-light', label: 'Use light theme', category: 'Appearance', run: () => applySettingsPatch({ appearance: { theme: 'light' } }) },
    { id: 'bg-topology', label: 'Background: topology', category: 'Appearance', run: () => applySettingsPatch({ appearance: { background: 'topology' } }) },
    { id: 'bg-signal', label: 'Background: signal', category: 'Appearance', run: () => applySettingsPatch({ appearance: { background: 'signal' } }) },
    { id: 'bg-blueprint', label: 'Background: blueprint', category: 'Appearance', run: () => applySettingsPatch({ appearance: { background: 'blueprint' } }) },
    { id: 'bg-off', label: 'Disable animated background', category: 'Appearance', run: () => applySettingsPatch({ appearance: { background: 'off' } }) },
    { id: 'autorun', label: autoRun ? 'Disable auto-run' : 'Enable auto-run', category: 'Execution', run: () => applySettingsPatch({ prefs: { autorun: !autoRun } }) }
  ];

  return <WorkbenchShell settings={appSettings} files={files} activeFileId={activeFileId} activeFile={activeFile} drawerTab={drawerTab} drawerRatio={drawerRatio} drawerOpen={drawerOpen} showOutputColumn={showOutputColumn} phase={phase} runtimeVersion={runtimeVersion} lastRuntimeId={lastRuntimeId} activeRuntime={activeRuntime} lastExit={lastExit} autoRun={autoRun} lang={lang} ataStatus={ataStatus} status={status} lineCount={lineCount} scrollTop={scrollTop} inlineByLine={inlineByLine} resultByLine={resultByLine} analyzeActions={analyzeActions} paletteOpen={paletteOpen} settingsViewActive={workspaceView === 'settings'} commands={commands} onClosePalette={() => setPaletteOpen(false)} onOpenSettings={() => setWorkspaceView('settings')} onSetWorkspaceView={setWorkspaceView} onSetActive={setActive} onCloseFile={closeFile} onMoveFile={moveFile} onRenameFile={renameFile} onCreateTab={createTab} onRun={() => emitRunRequested()} onSave={onSave} onSaveFile={(file) => saveFile(file)} onChange={(value) => { if (activeFile) { updateContent(activeFile.id, value); scheduleAutoRun(); scheduleAta(value); } }} onFormatError={(message) => setStatus(`format error: ${message}`)} onSelectionChanged={(info) => { lastSelectionRef.current = info; }} onScrollTop={setScrollTop} onLineCount={setLineCount} onAnalyze={(type, code, info) => { useAnalysis.getState().requestFromSelection(info ?? null, code || activeFile?.content || '', [type], false, lang); setDrawerTab('analysis'); setDrawerOpen(true); }} onLoadAnalysisDemo={loadAnalysisDemo} onSetDrawerTab={(tab) => { setDrawerTab(tab); if (tab !== 'performance') applySettingsPatch({ layout: { drawerTab: tab } }); }} onSetDrawerOpen={(open) => { setDrawerOpen(open); applySettingsPatch({ layout: { drawerOpen: open } }); }} onSetDrawerRatio={(ratio) => { setDrawerRatio(ratio); applySettingsPatch({ layout: { drawerRatio: ratio } }); }} onSetAutoRun={(value) => applySettingsPatch({ prefs: { autorun: value } })} onCancel={() => void requestCancel()} onSetLang={setLang} onSetOutputColumn={(value) => applySettingsPatch({ editor: { inlineInspector: value } })} onPatchSettings={applySettingsPatch} onResetAppearance={() => void resetAppearance()} onResetEditor={() => void resetEditor()} onResetAll={() => void resetAllSettings()} />;
}
