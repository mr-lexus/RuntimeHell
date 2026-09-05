import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { AppSettings, PerformanceCase, RuntimeId } from '@rh/protocol';
import type { DrawerTab } from '../state/ui';
import { CodeEditor } from '../editor/CodeEditor';
import { LineOutputColumn } from '../panels/console/LineOutputColumn';
import { ConsolePanel } from '../panels/console/ConsolePanel';
import { InspectorPanel } from '../panels/inspector/InspectorPanel';
import { AnalysisPanel } from '../panels/analysis/AnalysisPanel';
import { PackagesPanel } from '../panels/packages/PackagesPanel';
import { RuntimesPanel } from '../panels/runtimes/RuntimesPanel';
import { PerformancePanel, PerformanceRunMatrixControl } from '../panels/performance/PerformancePanel';
import { BlockLoader, Button, InstrumentFrame, KeyboardHint, StatusIndicator } from './primitives';
import { CommandPalette, type PaletteCommand } from './CommandPalette';
import { SettingsView } from './SettingsView';
import type { AtaStatus } from '../editor/ata';
import type { SelectionInfo } from '../editor/selection-service';
import type { AnalyzeType, EditorScrollController } from '../editor/CodeEditor';
import type { VimMode } from '../editor/vim-mode';
import { usePerformance } from '../state/performance';
import { useRun, type RunLang } from '../state/run';
import { APP_LOGO_URL } from '../branding';

interface FileLike { id: string; relPath: string; language: string; content: string; dirty: boolean; }

function languageLabel(lang: 'js' | 'ts'): 'JavaScript' | 'TypeScript' {
  return lang === 'js' ? 'JavaScript' : 'TypeScript';
}

function languageModeLabel(mode: RunLang): 'Automatic' | 'JavaScript' | 'TypeScript' {
  return mode === 'auto' ? 'Automatic' : languageLabel(mode);
}

function languageModeIcon(mode: RunLang): string {
  return mode === 'auto' ? '✦' : mode === 'js' ? '\u{e781}' : '\u{e628}';
}

function livePerformanceCases(cases: readonly PerformanceCase[], files: readonly FileLike[]): PerformanceCase[] {
  return cases.map((item) => {
    const ref = item.sourceRef;
    if (ref === undefined) return item;
    const file = files.find((candidate) => (ref.fileId !== undefined && candidate.id === ref.fileId) || candidate.relPath === ref.relPath);
    if (file === undefined || item.sourceMode !== 'selection') return file === undefined ? item : { ...item, body: file.content.trim(), sourceSnapshot: undefined };
    const lines = file.content.split(/\r?\n/);
    const start = Math.max(0, ref.startLine - 1);
    const end = Math.min(lines.length - 1, ref.endLine - 1);
    if (start > end || lines[start] === undefined) return item;
    const selected = lines.slice(start, end + 1);
    if (selected.length === 1) selected[0] = (selected[0] ?? '').slice(Math.max(0, ref.startCol - 1), Math.max(0, ref.endCol - 1));
    else {
      selected[0] = (selected[0] ?? '').slice(Math.max(0, ref.startCol - 1));
      const last = selected.length - 1;
      selected[last] = (selected[last] ?? '').slice(0, Math.max(0, ref.endCol - 1));
    }
    return { ...item, body: selected.join('\n').trim() || item.body, sourceSnapshot: undefined };
  });
}

export interface WorkbenchShellProps {
  settings: AppSettings;
  files: FileLike[];
  activeFileId: string | null;
  activeFile: FileLike | null;
  drawerTab: DrawerTab;
  drawerRatio: number;
  drawerOpen: boolean;
  showOutputColumn: boolean;
  phase: 'idle' | 'running' | 'cancelling';
  runtimeVersion: string | null;
  lastRuntimeId: string | null;
  activeRuntime: RuntimeId;
  lastExit: { code: number | null; durationMs: number; killedBy: string | null } | null;
  autoRun: boolean;
  lang: 'js' | 'ts';
  ataStatus: AtaStatus;
  status: string;
  lineCount: number;
  scrollTop: number;
  inlineByLine: Record<number, { text: string; level: string }[]>;
  resultByLine: Record<number, import('@rh/protocol').SerializedValue>;
  analyzeActions: readonly { type: AnalyzeType; label: string; supported: boolean }[];
  paletteOpen: boolean;
  settingsViewActive: boolean;
  commands: readonly PaletteCommand[];
  onClosePalette: () => void;
  onOpenSettings: () => void;
  onSetWorkspaceView: (view: 'editor' | 'settings') => void;
  onSetActive: (id: string) => void;
  onCloseFile: (id: string) => void;
  onMoveFile: (id: string, targetId: string, after: boolean) => void;
  onRenameFile: (id: string, relPath: string) => void;
  onCreateTab: () => void;
  onRun: () => void;
  onSave: (content: string) => void;
  onSaveFile: (file: FileLike) => void;
  onChange: (content: string) => void;
  onFormatError: (message: string) => void;
  onSelectionChanged: (info: SelectionInfo | null) => void;
  onScrollTop: (value: number) => void;
  onLineCount: (value: number) => void;
  onAnalyze: (type: AnalyzeType, code: string, info: SelectionInfo | null) => void;
  onLoadAnalysisDemo: () => void;
  onSetDrawerTab: (tab: DrawerTab) => void;
  onSetDrawerOpen: (open: boolean) => void;
  onSetDrawerRatio: (ratio: number) => void;
  onSetAutoRun: (value: boolean) => void;
  onCancel: () => void;
  onSetLang: (value: RunLang) => void;
  onSetOutputColumn: (value: boolean) => void;
  onPatchSettings: (patch: import('@rh/protocol').SettingsPatch) => void;
  onResetAppearance: () => void;
  onResetEditor: () => void;
  onResetAll: () => void;
}

const drawerItems: readonly { id: DrawerTab; label: string }[] = [
  { id: 'console', label: 'console' },
  { id: 'inspector', label: 'inspector' },
  { id: 'analysis', label: 'analysis' },
  { id: 'packages', label: 'packages' },
  { id: 'runtimes', label: 'runtimes' },
  { id: 'performance', label: 'performance' }
];

function PerformanceHeaderControls({ files }: { files: readonly FileLike[] }): React.JSX.Element {
  const state = usePerformance();
  const setNumber = (key: 'samples' | 'iterationsPerSample', value: string): void => {
    const limits = key === 'samples' ? { min: 3, max: 200 } : { min: 1, max: 10_000_000 };
    state.setMeasurement({ [key]: Math.max(limits.min, Math.min(limits.max, Number(value) || limits.min)) });
  };
  return <div className="rh-perf-header-controls" aria-label="Performance measurement controls">
    <PerformanceRunMatrixControl />
    <div className="rh-perf-header-presets">{(['quick', 'reliable'] as const).map((preset) => <Button key={preset} title={preset === 'quick' ? '5 samples · 250 cycles' : '30 samples · 1,000 cycles'} onClick={() => state.applyPreset(preset)} disabled={state.running}>{preset}</Button>)}</div>
    <label title="Number of measured samples">samples<input type="number" min={3} max={200} value={state.measurement.samples} disabled={state.running} onChange={(event) => setNumber('samples', event.target.value)} /></label>
    <label title="Iterations per sample">cycles<input type="number" min={1} max={10_000_000} value={state.measurement.iterationsPerSample} disabled={state.running} onChange={(event) => setNumber('iterationsPerSample', event.target.value)} /></label>
    <details className="rh-perf-header-advanced"><summary>advanced</summary><div>
      <label>warmup<input type="number" min={0} max={10_000} value={state.measurement.warmupRounds} disabled={state.running} onChange={(event) => state.setMeasurement({ warmupRounds: Math.max(0, Math.min(10_000, Number(event.target.value) || 0)) })} /></label>
      <label>timeout<input type="number" min={1_000} max={600_000} value={state.measurement.timeoutMs} disabled={state.running} onChange={(event) => state.setMeasurement({ timeoutMs: Math.max(1_000, Math.min(600_000, Number(event.target.value) || 1_000)) })} /></label>
      <label>GC<select value={state.measurement.gcMode} disabled={state.running} onChange={(event) => state.setMeasurement({ gcMode: event.target.value as typeof state.measurement.gcMode })}><option value="runtime">runtime</option><option value="before-group">before group</option><option value="before-sample">before sample</option></select></label>
    </div></details>
    {state.running ? <Button variant="danger" onClick={() => void state.cancel()}>cancel</Button> : <Button variant="primary" onClick={() => void state.run(livePerformanceCases(state.cases, files))} disabled={state.cases.length === 0 || state.runTargets.length === 0}>run</Button>}
  </div>;
}

const VIM_HELP_ITEMS: readonly { keys: string; action: string }[] = [
  { keys: 'h j k l', action: 'move left / down / up / right' },
  { keys: 'w b e', action: 'word motions (next / previous / end)' },
  { keys: '0 ^ $', action: 'line start / first non-blank / line end' },
  { keys: 'i a I A', action: 'insert before / after / line start / line end' },
  { keys: 'o O', action: 'open line below / above' },
  { keys: 'v V', action: 'visual / visual line mode' },
  { keys: 'd y c', action: 'delete / yank / change (with motions)' },
  { keys: 'p P', action: 'paste after / before cursor' },
  { keys: 'u Ctrl+R', action: 'undo / redo' },
  { keys: 'x', action: 'delete character' },
  { keys: 'G', action: 'go to line (with count)' },
  { keys: ':', action: 'command line (try :help)' },
  { keys: 'Esc Ctrl+[', action: 'back to normal mode' }
];

interface TabContextMenuState {
  fileId: string;
  x: number;
  y: number;
}

interface TabRenameState {
  fileId: string;
  value: string;
}

export function WorkbenchShell(props: WorkbenchShellProps): React.JSX.Element {
  const selectedLanguage = languageLabel(props.lang);
  const languageMode = useRun((state) => state.lang);
  const editorLanguage = props.lang === 'js' ? 'javascript' : 'typescript';
  const [selection, setSelection] = useState<SelectionInfo | null>(null);
  const [windowMaximized, setWindowMaximized] = useState(false);
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false);
  const [tabContextMenu, setTabContextMenu] = useState<TabContextMenuState | null>(null);
  const [tabRename, setTabRename] = useState<TabRenameState | null>(null);
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
  const [dragOverTabId, setDragOverTabId] = useState<string | null>(null);
  const [tabScrollState, setTabScrollState] = useState({ left: false, right: false });
  const [vimMode, setVimMode] = useState<VimMode>('normal');
  const [vimHelpOpen, setVimHelpOpen] = useState(false);
  const [vimCommandLine, setVimCommandLine] = useState('');
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const languageMenuRef = useRef<HTMLDivElement | null>(null);
  const tabsRef = useRef<HTMLDivElement | null>(null);
  const dockContentRef = useRef<HTMLDivElement | null>(null);
  const editorScrollController = useRef<EditorScrollController>({ scrollBy: () => undefined });
  // A source slot owns its editor selection/context. Do not carry the
  // previous file's analysis selection into the newly selected tab.
  useEffect(() => {
    setSelection(null);
  }, [props.activeFileId]);
  useEffect(() => {
    let live = true;
    const readWindowState = window.api?.windowState;
    if (typeof readWindowState !== 'function') return () => { live = false; };
    void readWindowState().then((state) => {
      if (live) setWindowMaximized(state.maximized);
    }).catch(() => undefined);
    return () => { live = false; };
  }, []);
  useEffect(() => {
    if (!tabContextMenu && !tabRename) return;
    const close = (): void => setTabContextMenu(null);
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setTabContextMenu(null);
        setTabRename(null);
      }
    };
    // Bubble-phase listener lets the menu/popover stop propagation for its
    // own buttons before the outside-click handler runs.
    document.addEventListener('mousedown', close);
    document.addEventListener('contextmenu', close, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('contextmenu', close, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [tabContextMenu, tabRename]);
  useEffect(() => {
    if (tabRename) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
    // Select the initial name only when the rename dialog opens or switches
    // to another tab. Do not re-run this after onChange: selecting here on
    // every keystroke makes the next character replace the whole filename.
  }, [tabRename?.fileId]);
  useEffect(() => {
    if (!vimHelpOpen) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setVimHelpOpen(false);
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [vimHelpOpen]);
  useEffect(() => {
    if (!languageMenuOpen) return;
    const closeOnOutsideClick = (event: MouseEvent): void => {
      if (!languageMenuRef.current?.contains(event.target as Node)) setLanguageMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setLanguageMenuOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape, true);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape, true);
    };
  }, [languageMenuOpen]);
  useEffect(() => {
    const tabs = tabsRef.current;
    if (!tabs) return;
    const updateScrollState = (): void => {
      const next = {
        left: tabs.scrollLeft > 1,
        right: tabs.scrollLeft + tabs.clientWidth < tabs.scrollWidth - 1
      };
      setTabScrollState((current) => current.left === next.left && current.right === next.right ? current : next);
    };
    updateScrollState();
    tabs.addEventListener('scroll', updateScrollState, { passive: true });
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(updateScrollState) : null;
    observer?.observe(tabs);
    for (const child of Array.from(tabs.children)) observer?.observe(child);
    return () => {
      tabs.removeEventListener('scroll', updateScrollState);
      observer?.disconnect();
    };
  }, [props.files.length]);
  useEffect(() => {
    if (props.activeFileId === null) return;
    const tabs = tabsRef.current;
    const activeTab = Array.from(tabs?.querySelectorAll<HTMLElement>('[data-file-id]') ?? []).find((tab) => tab.dataset.fileId === props.activeFileId);
    activeTab?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }, [props.activeFileId, props.files.length]);
  useLayoutEffect(() => {
    const content = dockContentRef.current;
    if (!content) return;
    // The dock content node is shared by all tool tabs. Clear the previous
    // panel's scroll offset before the newly selected panel is painted.
    content.scrollTop = 0;
    content.scrollLeft = 0;
  }, [props.drawerTab]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || props.files.length === 0) return;
      const activeIndex = props.files.findIndex((file) => file.id === props.activeFileId);
      if (activeIndex === -1) return;
      const activeFile = props.files[activeIndex];
      if (activeFile === undefined) return;
      const key = event.key.toLowerCase();
      if (key === 'tab') {
        event.preventDefault();
        const direction = event.shiftKey ? -1 : 1;
        const nextIndex = (activeIndex + direction + props.files.length) % props.files.length;
        const nextFile = props.files[nextIndex];
        if (nextFile !== undefined) props.onSetActive(nextFile.id);
        return;
      }
      if (key === 'pageup' || key === 'pagedown') {
        event.preventDefault();
        const direction = key === 'pageup' ? -1 : 1;
        const targetIndex = activeIndex + direction;
        if (targetIndex < 0 || targetIndex >= props.files.length) return;
        const target = props.files[targetIndex];
        if (target === undefined) return;
        if (event.shiftKey) props.onMoveFile(activeFile.id, target.id, direction > 0);
        else props.onSetActive(target.id);
        return;
      }
      if (key === 'w' || key === 'f4') {
        event.preventDefault();
        props.onCloseFile(activeFile.id);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [props.files, props.activeFileId, props.onCloseFile, props.onMoveFile, props.onSetActive]);
  const statusKind = props.phase !== 'idle' ? 'running' : props.lastExit?.code === 0 ? 'ready' : props.lastExit?.code !== null && props.lastExit !== null ? 'error' : 'idle';
  const activeRuntimeLabel = props.activeRuntime ?? props.lastRuntimeId ?? 'node';
  const selectTab = (tab: DrawerTab): void => {
    if (props.settingsViewActive) {
      props.onSetWorkspaceView('editor');
      props.onSetDrawerTab(tab);
      props.onSetDrawerOpen(true);
      return;
    }
    if (props.drawerOpen && props.drawerTab === tab) props.onSetDrawerOpen(false);
    else { props.onSetDrawerTab(tab); props.onSetDrawerOpen(true); }
  };
  const theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
  const editorFontSize = Math.round(props.settings.editor.fontSize * props.settings.appearance.uiScale / 100);
  const editorLineHeight = Math.max(18, Math.round(editorFontSize * 1.5));
  const contextFile = tabContextMenu ? props.files.find((file) => file.id === tabContextMenu.fileId) ?? null : null;
  const isMac = window.api?.platform === 'darwin';
  const beginRename = (file: FileLike): void => {
    setTabContextMenu(null);
    setTabRename({ fileId: file.id, value: file.relPath });
  };
  const commitRename = (): void => {
    if (!tabRename) return;
    const nextPath = tabRename.value.trim();
    const file = props.files.find((item) => item.id === tabRename.fileId);
    if (file && nextPath !== '' && nextPath !== file.relPath && !props.files.some((item) => item.id !== file.id && item.relPath.toLowerCase() === nextPath.toLowerCase())) {
      props.onRenameFile(file.id, nextPath);
    }
    setTabRename(null);
  };
  const closeOtherTabs = (fileId: string): void => {
    for (const file of props.files) if (file.id !== fileId) props.onCloseFile(file.id);
  };
  const closeTabsToRight = (fileId: string): void => {
    const index = props.files.findIndex((file) => file.id === fileId);
    if (index === -1) return;
    for (const file of props.files.slice(index + 1)) props.onCloseFile(file.id);
  };
  const scrollTabs = (amount: number): void => {
    tabsRef.current?.scrollBy({ left: amount, behavior: 'smooth' });
  };
  return (
    <div className={`rh-app${isMac ? ' is-mac' : ''}`}>
      <header className={`rh-titlebar${isMac ? ' is-mac' : ''}`}>
        <div className="rh-brand"><img className="rh-brand-logo" src={APP_LOGO_URL} alt="" /><span>RuntimeHell</span></div>
        <div className="rh-titlebar-actions">
          <div className="rh-titlebar-editor-controls" aria-label="Editor controls">
          <Button variant="primary" className="rh-titlebar-run" onClick={props.onRun} disabled={!props.activeFile || props.phase !== 'idle'} aria-label={props.phase === 'idle' ? 'Run source (Ctrl+Enter)' : props.phase === 'cancelling' ? 'Cancelling run' : 'Run in progress'} title={props.phase === 'idle' ? 'Run source (Ctrl+Enter)' : props.phase === 'cancelling' ? 'Cancelling run' : 'Run in progress'}><span className="rh-action-marker" aria-hidden="true">{props.phase === 'idle' ? '▶' : <BlockLoader />}</span></Button>
          <div ref={languageMenuRef} className="rh-titlebar-language-picker">
            <button type="button" className="rh-titlebar-language-trigger" aria-label={`Language: ${selectedLanguage}${languageMode === 'auto' ? ' (Automatic)' : ''}`} title={`Language: ${selectedLanguage}${languageMode === 'auto' ? ' (Automatic)' : ''}`} aria-haspopup="menu" aria-expanded={languageMenuOpen} onClick={() => setLanguageMenuOpen((open) => !open)}>
              <span className="rh-language-icon" aria-hidden="true">{props.lang === 'js' ? '\u{e781}' : '\u{e628}'}</span>
            </button>
            {languageMenuOpen && <div className="rh-titlebar-language-menu" role="menu" aria-label="Select language">
              {(['auto', 'js', 'ts'] as const).map((item) => <button key={item} type="button" role="menuitemradio" className={`rh-titlebar-language-option ${languageMode === item ? 'is-selected' : ''}`} aria-checked={languageMode === item} onClick={() => { props.onSetLang(item); setLanguageMenuOpen(false); }}>
                <span className="rh-language-icon" aria-hidden="true">{languageModeIcon(item)}</span>
                <span>{languageModeLabel(item)}</span>
                {languageMode === item && <span className="rh-titlebar-language-check" aria-hidden="true">✓</span>}
              </button>)}
            </div>}
          </div>
          <Button className="rh-titlebar-output" variant={props.showOutputColumn ? 'active' : 'ghost'} onClick={() => props.onSetOutputColumn(!props.showOutputColumn)} aria-pressed={props.showOutputColumn} aria-label={props.showOutputColumn ? 'Hide line output panel' : 'Show line output panel'} title={props.showOutputColumn ? 'Hide line output panel' : 'Show line output panel'}><svg className="rh-titlebar-output-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M2.25 12c2.5-4 5.75-6 9.75-6s7.25 2 9.75 6c-2.5 4-5.75 6-9.75 6s-7.25-2-9.75-6Z" /><circle cx="12" cy="12" r="2.5" />{!props.showOutputColumn && <path d="m4 4 16 16" />}</svg></Button>
        </div>
          <button className={`rh-top-settings ${props.settingsViewActive ? 'is-active' : ''}`} onClick={() => props.settingsViewActive ? props.onSetWorkspaceView('editor') : props.onOpenSettings()} aria-label={props.settingsViewActive ? 'Return to workspace' : 'Settings'} title={props.settingsViewActive ? 'Return to workspace' : 'Settings (Ctrl+,)'}><span className="rh-top-settings-icon" aria-hidden="true">{props.settingsViewActive ? '\u{f02dc}' : '\u{f0493}'}</span></button>
        </div>
        {!isMac && <div className="rh-window-controls" aria-label="Window controls">
          <button className="rh-window-control" aria-label="Minimize" title="Minimize" onClick={() => { if (typeof window.api?.windowMinimize === 'function') void window.api.windowMinimize(); }}><span className="rh-window-glyph rh-window-glyph-minimize" aria-hidden="true" /></button>
          <button className="rh-window-control" aria-label={windowMaximized ? 'Restore' : 'Maximize'} title={windowMaximized ? 'Restore' : 'Maximize'} onClick={() => { if (typeof window.api?.windowToggleMaximize === 'function') void window.api.windowToggleMaximize().then(setWindowMaximized); }}><span className={`rh-window-glyph ${windowMaximized ? 'rh-window-glyph-restore' : 'rh-window-glyph-maximize'}`} aria-hidden="true" /></button>
          <button className="rh-window-control rh-window-control-close" aria-label="Close" title="Close" onClick={() => { if (typeof window.api?.windowClose === 'function') void window.api.windowClose(); }}><span className="rh-window-glyph rh-window-glyph-close" aria-hidden="true" /></button>
        </div>}
      </header>
      <div className="rh-workspace">
        <main className={`rh-main ${props.settingsViewActive ? 'is-settings' : ''}`}>
          {props.settingsViewActive ? <div className="rh-settings-region"><SettingsView settings={props.settings} onPatch={props.onPatchSettings} onResetAppearance={props.onResetAppearance} onResetEditor={props.onResetEditor} onResetAll={props.onResetAll} onClose={() => props.onSetWorkspaceView('editor')} /></div> : <>
            <InstrumentFrame index="SRC" title="SOURCE" metadata={props.activeFile ? `${selectedLanguage} / LIVE${props.settings.editor.vimMode ? ` / VIM ${vimMode.toUpperCase()}` : ''}` : 'NO SOURCE'} showHeader={false} state="active" className="rh-source-frame">
              <div className="rh-source-tabs-shell">
                {tabScrollState.left && <button type="button" className="rh-tab-scroll-control" onClick={() => scrollTabs(-220)} aria-label="Scroll tabs left" title="Scroll tabs left">‹</button>}
                <div
                  ref={tabsRef}
                  className="rh-source-tabs"
                  role="tablist"
                  aria-label="Open files"
                  onWheel={(event) => {
                    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
                    if (delta !== 0) {
                      event.preventDefault();
                      event.currentTarget.scrollLeft += delta;
                    }
                  }}
                >
                  {props.files.map((file, index) => <div
                    key={file.id}
                    data-file-id={file.id}
                    className={`rh-tab ${file.id === props.activeFileId ? 'is-active' : ''} ${draggedTabId === file.id ? 'is-dragging' : ''} ${dragOverTabId === file.id ? 'is-drop-target' : ''}`}
                    role="tab"
                    aria-selected={file.id === props.activeFileId}
                    tabIndex={0}
                    draggable
                    title={file.relPath}
                    onClick={(event) => { props.onSetActive(file.id); if (event.altKey) closeOtherTabs(file.id); }}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget) return;
                      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); props.onSetActive(file.id); return; }
                      const direction = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
                      const targetIndex = event.key === 'Home' ? 0 : event.key === 'End' ? props.files.length - 1 : index + direction;
                      if (direction !== 0 || event.key === 'Home' || event.key === 'End') {
                        const target = props.files[targetIndex];
                        if (target !== undefined) { event.preventDefault(); props.onSetActive(target.id); const element = Array.from(tabsRef.current?.querySelectorAll<HTMLElement>('[data-file-id]') ?? []).find((tab) => tab.dataset.fileId === target.id); element?.focus(); }
                      }
                    }}
                    onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); setTabContextMenu({ fileId: file.id, x: event.clientX, y: event.clientY }); }}
                    onAuxClick={(event) => { if (event.button === 1) { event.preventDefault(); props.onCloseFile(file.id); } }}
                    onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', file.id); setDraggedTabId(file.id); }}
                    onDragOver={(event) => { if (draggedTabId !== null && draggedTabId !== file.id) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDragOverTabId(file.id); } }}
                    onDragLeave={(event) => { const related = event.relatedTarget; if (!(related instanceof Node) || !event.currentTarget.contains(related)) setDragOverTabId(null); }}
                    onDrop={(event) => { event.preventDefault(); const sourceId = event.dataTransfer.getData('text/plain') || draggedTabId; const rect = event.currentTarget.getBoundingClientRect(); if (sourceId !== null && sourceId !== file.id) props.onMoveFile(sourceId, file.id, event.clientX >= rect.left + rect.width / 2); setDraggedTabId(null); setDragOverTabId(null); }}
                    onDragEnd={() => { setDraggedTabId(null); setDragOverTabId(null); }}
                  >
                    <span className="rh-tab-index">{String(index + 1).padStart(2, '0')}</span>
                    <span className="rh-tab-label">{file.relPath}</span>
                    {file.dirty && <span className="rh-tab-dirty">●</span>}
                    <button type="button" className="rh-tab-close" draggable={false} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); props.onCloseFile(file.id); }} aria-label={`Close ${file.relPath}`} title={`Close ${file.relPath}`}>×</button>
                  </div>)}
                  <button type="button" className="rh-icon-button" onClick={props.onCreateTab} aria-label="New tab" title="New tab">+</button>
                </div>
                {tabScrollState.right && <button type="button" className="rh-tab-scroll-control" onClick={() => scrollTabs(220)} aria-label="Scroll tabs right" title="Scroll tabs right">›</button>}
              </div>
              <div className="rh-editor-region">
                <div className="rh-editor-host">{props.activeFile ? <CodeEditor key={props.activeFile.id} path={props.activeFile.relPath} value={props.activeFile.content} language={editorLanguage} theme={theme === 'light' ? 'rh-light' : 'rh-dark'} fontSize={editorFontSize} editorSettings={props.settings.editor} vimMode={props.settings.editor.vimMode} onVimModeChange={setVimMode} onVimHelp={() => setVimHelpOpen(true)} onVimCommandChange={setVimCommandLine} onChange={props.onChange} onSave={props.onSave} onRun={props.onRun} onFormatError={props.onFormatError} onSelectionChanged={(info) => { setSelection(info); props.onSelectionChanged(info); }} onScrollTop={props.onScrollTop} scrollController={editorScrollController.current} onLineCount={props.onLineCount} analyzeActions={props.analyzeActions} inlineOutputs={props.inlineByLine} inlineResults={props.resultByLine} onAnalyze={props.onAnalyze} /> : <div className="rh-empty-state"><div className="rh-empty-mark">◇</div><strong>No source open</strong><span>Open or create a source slot to begin.</span></div>}</div>
                {props.activeFile && props.showOutputColumn && <div className="rh-inline-output"><LineOutputColumn fileId={props.activeFile.id} lineCount={props.lineCount} scrollTop={props.scrollTop} lineHeight={editorLineHeight} allowExpand scrollController={editorScrollController.current} /></div>}
              </div>
            </InstrumentFrame>
          </>}
          {!props.settingsViewActive && <>
            <div className="rh-dock-resizer" role="separator" aria-orientation="horizontal" tabIndex={0} aria-label="Resize bottom dock" onMouseDown={(event) => { event.preventDefault(); const startY = event.clientY; const startRatio = props.drawerRatio; const move = (moveEvent: MouseEvent): void => props.onSetDrawerRatio(Math.min(.85, Math.max(.08, startRatio + (startY - moveEvent.clientY) / Math.max(1, window.innerHeight)))); const up = (): void => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); }; window.addEventListener('mousemove', move); window.addEventListener('mouseup', up); }} onKeyDown={(event) => { if (event.key === 'ArrowUp') props.onSetDrawerRatio(Math.min(.85, props.drawerRatio + .03)); if (event.key === 'ArrowDown') props.onSetDrawerRatio(Math.max(.08, props.drawerRatio - .03)); }} />
            <InstrumentFrame index="TOOLS" title={props.drawerTab.toUpperCase()} titleSuffix={props.drawerTab === 'performance' && <><details className="rh-perf-help">
              <summary aria-label="How to use Performance" title="How to use Performance">i</summary>
              <div><strong>Compare code samples</strong><span>1. Add files or selections as cases.</span><span>2. Configure runtimes and profiles in the run matrix.</span><span>3. Run every case across the selected matrix.</span></div>
            </details><PerformanceHeaderControls files={props.files}/> </>} state={props.drawerOpen ? 'active' : 'idle'} className={`rh-dock ${props.drawerOpen ? '' : 'is-collapsed'}`} style={{ height: `${Math.round(props.drawerRatio * 100)}%` }} actions={<><div className="rh-dock-tabs" role="tablist" aria-label="Tool windows">{drawerItems.map((item) => <button key={item.id} className={`rh-dock-tab ${props.drawerTab === item.id ? 'is-active' : ''}`} role="tab" aria-label={item.id} aria-selected={props.drawerTab === item.id} onClick={() => selectTab(item.id)}>{item.label}</button>)}</div><Button onClick={() => props.onSetDrawerOpen(!props.drawerOpen)} aria-label={props.drawerOpen ? 'Collapse bottom dock' : 'Expand bottom dock'}>{props.drawerOpen ? 'collapse' : 'expand'}</Button></>}>
            <div className="rh-dock-body"><div ref={dockContentRef} className={`rh-dock-content ${props.drawerTab === 'analysis' ? 'is-analysis' : ''} ${props.drawerTab === 'console' ? 'is-console' : ''}`}>{props.drawerTab === 'console' && <ConsolePanel key={props.activeFileId ?? 'none'} fileId={props.activeFileId} />}{props.drawerTab === 'inspector' && <InspectorPanel key={props.activeFileId ?? 'none'} fileId={props.activeFileId} />}{props.drawerTab === 'analysis' && <AnalysisPanel code={props.activeFile?.content ?? ''} selection={selection} lang={props.lang} onLoadDemo={props.onLoadAnalysisDemo} />}{props.drawerTab === 'packages' && <PackagesPanel />}{props.drawerTab === 'runtimes' && <RuntimesPanel />}{props.drawerTab === 'performance' && <PerformancePanel activeFile={props.activeFile} selection={selection} />}</div></div>
            </InstrumentFrame>
          </>}
          <footer className="rh-statusbar">
            <StatusIndicator status={statusKind} label={props.phase === 'idle' ? (props.lastExit ? `exit ${props.lastExit.code ?? '—'} · ${props.lastExit.durationMs}ms` : 'ready') : props.phase} />
            <span className="rh-status-source" title={props.activeFile?.relPath ?? 'No source open'}>source {props.activeFile?.relPath ?? '—'}</span>
            <span className="rh-status-separator">/</span>
            <button className="rh-status-action" onClick={() => { props.onSetDrawerTab('runtimes'); props.onSetDrawerOpen(true); }} aria-label="Open runtime selector">runtime {activeRuntimeLabel.toUpperCase()} {props.runtimeVersion ? `v${props.runtimeVersion}` : 'version —'}</button>
            <button className={`rh-status-action ${props.autoRun ? 'is-active' : ''}`} onClick={() => props.onSetAutoRun(!props.autoRun)} aria-pressed={props.autoRun}>auto-run {props.autoRun ? 'on' : 'off'}</button>
            <span className="rh-status-types">types {props.ataStatus === 'loading' ? <><BlockLoader /> loading</> : props.ataStatus === 'ready' ? 'ready' : 'offline'}</span>
            {props.settings.editor.vimMode && <span className="rh-status-vim" title="Vim mode">-- {vimMode.toUpperCase()} --{vimCommandLine !== '' ? ` :${vimCommandLine}` : ''}</span>}
            <span className="rh-statusbar-right"><span>engine {props.lastRuntimeId ? props.lastRuntimeId.toUpperCase() : '—'}</span></span>
          </footer>
        </main>
      </div>
      {props.paletteOpen && <CommandPalette commands={props.commands} onClose={props.onClosePalette} />}
      {tabContextMenu && contextFile && <div className="rh-tab-context-menu" style={{ left: tabContextMenu.x, top: tabContextMenu.y }} role="menu" aria-label={`Actions for ${contextFile.relPath}`} onMouseDown={(event) => event.stopPropagation()}>
        <div className="rh-tab-context-heading"><span className="rh-tab-context-index">{String(props.files.findIndex((file) => file.id === contextFile.id) + 1).padStart(2, '0')}</span><span title={contextFile.relPath}>{contextFile.relPath}</span></div>
        <button type="button" role="menuitem" onClick={() => { props.onSetActive(contextFile.id); props.onSaveFile(contextFile); setTabContextMenu(null); }}>Save file <kbd>Ctrl+S</kbd></button>
        <button type="button" role="menuitem" onClick={() => { const copy = navigator.clipboard?.writeText(contextFile.relPath); if (copy) void copy.catch(() => undefined); setTabContextMenu(null); }}>Copy path</button>
        <button type="button" role="menuitem" onClick={() => beginRename(contextFile)}>Rename…</button>
        <div className="rh-tab-context-separator" />
        <button type="button" role="menuitem" onClick={() => { props.onSetActive(contextFile.id); props.onCloseFile(contextFile.id); setTabContextMenu(null); }}>Close tab</button>
        <button type="button" role="menuitem" disabled={props.files.length < 2} onClick={() => { closeOtherTabs(contextFile.id); setTabContextMenu(null); }}>Close other tabs</button>
        <button type="button" role="menuitem" disabled={props.files.findIndex((file) => file.id === contextFile.id) === props.files.length - 1} onClick={() => { closeTabsToRight(contextFile.id); setTabContextMenu(null); }}>Close tabs to the right</button>
        <button type="button" role="menuitem" onClick={() => { for (const file of props.files) props.onCloseFile(file.id); setTabContextMenu(null); }}>Close all tabs</button>
      </div>}
      {tabRename && <div className="rh-tab-rename-popover" role="dialog" aria-label="Rename tab" onMouseDown={(event) => event.stopPropagation()}>
        <label><span>Rename source tab</span><input ref={renameInputRef} value={tabRename.value} onChange={(event) => setTabRename((state) => state ? { ...state, value: event.target.value } : state)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commitRename(); } }} /></label>
        <div><Button onClick={() => setTabRename(null)}>cancel</Button><Button variant="primary" onClick={commitRename}>rename</Button></div>
      </div>}
      {vimHelpOpen && <div className="rh-vim-help-backdrop" onClick={() => setVimHelpOpen(false)} role="presentation">
        <div className="rh-vim-help" role="dialog" aria-label="Vim keybindings" onClick={(event) => event.stopPropagation()}>
          <header className="rh-vim-help-heading">
            <div><div className="rh-eyebrow">EDITOR / MODAL LAYER</div><h2>Vim keybindings</h2></div>
            <Button onClick={() => setVimHelpOpen(false)}>close</Button>
          </header>
          <div className="rh-vim-help-body">
            {VIM_HELP_ITEMS.map((item) => <div key={item.keys} className="rh-vim-help-item"><kbd>{item.keys}</kbd><span>{item.action}</span></div>)}
          </div>
        </div>
      </div>}
    </div>
  );
}
