import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { AppSettings, RuntimeId } from '@rh/protocol';
import type { DrawerTab } from '../state/ui';
import { CodeEditor } from '../editor/CodeEditor';
import type { PackageImportController } from '../editor/package-import';
import { LineOutputColumn } from '../panels/console/LineOutputColumn';
import { ConsolePanel } from '../panels/console/ConsolePanel';
import { InspectorPanel } from '../panels/inspector/InspectorPanel';
import { AnalysisPanel } from '../panels/analysis/AnalysisPanel';
import { PackagesPanel } from '../panels/packages/PackagesPanel';
import { RuntimesPanel } from '../panels/runtimes/RuntimesPanel';
import { PerformancePanel } from '../panels/performance/PerformancePanel';
import { BlockLoader, Button, InstrumentFrame, KeyboardHint, StatusIndicator } from './primitives';
import { CommandPalette, type PaletteCommand } from './CommandPalette';
import { SettingsView } from './SettingsView';
import type { AtaStatus } from '../editor/ata';
import { primaryShortcut } from '../platform-ui';
import type { SelectionInfo } from '../editor/selection-service';
import type { AnalyzeType, EditorScrollController } from '../editor/CodeEditor';
import type { LazyVimAction, VimMode } from '../editor/vim-mode';
import { getLazyVimHelpGroups } from '../editor/lazyvim-keymaps';
import { useRun, type RunLang } from '../state/run';
import { APP_LOGO_URL } from '../branding';
import { Icon } from './Icon';
import { Dialog } from './Dialog';
import { WorkspaceLayoutControls } from './WorkspaceLayoutControls';
import { effectiveToolPosition, resizeToolRatio, WORKSPACE_PRESETS, workspacePreset } from './workspace-layout';

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
  onOpenPalette: () => void;
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
  onChange: (content: string, source?: 'package-import') => void;
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
  { id: 'console', label: 'Console' },
  { id: 'inspector', label: 'Values' },
  { id: 'analysis', label: 'Analysis' },
  { id: 'performance', label: 'Performance' },
  { id: 'packages', label: 'Packages' },
  { id: 'runtimes', label: 'Runtimes' }
];


const VIM_HELP_GROUPS = getLazyVimHelpGroups();

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
  const languageMode = useRun((state) => state.lang);
  // Automatic displays the language resolved for the active file; explicit
  // modes remain stable even when the user changes tabs.
  const displayLanguage = languageMode === 'auto' ? props.lang : languageMode;
  const selectedLanguage = languageLabel(displayLanguage);
  const editorLanguage = displayLanguage === 'js' ? 'javascript' : 'typescript';
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
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [toolMaximized, setToolMaximized] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(window.innerWidth);
  const [visitedTools, setVisitedTools] = useState<ReadonlySet<DrawerTab>>(new Set());
  const stageRef = useRef<HTMLDivElement>(null);
  const [resizePreview, setResizePreview] = useState<number | null>(null);
  const focusMode = props.settings.layout.focusMode;
  const toolPosition = effectiveToolPosition(props.settings.layout.toolPosition, viewportWidth);
  const toolsOpen = props.drawerOpen && !focusMode;
  const toolRatio = resizePreview ?? (toolPosition === 'right' ? props.settings.layout.sideRatio : props.drawerRatio);
  const previousActiveFileId = useRef<string | null>(null);
  const lastActiveFileId = useRef<string | null>(props.activeFileId);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const languageMenuRef = useRef<HTMLDivElement | null>(null);
  const tabsRef = useRef<HTMLDivElement | null>(null);
  const dockContentRef = useRef<HTMLDivElement | null>(null);
  const editorScrollController = useRef<EditorScrollController>({ scrollBy: () => undefined });
  const packageImportController = useRef<PackageImportController>({ insert: () => ({ ok: false, message: 'Open a source file first.' }) });
  useEffect(() => {
    const resize = (): void => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  useEffect(() => {
    if (toolsOpen) setVisitedTools((previous) => previous.has(props.drawerTab) ? previous : new Set([...previous, props.drawerTab]));
  }, [toolsOpen, props.drawerTab]);
  useEffect(() => { if (!toolsOpen) setToolMaximized(false); }, [toolsOpen]);
  // A source slot owns its editor selection/context. Do not carry the
  // previous file's analysis selection into the newly selected tab.
  useEffect(() => {
    setSelection(null);
    if (lastActiveFileId.current !== null && lastActiveFileId.current !== props.activeFileId) previousActiveFileId.current = lastActiveFileId.current;
    lastActiveFileId.current = props.activeFileId;
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
      if (document.querySelector('dialog[open], .rh-vim-help, .rh-tab-rename-popover')) return;
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
        // Ctrl+W belongs to Vim (operator/window prefix). LazyVim users close
        // buffers with <leader>bd; keep the platform tab-close shortcut only
        // outside Vim mode or when macOS sends the distinct Command modifier.
        if (props.settings.editor.vimMode && event.ctrlKey && !event.metaKey) return;
        event.preventDefault();
        props.onCloseFile(activeFile.id);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [props.files, props.activeFileId, props.onCloseFile, props.onMoveFile, props.onSetActive, props.settings.editor.vimMode]);
  const statusKind = props.phase !== 'idle' ? 'running' : props.lastExit?.code === 0 ? 'ready' : props.lastExit?.code !== null && props.lastExit !== null ? 'error' : 'idle';
  const activeRuntimeLabel = props.activeRuntime ?? props.lastRuntimeId ?? 'node';
  const selectTab = (tab: DrawerTab): void => {
    if (focusMode) props.onPatchSettings({ layout: { focusMode: false } });
    if (props.settingsViewActive) {
      props.onSetWorkspaceView('editor');
      props.onSetDrawerTab(tab);
      props.onSetDrawerOpen(true);
      return;
    }
    if (toolsOpen && props.drawerTab === tab) props.onSetDrawerOpen(false);
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
  const selectRelativeFile = (direction: -1 | 1): void => {
    const activeIndex = props.files.findIndex((file) => file.id === props.activeFileId);
    if (activeIndex < 0 || props.files.length < 2) return;
    const target = props.files[(activeIndex + direction + props.files.length) % props.files.length];
    if (target) props.onSetActive(target.id);
  };
  const handleVimAction = (action: LazyVimAction): void => {
    const activeId = props.activeFileId;
    switch (action) {
      case 'buffer.previous': case 'tab.previous': selectRelativeFile(-1); return;
      case 'buffer.next': case 'tab.next': selectRelativeFile(1); return;
      case 'buffer.alternate': {
        const previous = props.files.find((file) => file.id === previousActiveFileId.current);
        if (previous) props.onSetActive(previous.id);
        return;
      }
      case 'buffer.delete': case 'tab.close': if (activeId) props.onCloseFile(activeId); return;
      case 'buffer.deleteOthers': case 'tab.closeOthers': if (activeId) closeOtherTabs(activeId); return;
      case 'buffer.deleteInvisible': return;
      case 'file.new': case 'tab.new': props.onCreateTab(); return;
      case 'file.save': if (props.activeFile) props.onSave(props.activeFile.content); return;
      case 'file.find': props.onOpenPalette(); return;
      case 'ui.toggleWrap': props.onPatchSettings({ editor: { wordWrap: props.settings.editor.wordWrap === 'off' ? 'on' : 'off' } }); return;
      case 'ui.toggleRelativeNumbers': props.onPatchSettings({ editor: { lineNumbers: props.settings.editor.lineNumbers === 'relative' ? 'on' : 'relative' } }); return;
      case 'ui.toggleLineNumbers': props.onPatchSettings({ editor: { lineNumbers: props.settings.editor.lineNumbers === 'off' ? 'on' : 'off' } }); return;
      case 'ui.toggleTheme': props.onPatchSettings({ appearance: { theme: theme === 'light' ? 'dark' : 'light' } }); return;
      case 'ui.toggleSmoothScrolling': props.onPatchSettings({ editor: { smoothScrolling: !props.settings.editor.smoothScrolling } }); return;
      case 'window.grow': setToolRatio(toolRatio - .03); return;
      case 'window.shrink': setToolRatio(toolRatio + .03); return;
      case 'tab.first': if (props.files[0]) props.onSetActive(props.files[0].id); return;
      case 'tab.last': { const last = props.files.at(-1); if (last) props.onSetActive(last.id); return; }
      case 'app.quit': if (typeof window.api?.windowClose === 'function') void window.api.windowClose(); return;
      case 'app.help': setVimHelpOpen(true); return;
      default: return;
    }
  };
  const setToolRatio = (ratio: number): void => {
    const bounded = resizeToolRatio(toolPosition, ratio);
    if (toolPosition === 'right') props.onPatchSettings({ layout: { sideRatio: bounded } });
    else props.onSetDrawerRatio(bounded);
  };
  const layoutCommands: PaletteCommand[] = [
    ...WORKSPACE_PRESETS.map((preset) => ({ id: `layout-${preset.id}`, label: `${preset.label} layout`, category: 'Workspace', keywords: preset.description, run: () => props.onPatchSettings(workspacePreset(preset.id)) })),
    { id: 'focus-mode', label: focusMode ? 'Exit focus mode' : 'Enter focus mode', category: 'Workspace', shortcut: 'Shift+F11', run: () => props.onPatchSettings({ layout: { focusMode: !focusMode } }) },
    { id: 'layout-customize', label: 'Customize workspace layout', category: 'Workspace', run: () => setLayoutOpen(true) },
    { id: 'tool-maximize', label: toolMaximized ? 'Restore editor and tools' : 'Expand current tool', category: 'Workspace', run: () => { props.onPatchSettings({ layout: { focusMode: false, drawerOpen: true } }); setToolMaximized(!toolMaximized); } },
    { id: 'line-results', label: props.showOutputColumn ? 'Hide line results' : 'Show line results', category: 'Workspace', run: () => props.onSetOutputColumn(!props.showOutputColumn) }
  ];
  useEffect(() => {
    const keydown = (event: KeyboardEvent): void => {
      if (document.querySelector('dialog[open], .rh-vim-help, .rh-tab-rename-popover')) return;
      if (event.shiftKey && event.key === 'F11') { event.preventDefault(); props.onPatchSettings({ layout: { focusMode: !focusMode } }); }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [focusMode, props.onPatchSettings]);
  return (
    <div className={`rh-app rh-workbench${isMac ? ' is-mac' : ''}${focusMode ? ' is-focus-mode' : ''}`}>
      <header className={`rh-titlebar${isMac ? ' is-mac' : ''}`}>
        <div className="rh-brand"><img className="rh-brand-logo" src={APP_LOGO_URL} alt="" /><span>RuntimeHell</span></div>
        <button className="rh-command-trigger" onClick={props.onOpenPalette} title={`Search files and commands (${primaryShortcut('Shift+P')})`}><Icon name="search" /><span>Search files and commands</span><KeyboardHint>{primaryShortcut('Shift+P')}</KeyboardHint></button>
        <div className="rh-titlebar-actions">
          <div className="rh-titlebar-editor-controls" aria-label="Editor controls">
          <select className="rh-runtime-quick-select" aria-label="Run with runtime" value={props.activeRuntime} onChange={(event) => props.onPatchSettings({ prefs: { defaultRuntime: event.target.value as RuntimeId } })}><option value="node">Node.js</option><option value="deno">Deno</option><option value="bun">Bun</option><option value="browser">Chromium</option></select>
          <Button variant={props.phase === 'idle' ? 'primary' : 'danger'} className="rh-titlebar-run" onClick={props.phase === 'idle' ? props.onRun : props.onCancel} disabled={!props.activeFile || props.phase === 'cancelling'} aria-label={props.phase === 'idle' ? `Run source (${primaryShortcut('Enter')})` : 'Stop run'} title={props.phase === 'idle' ? `Run source (${primaryShortcut('Enter')})` : 'Stop run'}><Icon name={props.phase === 'idle' ? 'play' : 'stop'} /><span>{props.phase === 'idle' ? 'Run' : props.phase === 'cancelling' ? 'Stopping' : 'Stop'}</span></Button>
          <div ref={languageMenuRef} className="rh-titlebar-language-picker">
            <button type="button" className="rh-titlebar-language-trigger" aria-label={`Language: ${selectedLanguage}${languageMode === 'auto' ? ' (Automatic)' : ''}`} title={`Language: ${selectedLanguage}${languageMode === 'auto' ? ' (Automatic)' : ''}`} aria-haspopup="menu" aria-expanded={languageMenuOpen} onClick={() => setLanguageMenuOpen((open) => !open)}>
              <span aria-hidden="true">{displayLanguage.toUpperCase()}</span><Icon name="chevron" size={12} />
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
          <Button onClick={() => props.onPatchSettings({ layout: { focusMode: !focusMode } })} aria-label={focusMode ? 'Exit focus mode' : 'Enter focus mode'} title="Focus mode (Shift+F11)" aria-pressed={focusMode}><Icon name="focus" />{focusMode && <span>Exit focus</span>}</Button>
          <Button onClick={() => setLayoutOpen(true)} aria-label="Customize layout" title="Customize layout"><Icon name="layout" /></Button>
          <button className={`rh-top-settings ${props.settingsViewActive ? 'is-active' : ''}`} onClick={props.onOpenSettings} aria-label="Settings" title={`Settings (${primaryShortcut(',')})`}><Icon name="settings" /></button>
        </div>
        {!isMac && <div className="rh-window-controls" aria-label="Window controls">
          <button className="rh-window-control" aria-label="Minimize" title="Minimize" onClick={() => { if (typeof window.api?.windowMinimize === 'function') void window.api.windowMinimize(); }}><span className="rh-window-glyph rh-window-glyph-minimize" aria-hidden="true" /></button>
          <button className="rh-window-control" aria-label={windowMaximized ? 'Restore' : 'Maximize'} title={windowMaximized ? 'Restore' : 'Maximize'} onClick={() => { if (typeof window.api?.windowToggleMaximize === 'function') void window.api.windowToggleMaximize().then(setWindowMaximized); }}><span className={`rh-window-glyph ${windowMaximized ? 'rh-window-glyph-restore' : 'rh-window-glyph-maximize'}`} aria-hidden="true" /></button>
          <button className="rh-window-control rh-window-control-close" aria-label="Close" title="Close" onClick={() => { if (typeof window.api?.windowClose === 'function') void window.api.windowClose(); }}><span className="rh-window-glyph rh-window-glyph-close" aria-hidden="true" /></button>
        </div>}
      </header>
      <div className="rh-workspace">
        <main className={`rh-main ${props.settingsViewActive ? 'is-settings' : ''}`}>
          <div ref={stageRef} className={`rh-workbench-stage is-${toolPosition}${toolsOpen ? ' has-tools' : ''}${toolMaximized ? ' is-tool-maximized' : ''}`} style={{ '--tool-size': `${Math.round(toolRatio * 100)}%` } as React.CSSProperties}>
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
                <div className="rh-editor-host">{props.activeFile ? <CodeEditor key={props.activeFile.id} path={props.activeFile.relPath} value={props.activeFile.content} language={editorLanguage} theme={theme === 'light' ? 'rh-light' : 'rh-dark'} fontSize={editorFontSize} editorSettings={props.settings.editor} vimMode={props.settings.editor.vimMode} onVimModeChange={setVimMode} onVimHelp={() => setVimHelpOpen(true)} onVimAction={handleVimAction} onChange={props.onChange} onSave={props.onSave} onRun={props.onRun} onFormatError={props.onFormatError} onSelectionChanged={(info) => { setSelection(info); props.onSelectionChanged(info); }} onScrollTop={props.onScrollTop} packageImportController={packageImportController.current} scrollController={editorScrollController.current} onLineCount={props.onLineCount} analyzeActions={props.analyzeActions} inlineOutputs={props.inlineByLine} inlineResults={props.resultByLine} onAnalyze={props.onAnalyze} /> : <div className="rh-empty-state"><div className="rh-empty-mark">◇</div><strong>No source open</strong><span>Open or create a source slot to begin.</span></div>}</div>
                {props.activeFile && props.showOutputColumn && !focusMode && <div className="rh-inline-output"><LineOutputColumn fileId={props.activeFile.id} lineCount={props.lineCount} scrollTop={props.scrollTop} lineHeight={editorLineHeight} allowExpand scrollController={editorScrollController.current} /></div>}
              </div>
            </InstrumentFrame>
            {toolsOpen && !toolMaximized && <div className="rh-dock-resizer" role="separator" aria-orientation={toolPosition === 'right' ? 'vertical' : 'horizontal'} tabIndex={0} aria-label="Resize tool panel" aria-valuenow={Math.round(toolRatio * 100)} aria-valuemin={toolPosition === 'right' ? 25 : 8} aria-valuemax={toolPosition === 'right' ? 65 : 85} onPointerDown={(event) => {
              event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
            }} onPointerMove={(event) => {
              if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
              const rect = stageRef.current?.getBoundingClientRect();
              if (rect) setResizePreview(resizeToolRatio(toolPosition, toolPosition === 'right' ? (rect.right - event.clientX) / rect.width : (rect.bottom - event.clientY) / rect.height));
            }} onPointerUp={(event) => {
              if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
              event.currentTarget.releasePointerCapture(event.pointerId);
              if (resizePreview !== null) setToolRatio(resizePreview);
              setResizePreview(null);
            }} onLostPointerCapture={() => setResizePreview(null)} onDoubleClick={() => setToolRatio(toolPosition === 'right' ? .4 : .3)} onKeyDown={(event) => {
              const grow = toolPosition === 'right' ? 'ArrowLeft' : 'ArrowUp';
              const shrink = toolPosition === 'right' ? 'ArrowRight' : 'ArrowDown';
              if (event.key === grow || event.key === shrink) { event.preventDefault(); setToolRatio(toolRatio + (event.key === grow ? .03 : -.03)); }
            }} />}
            <section className={`rh-dock ${toolsOpen ? '' : 'is-collapsed'}`} aria-label="Developer tools">
              <div className="rh-tool-strip">
                <div className="rh-dock-tabs" role="tablist" aria-label="Tool windows">{drawerItems.map((item, index) => <button key={item.id} id={`tool-tab-${item.id}`} className={`rh-dock-tab ${toolsOpen && props.drawerTab === item.id ? 'is-active' : ''}`} role="tab" aria-label={item.id} title={item.label} aria-controls={`tool-panel-${item.id}`} aria-selected={toolsOpen && props.drawerTab === item.id} tabIndex={props.drawerTab === item.id ? 0 : -1} onKeyDown={(event) => {
                  const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
                  const next = event.key === 'Home' ? drawerItems[0] : event.key === 'End' ? drawerItems.at(-1) : offset ? drawerItems[(index + offset + drawerItems.length) % drawerItems.length] : undefined;
                  if (next) { event.preventDefault(); props.onSetDrawerTab(next.id); document.getElementById(`tool-tab-${next.id}`)?.focus(); }
                }} onClick={() => selectTab(item.id)}><Icon name={item.id} /><span>{item.label}</span></button>)}</div>
                <div className="rh-tool-strip-actions">
                  {toolsOpen && <Button aria-label={toolMaximized ? 'Restore tool panel' : 'Maximize tool panel'} title={toolMaximized ? 'Restore editor and tools' : 'Expand tool to workspace'} onClick={() => setToolMaximized(!toolMaximized)}><Icon name={toolMaximized ? 'restore' : 'expand'} size={14} /></Button>}
                  <Button aria-label={toolsOpen ? 'Collapse bottom dock' : 'Expand bottom dock'} title={toolsOpen ? 'Hide tools' : 'Show tools'} onClick={() => { props.onPatchSettings({ layout: { focusMode: false } }); props.onSetDrawerOpen(!toolsOpen); }}><Icon name={toolsOpen ? 'close' : 'chevron'} size={14} /></Button>
                </div>
              </div>
              <div className="rh-dock-body" ref={dockContentRef} hidden={!toolsOpen}>
                {drawerItems.map((item) => <div key={item.id} id={`tool-panel-${item.id}`} role="tabpanel" aria-labelledby={`tool-tab-${item.id}`} hidden={props.drawerTab !== item.id} className={`rh-dock-content is-${item.id}`}>
                  {(visitedTools.has(item.id) || (toolsOpen && props.drawerTab === item.id)) && <>
                    {item.id === 'console' && <ConsolePanel key={props.activeFileId ?? 'none'} fileId={props.activeFileId} />}
                    {item.id === 'inspector' && <InspectorPanel key={props.activeFileId ?? 'none'} fileId={props.activeFileId} />}
                    {item.id === 'analysis' && <AnalysisPanel active={toolsOpen && props.drawerTab === 'analysis'} code={props.activeFile?.content ?? ''} selection={selection} lang={props.lang} onLoadDemo={props.onLoadAnalysisDemo} onManageEngines={() => props.onSetDrawerTab('runtimes')} />}
                    {item.id === 'packages' && <PackagesPanel activeFile={props.activeFile} importController={packageImportController.current} />}
                    {item.id === 'runtimes' && <RuntimesPanel />}
                    {item.id === 'performance' && <PerformancePanel active={toolsOpen && props.drawerTab === 'performance'} activeFile={props.activeFile} selection={selection} />}
                  </>}
                </div>)}
              </div>
            </section>
          </div>
          {props.settings.layout.showStatusBar && !focusMode && <footer className="rh-statusbar">
            <StatusIndicator status={statusKind} label={props.phase === 'idle' ? (props.lastExit ? `exit ${props.lastExit.code ?? '—'} · ${props.lastExit.durationMs}ms` : 'ready') : props.phase} />
            {props.status !== 'ready' && <span className="rh-status-message" role="status" title={props.status}>{props.status}</span>}
            <button className="rh-status-action" onClick={() => { props.onSetDrawerTab('runtimes'); props.onSetDrawerOpen(true); }} aria-label="Open runtime selector">runtime {activeRuntimeLabel.toUpperCase()} {props.runtimeVersion ? `v${props.runtimeVersion}` : 'version —'}</button>
            <button className={`rh-status-action ${props.autoRun ? 'is-active' : ''}`} onClick={() => props.onSetAutoRun(!props.autoRun)} aria-pressed={props.autoRun}>auto-run {props.autoRun ? 'on' : 'off'}</button>
            <span className="rh-status-types">types {props.ataStatus === 'loading' ? <><BlockLoader /> loading</> : props.ataStatus === 'ready' ? 'ready' : 'offline'}</span>
            {props.settings.editor.vimMode && <span className="rh-status-vim" title="LazyVim mode">-- {vimMode.toUpperCase()} --</span>}
            <span className="rh-statusbar-right"><span>{props.lineCount} lines</span><span>{selectedLanguage}</span><button className="rh-status-action" onClick={props.onOpenPalette}>All commands <KeyboardHint>F1</KeyboardHint></button></span>
          </footer>}
        </main>
      </div>
      {props.settingsViewActive && <Dialog label="Settings" className="rh-settings-dialog" onClose={() => props.onSetWorkspaceView('editor')}><SettingsView settings={props.settings} onPatch={props.onPatchSettings} onResetAppearance={props.onResetAppearance} onResetEditor={props.onResetEditor} onResetAll={props.onResetAll} onClose={() => props.onSetWorkspaceView('editor')} /></Dialog>}
      {layoutOpen && <Dialog label="Workspace layout" className="rh-layout-dialog" onClose={() => setLayoutOpen(false)}><header className="rh-dialog-heading"><div><h2>Make room for your work</h2><p>Start with a layout, then make it yours.</p></div><Button aria-label="Close layout settings" onClick={() => setLayoutOpen(false)}><Icon name="close" /></Button></header><WorkspaceLayoutControls settings={props.settings} onPatch={props.onPatchSettings} /></Dialog>}
      {props.paletteOpen && <CommandPalette commands={[...props.commands, ...layoutCommands]} onClose={props.onClosePalette} />}
      {tabContextMenu && contextFile && <div className="rh-tab-context-menu" style={{ left: tabContextMenu.x, top: tabContextMenu.y }} role="menu" aria-label={`Actions for ${contextFile.relPath}`} onMouseDown={(event) => event.stopPropagation()}>
        <div className="rh-tab-context-heading"><span className="rh-tab-context-index">{String(props.files.findIndex((file) => file.id === contextFile.id) + 1).padStart(2, '0')}</span><span title={contextFile.relPath}>{contextFile.relPath}</span></div>
        <button type="button" role="menuitem" onClick={() => {
          const file = props.files.find((item) => item.id === contextFile.id) ?? contextFile;
          props.onSetActive(file.id);
          props.onSaveFile(file);
          setTabContextMenu(null);
        }}>Save file <kbd>{primaryShortcut('S')}</kbd></button>
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
            <div><div className="rh-eyebrow">EDITOR / LAZYVIM PROFILE</div><h2>LazyVim keybindings</h2></div>
            <Button onClick={() => setVimHelpOpen(false)}>close</Button>
          </header>
          <div className="rh-vim-help-body">
            {VIM_HELP_GROUPS.map((group) => <section key={group.title} className="rh-vim-help-group">
              <h3>{group.title}</h3>
              {group.items.map((item) => <div key={`${group.title}-${item.keys}`} className={`rh-vim-help-item${item.unavailableReason ? ' is-unavailable' : ''}`} title={item.unavailableReason}>
                <kbd>{item.keys}</kbd><span>{item.action}{item.unavailableReason ? ' — unavailable' : ''}</span>
              </div>)}
            </section>)}
          </div>
        </div>
      </div>}
    </div>
  );
}
