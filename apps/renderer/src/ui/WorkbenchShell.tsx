import { useEffect, useRef, useState } from 'react';
import type { AppSettings, RuntimeId } from '@rh/protocol';
import type { DrawerTab } from '../state/ui';
import { CodeEditor } from '../editor/CodeEditor';
import { LineOutputColumn } from '../panels/console/LineOutputColumn';
import { ConsolePanel } from '../panels/console/ConsolePanel';
import { InspectorPanel } from '../panels/inspector/InspectorPanel';
import { AnalysisPanel } from '../panels/analysis/AnalysisPanel';
import { PackagesPanel } from '../panels/packages/PackagesPanel';
import { RuntimesPanel } from '../panels/runtimes/RuntimesPanel';
import { Button, InstrumentFrame, KeyboardHint, SegmentedControl, StatusIndicator } from './primitives';
import { CommandPalette, type PaletteCommand } from './CommandPalette';
import { SettingsView } from './SettingsView';
import type { AtaStatus } from '../editor/ata';
import type { SelectionInfo } from '../editor/selection-service';
import type { AnalyzeType } from '../editor/CodeEditor';

interface FileLike { id: string; relPath: string; language: string; content: string; dirty: boolean; }

export interface WorkbenchShellProps {
  settings: AppSettings;
  files: FileLike[];
  activeFileId: string | null;
  activeFile: FileLike | null;
  drawerTab: DrawerTab;
  drawerRatio: number;
  drawerOpen: boolean;
  showInspector: boolean;
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
  onOpenPalette: () => void;
  onOpenSettings: () => void;
  onSetWorkspaceView: (view: 'editor' | 'settings') => void;
  onSetActive: (id: string) => void;
  onCloseFile: (id: string) => void;
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
  onSetLang: (value: 'js' | 'ts') => void;
  onSetInspector: (value: boolean) => void;
  onPatchSettings: (patch: import('@rh/protocol').SettingsPatch) => void;
  onResetAppearance: () => void;
  onResetAll: () => void;
}

const drawerItems: readonly { id: DrawerTab; label: string }[] = [
  { id: 'console', label: 'console' },
  { id: 'inspector', label: 'inspector' },
  { id: 'analysis', label: 'analysis' },
  { id: 'packages', label: 'packages' },
  { id: 'runtimes', label: 'runtimes' }
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
  const [selection, setSelection] = useState<SelectionInfo | null>(null);
  const [windowMaximized, setWindowMaximized] = useState(false);
  const [tabContextMenu, setTabContextMenu] = useState<TabContextMenuState | null>(null);
  const [tabRename, setTabRename] = useState<TabRenameState | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
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
  }, [tabRename]);
  const statusKind = props.phase === 'running' ? 'running' : props.lastExit?.code === 0 ? 'ready' : props.lastExit?.code !== null && props.lastExit !== null ? 'error' : 'idle';
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
  return (
    <div className="rh-app">
      <header className="rh-titlebar">
        <div className="rh-brand"><span className="rh-brand-mark">◈</span><span>RuntimeHell</span></div>
        <button className="rh-command-trigger" onClick={props.onOpenPalette} aria-label="Open command palette"><span className="rh-command-prefix">&gt;</span><span>command</span><KeyboardHint>Ctrl+Shift+P</KeyboardHint></button>
        <button className={`rh-top-settings ${props.settingsViewActive ? 'is-active' : ''}`} onClick={() => props.settingsViewActive ? props.onSetWorkspaceView('editor') : props.onOpenSettings()} aria-label={props.settingsViewActive ? 'Return to workspace' : 'Settings'} title={props.settingsViewActive ? 'Return to workspace' : 'Settings (Ctrl+,)'}><span className="rh-top-settings-mark" aria-hidden="true" /><span>{props.settingsViewActive ? 'workspace' : 'settings'}</span></button>
        <div className="rh-window-controls" aria-label="Window controls">
          <button className="rh-window-control" aria-label="Minimize" title="Minimize" onClick={() => { if (typeof window.api?.windowMinimize === 'function') void window.api.windowMinimize(); }}><span className="rh-window-glyph rh-window-glyph-minimize" aria-hidden="true" /></button>
          <button className="rh-window-control" aria-label={windowMaximized ? 'Restore' : 'Maximize'} title={windowMaximized ? 'Restore' : 'Maximize'} onClick={() => { if (typeof window.api?.windowToggleMaximize === 'function') void window.api.windowToggleMaximize().then(setWindowMaximized); }}><span className={`rh-window-glyph ${windowMaximized ? 'rh-window-glyph-restore' : 'rh-window-glyph-maximize'}`} aria-hidden="true" /></button>
          <button className="rh-window-control rh-window-control-close" aria-label="Close" title="Close" onClick={() => { if (typeof window.api?.windowClose === 'function') void window.api.windowClose(); }}><span className="rh-window-glyph rh-window-glyph-close" aria-hidden="true" /></button>
        </div>
      </header>
      <div className="rh-workspace">
        <main className={`rh-main ${props.settingsViewActive ? 'is-settings' : ''}`}>
          {props.settingsViewActive ? <div className="rh-settings-region"><SettingsView settings={props.settings} onPatch={props.onPatchSettings} onResetAppearance={props.onResetAppearance} onResetAll={props.onResetAll} onClose={() => props.onSetWorkspaceView('editor')} /></div> : <>
            <InstrumentFrame index="SRC" title="SOURCE" metadata={props.activeFile ? `${props.lang.toUpperCase()} / LIVE${props.settings.editor.vimMode ? ' / VIM' : ''}` : 'NO SOURCE'} state="active" className="rh-source-frame" actions={<div className="rh-source-actions"><Button variant="primary" onClick={props.onRun} disabled={!props.activeFile || props.phase !== 'idle'}><span className="rh-action-marker">▶</span> run</Button><KeyboardHint>Ctrl+Enter</KeyboardHint><SegmentedControl aria-label="Language">{(['js', 'ts'] as const).map((item) => <button key={item} className={`rh-choice ${props.lang === item ? 'is-selected' : ''}`} aria-pressed={props.lang === item} onClick={() => props.onSetLang(item)}>{item.toUpperCase()}</button>)}</SegmentedControl><Button variant={props.showInspector ? 'active' : 'ghost'} onClick={() => props.onSetInspector(!props.showInspector)}>inline {props.showInspector ? 'on' : 'off'}</Button><Button variant="ghost" onClick={props.onOpenSettings}>settings</Button></div>}>
              <div className="rh-source-tabs" role="tablist" aria-label="Open files">
                {props.files.map((file, index) => <button key={file.id} className={`rh-tab ${file.id === props.activeFileId ? 'is-active' : ''}`} role="tab" aria-selected={file.id === props.activeFileId} onClick={() => props.onSetActive(file.id)} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); setTabContextMenu({ fileId: file.id, x: event.clientX, y: event.clientY }); }}><span className="rh-tab-index">{String(index + 1).padStart(2, '0')}</span><span className="rh-tab-label" title={file.relPath}>{file.relPath}</span>{file.dirty && <span className="rh-tab-dirty">●</span>}<span className="rh-tab-close" onClick={(event) => { event.stopPropagation(); props.onCloseFile(file.id); }} role="button" aria-label={`Close ${file.relPath}`}>×</span></button>)}
                <button className="rh-icon-button" onClick={props.onCreateTab} aria-label="New tab">+</button>
              </div>
              <div className="rh-editor-region">
                <div className="rh-editor-host">{props.activeFile ? <CodeEditor key={props.activeFile.id} path={props.activeFile.relPath} value={props.activeFile.content} language={props.activeFile.language} theme={theme === 'light' ? 'rh-light' : 'rh-dark'} fontSize={editorFontSize} vimMode={props.settings.editor.vimMode} onChange={props.onChange} onSave={props.onSave} onRun={props.onRun} onFormatError={props.onFormatError} onSelectionChanged={(info) => { setSelection(info); props.onSelectionChanged(info); }} onScrollTop={props.onScrollTop} onLineCount={props.onLineCount} analyzeActions={props.analyzeActions} inlineOutputs={props.inlineByLine} inlineResults={props.resultByLine} onAnalyze={props.onAnalyze} /> : <div className="rh-empty-state"><div className="rh-empty-mark">◇</div><strong>No source open</strong><span>Open or create a source slot to begin.</span></div>}</div>
                {props.activeFile && <div className="rh-inline-output"><LineOutputColumn fileId={props.activeFile.id} lineCount={props.lineCount} scrollTop={props.scrollTop} lineHeight={editorLineHeight} allowExpand={props.showInspector} /></div>}
              </div>
            </InstrumentFrame>
          </>}
          {!props.settingsViewActive && <>
            <div className="rh-dock-resizer" role="separator" aria-orientation="horizontal" tabIndex={0} aria-label="Resize bottom dock" onMouseDown={(event) => { event.preventDefault(); const startY = event.clientY; const startRatio = props.drawerRatio; const move = (moveEvent: MouseEvent): void => props.onSetDrawerRatio(Math.min(.85, Math.max(.08, startRatio + (startY - moveEvent.clientY) / Math.max(1, window.innerHeight)))); const up = (): void => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); }; window.addEventListener('mousemove', move); window.addEventListener('mouseup', up); }} onKeyDown={(event) => { if (event.key === 'ArrowUp') props.onSetDrawerRatio(Math.min(.85, props.drawerRatio + .03)); if (event.key === 'ArrowDown') props.onSetDrawerRatio(Math.max(.08, props.drawerRatio - .03)); }} />
            <InstrumentFrame index="TOOLS" title={props.drawerTab.toUpperCase()} state={props.drawerOpen ? 'active' : 'idle'} className={`rh-dock ${props.drawerOpen ? '' : 'is-collapsed'}`} style={{ height: `${Math.round(props.drawerRatio * 100)}%` }} actions={<><div className="rh-dock-tabs" role="tablist" aria-label="Tool windows">{drawerItems.map((item) => <button key={item.id} className={`rh-dock-tab ${props.drawerTab === item.id ? 'is-active' : ''}`} role="tab" aria-label={item.id} aria-selected={props.drawerTab === item.id} onClick={() => selectTab(item.id)}>{item.label}</button>)}</div><Button onClick={() => props.onSetDrawerOpen(!props.drawerOpen)} aria-label={props.drawerOpen ? 'Collapse bottom dock' : 'Expand bottom dock'}>{props.drawerOpen ? 'collapse' : 'expand'}</Button></>}>
            <div className="rh-dock-body"><div className="rh-dock-content">{props.drawerTab === 'console' && <ConsolePanel key={props.activeFileId ?? 'none'} fileId={props.activeFileId} />}{props.drawerTab === 'inspector' && <InspectorPanel key={props.activeFileId ?? 'none'} fileId={props.activeFileId} />}{props.drawerTab === 'analysis' && <AnalysisPanel code={props.activeFile?.content ?? ''} selection={selection} lang={props.activeFile?.language === 'typescript' ? 'ts' : 'js'} onLoadDemo={props.onLoadAnalysisDemo} />}{props.drawerTab === 'packages' && <PackagesPanel />}{props.drawerTab === 'runtimes' && <RuntimesPanel />}</div></div>
            </InstrumentFrame>
          </>}
          <footer className="rh-statusbar">
            <StatusIndicator status={statusKind} label={props.phase === 'idle' ? (props.lastExit ? `exit ${props.lastExit.code ?? '—'} · ${props.lastExit.durationMs}ms` : 'ready') : props.phase} />
            <span className="rh-status-source" title={props.activeFile?.relPath ?? 'No source open'}>source {props.activeFile?.relPath ?? '—'}</span>
            <span className="rh-status-separator">/</span>
            <button className="rh-status-action" onClick={() => { props.onSetDrawerTab('runtimes'); props.onSetDrawerOpen(true); }} aria-label="Open runtime selector">runtime {activeRuntimeLabel.toUpperCase()} {props.runtimeVersion ? `v${props.runtimeVersion}` : 'version —'}</button>
            <button className={`rh-status-action ${props.autoRun ? 'is-active' : ''}`} onClick={() => props.onSetAutoRun(!props.autoRun)} aria-pressed={props.autoRun}>auto-run {props.autoRun ? 'on' : 'off'}</button>
            <span className="rh-status-types">types {props.ataStatus === 'ready' ? 'ready' : props.ataStatus === 'loading' ? 'loading' : 'offline'}</span>
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
        <button type="button" role="menuitem" onClick={() => { for (const file of props.files) props.onCloseFile(file.id); setTabContextMenu(null); }}>Close all tabs</button>
      </div>}
      {tabRename && <div className="rh-tab-rename-popover" role="dialog" aria-label="Rename tab" onMouseDown={(event) => event.stopPropagation()}>
        <label><span>Rename source tab</span><input ref={renameInputRef} value={tabRename.value} onChange={(event) => setTabRename((state) => state ? { ...state, value: event.target.value } : state)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commitRename(); } }} /></label>
        <div><Button onClick={() => setTabRename(null)}>cancel</Button><Button variant="primary" onClick={commitRename}>rename</Button></div>
      </div>}
    </div>
  );
}
