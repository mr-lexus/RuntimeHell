import { useEffect, useRef, useState } from 'react';
import { exposeMonacoForTests } from './editor/monaco-setup';
import { CodeEditor } from './editor/CodeEditor';
import { createAtaController, getAtaStatus, onAtaStatus, type AtaStatus } from './editor/ata';
import { typescriptDefaults } from './editor/monaco-setup';
import { AnalysisPanel } from './panels/analysis/AnalysisPanel';
import { ConsolePanel } from './panels/console/ConsolePanel';
import { InspectorPanel } from './panels/inspector/InspectorPanel';
import { RuntimesPanel } from './panels/runtimes/RuntimesPanel';
import { PackagesPanel } from './panels/packages/PackagesPanel';
import { emitRunRequested, onRunRequested, useActiveFile, useUi, type DrawerTab } from './state/ui';
import type { SelectionInfo } from './editor/selection-service';
import { useRun } from './state/run';
import { ANALYSIS_ALL_TYPES } from './state/analysis';
import { useAnalysis } from './state/analysis';

const WORKSPACE_ID = 'default';

const DEMO_FILE = {
  id: 'default:entry.ts',
  relPath: 'entry.ts',
  language: 'typescript',
  dirty: false,
  content: `// RuntimeHell demo вЂ” Ctrl+Enter runs, Shift+Alt+F formats, Ctrl+S saves.
interface User { id: number; name: string; active: boolean }

const users: User[] = [
  { id: 1, name: 'Alex', active: true },
  { id: 2, name: 'Sam', active: false }
];

function sum(a: number, b: number): number {
  return a + b;
}

const active = users.filter((u) => u.active);
console.log('active users:', active);
sum(40, 2);
`
};

const DRAWER_TABS: DrawerTab[] = ['console', 'inspector', 'analysis', 'packages', 'runtimes'];

export function App(): React.JSX.Element {
  const files = useUi((s) => s.files);
  const activeFileId = useUi((s) => s.activeFileId);
  const drawerTab = useUi((s) => s.drawerTab);
  const drawerRatio = useUi((s) => s.drawerRatio);
  const openFile = useUi((s) => s.openFile);
  const setActive = useUi((s) => s.setActive);
  const updateContent = useUi((s) => s.updateContent);
  const markSaved = useUi((s) => s.markSaved);
  const setDrawerTab = useUi((s) => s.setDrawerTab);
  const setDrawerRatio = useUi((s) => s.setDrawerRatio);

  const phase = useRun((s) => s.phase);
  const runtimeVersion = useRun((s) => s.runtimeVersion);
  const lastExit = useRun((s) => s.lastExit);
  const autoRun = useRun((s) => s.autoRun);
  const setAutoRun = useRun((s) => s.setAutoRun);
  const scheduleAutoRun = useRun((s) => s.scheduleAutoRun);
  const requestCancel = useRun((s) => s.requestCancel);

  const activeFile = useActiveFile();
  const analysisEngines = useAnalysis((s) => s.engines);
  const analysisEngineId = useAnalysis((s) => s.engineId);
  const analyzeActions = ANALYSIS_ALL_TYPES.map((type) => {
    const caps = analysisEngines.find((e) => e.id === analysisEngineId)?.capabilities;
    const key = type as keyof typeof caps;
    const supported = typeof caps === 'object' && caps !== null ? caps[key] !== false : true;
    return { type, label: `Analyze в–ё ${type}`, supported };
  });
  const [status, setStatus] = useState<string>('ready');
  const splitRef = useRef<HTMLDivElement | null>(null);
  const lastSelectionRef = useRef<SelectionInfo | null>(null);

  useEffect(() => {
    exposeMonacoForTests();
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
      const settings = (await window.api?.settingsGet()) as
        | { prefs: { timeoutMs: number; autorun: boolean }; session: { tabs: { workspaceId: string; relPath: string }[]; activeRelPath: string | null } }
        | undefined;
      if (disposed) return;
      if (settings !== undefined) {
        useRun.getState().setTimeoutMs(settings.prefs.timeoutMs);
        useRun.getState().setAutoRun(settings.prefs.autorun);
        for (const tab of settings.session.tabs) {
          const read = (await window.api?.readFile({ workspaceId: tab.workspaceId, relPath: tab.relPath })) as
            | { ok: boolean; content?: string }
            | undefined;
          const content = read?.ok === true && typeof read.content === 'string' ? read.content : '';
          const language = tab.relPath.endsWith('.ts') ? 'typescript' : tab.relPath.endsWith('.tsx') ? 'typescript' : 'javascript';
          openFile({ id: `${tab.workspaceId}:${tab.relPath}`, relPath: tab.relPath, language, content, dirty: false });
        }
        if (settings.session.activeRelPath !== null) {
          const match = useUi.getState().files.find((f) => f.relPath === settings.session.activeRelPath);
          if (match !== undefined) useUi.getState().setActive(match.id);
        }
      }
      if (!disposed && useUi.getState().files.length === 0) openFile(DEMO_FILE);
    })();
    // Real executor wiring (todo 11): Ctrl+Enter and toolbar both funnel into
    // the run store; streamed events update it via the preload bridge.
    const offRun = onRunRequested(() => void useRun.getState().requestStart());
    const offEvents = window.api?.onRunEvent((event) => useRun.getState().handleEvent(event));
    const offAnalysis = window.api?.onAnalysisEvent((event) => useAnalysis.getState().handleEvent(event));
    return () => {
      disposed = true;
      offRun();
      offEvents?.();
      offAnalysis?.();
    };
  }, [openFile]);

  // ATA (todo 14): debounced type acquisition for imports + status chip.
  const ataRef = useRef<ReturnType<typeof createAtaController> | null>(null);
  const [ataStatus, setAtaStatus] = useState<AtaStatus>(getAtaStatus());
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
          activeRelPath: useUi.getState().activeFileId !== null ? (useActiveFile()?.relPath ?? null) : null
        }
      });
    }, 500);
  }, [files, activeFile, markSaved]);

  const onSave = (content: string): void => {
    const file = activeFile;
    if (!file) return;
    void window.api
      .saveFile({ workspaceId: WORKSPACE_ID, relPath: file.relPath, content })
      .then(() => {
        markSaved(file.id);
        setStatus(`saved ${file.relPath}`);
      })
      .catch((err: unknown) => setStatus(`save failed: ${String(err)}`));
  };

  const startDrag = (e: React.MouseEvent): void => {
    e.preventDefault();
    const container = splitRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const move = (ev: MouseEvent): void => {
      const ratio = 1 - (ev.clientY - rect.top) / rect.height;
      setDrawerRatio(Math.min(0.85, Math.max(0.08, ratio)));
    };
    const up = (): void => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const badge = [
    phase === 'idle' ? (runtimeVersion !== null ? `node v${runtimeVersion}` : 'ready') : phase,
    lastExit !== null
      ? `exit ${lastExit.code ?? 'вЂ”'} В· ${lastExit.durationMs}ms${lastExit.killedBy !== null ? ` В· ${lastExit.killedBy}` : ''}`
      : null
  ]
    .filter(Boolean)
    .join(' В· ');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', fontSize: 13 }}>
      {/* tab bar */}
      <div style={{ display: 'flex', gap: 2, background: '#1e1e1e', padding: '4px 6px' }}>
        {files.map((f) => (
          <button
            key={f.id}
            onClick={() => setActive(f.id)}
            style={{
              background: f.id === activeFileId ? '#333' : 'transparent',
              color: '#ddd',
              border: 'none',
              padding: '4px 10px',
              cursor: 'pointer'
            }}
          >
            {f.relPath}
            {f.dirty ? ' вЂў' : ''}
          </button>
        ))}
        <span style={{ marginLeft: 'auto', color: '#888', alignSelf: 'center', display: 'flex', gap: 10 }}>
          {ataStatus === 'loading' && <span>typesвЂ¦</span>}
          {ataStatus === 'ready' && <span style={{ color: '#6a9955' }}>types ready</span>}
          {ataStatus === 'offline' && <span style={{ color: '#dcdcaa' }}>types unavailable (offline)</span>}
          {badge || status}
        </span>
      </div>

      {/* editor / drawer split */}
      <div ref={splitRef} style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ flex: `${1 - drawerRatio} 1 0`, minHeight: 0 }}>
          {activeFile ? (
            <CodeEditor
              path={activeFile.relPath}
              value={activeFile.content}
              language={activeFile.language}
              onChange={(v) => {
                updateContent(activeFile.id, v);
                scheduleAutoRun();
                scheduleAta(v);
              }}
              onSave={onSave}
              onRun={() => emitRunRequested()}
              onFormatError={(m) => setStatus(`format error: ${m}`)}
              onSelectionChanged={(info) => {
                lastSelectionRef.current = info;
              }}
              analyzeActions={analyzeActions}
              onAnalyze={(type, _code, info) => {
                const lang = activeFile?.language === 'typescript' ? 'ts' : 'js';
                useAnalysis.getState().requestFromSelection(info ?? null, activeFile?.content ?? '', [type], false, lang);
                setDrawerTab('analysis');
              }}
            />
          ) : (
            <div style={{ color: '#888', padding: 20 }}>No file open</div>
          )}
        </div>
        <div onMouseDown={startDrag} style={{ height: 4, cursor: 'row-resize', background: '#444' }} />
        <div style={{ flex: `${drawerRatio} 1 0`, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ display: 'flex', gap: 2, background: '#181818', padding: '3px 6px', alignItems: 'center' }}>
            {DRAWER_TABS.map((tab) => (
              <button
                key={tab}
                onClick={() => setDrawerTab(tab)}
                style={{
                  background: tab === drawerTab ? '#333' : 'transparent',
                  color: '#ccc',
                  border: 'none',
                  padding: '3px 10px',
                  cursor: 'pointer'
                }}
              >
                {tab}
              </button>
            ))}
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
              <label style={{ color: '#999', fontSize: 11, display: 'flex', gap: 4, alignItems: 'center' }}>
                <input type="checkbox" checked={autoRun} onChange={(e) => setAutoRun(e.target.checked)} /> auto-run
              </label>
              <button
                onClick={() => void requestCancel()}
                disabled={phase === 'idle'}
                style={{
                  background: phase === 'cancelling' ? '#5a1d1d' : '#444',
                  color: phase === 'idle' ? '#666' : '#f48771',
                  border: 'none',
                  padding: '2px 10px',
                  cursor: phase === 'idle' ? 'default' : 'pointer',
                  fontSize: 11
                }}
              >
                Cancel
              </button>
            </span>
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: 8, color: '#bbb', minHeight: 0 }}>
            {drawerTab === 'console' && <ConsolePanel />}
            {drawerTab === 'inspector' && <InspectorPanel />}
            {drawerTab === 'analysis' && (
              <AnalysisPanel
                code={activeFile?.content ?? ''}
                selection={lastSelectionRef.current}
                lang={activeFile?.language === 'typescript' ? 'ts' : 'js'}
              />
            )}
            {drawerTab === 'packages' && <PackagesPanel />}
            {drawerTab === 'runtimes' && <RuntimesPanel />}
          </div>
        </div>
      </div>
    </div>
  );
}
