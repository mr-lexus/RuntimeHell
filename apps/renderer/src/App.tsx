import { useEffect, useRef, useState } from 'react';
import { exposeMonacoForTests, setRhTheme, type RhTheme } from './editor/monaco-setup';
import { CodeEditor } from './editor/CodeEditor';
import { createAtaController, getAtaStatus, onAtaStatus, type AtaStatus } from './editor/ata';
import { typescriptDefaults } from './editor/monaco-setup';
import { AnalysisPanel } from './panels/analysis/AnalysisPanel';
import { ConsolePanel } from './panels/console/ConsolePanel';
import { LineOutputColumn, LINE_HEIGHT_PX } from './panels/console/LineOutputColumn';
import { InspectorPanel } from './panels/inspector/InspectorPanel';
import { RuntimesPanel } from './panels/runtimes/RuntimesPanel';
import { PackagesPanel } from './panels/packages/PackagesPanel';
import { emitRunRequested, getActiveFile, onRunRequested, useActiveFile, useUi, type DrawerTab } from './state/ui';
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
  content: `// RuntimeHell demo — Ctrl+Enter runs, Shift+Alt+F formats, Ctrl+S saves.
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
  const closeFile = useUi((s) => s.closeFile);
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
  const lang = useRun((s) => s.lang);
  const setLang = useRun((s) => s.setLang);

  const activeFile = useActiveFile();
  const analysisEngines = useAnalysis((s) => s.engines);
  const analysisEngineId = useAnalysis((s) => s.engineId);
  const analyzeActions = ANALYSIS_ALL_TYPES.map((type) => {
    const caps = analysisEngines.find((e) => e.id === analysisEngineId)?.capabilities;
    const key = type as keyof typeof caps;
    const supported = typeof caps === 'object' && caps !== null ? caps[key] !== false : true;
    return { type, label: `Analyze ▸ ${type}`, supported };
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
    const offRun = onRunRequested(() => {
      console.log('[ui] onRunRequested fired');
      void useRun.getState().requestStart().then(() => console.log('[ui] requestStart finished', useRun.getState().phase));
    });
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
  const inlineByLine = useRun((s) => s.inlineByLine);
  const resultByLine = useRun((s) => s.resultByLine);
  const [showInspector, setShowInspector] = useState<boolean>(() => localStorage.getItem('rh.inspector') !== '0');
  const [scrollTop, setScrollTop] = useState(0);
  const [lineCount, setLineCount] = useState(1);
  useEffect(() => {
    localStorage.setItem('rh.inspector', showInspector ? '1' : '0');
  }, [showInspector]);
  const [theme, setTheme] = useState<RhTheme>(() => ((localStorage.getItem('rh.theme') as RhTheme) ?? 'rh-dark'));
  useEffect(() => {
    setRhTheme(theme);
    document.documentElement.setAttribute('data-theme', theme === 'rh-light' ? 'light' : 'dark');
    localStorage.setItem('rh.theme', theme);
  }, [theme]);
  // Restore persisted lang override once on mount. After mount, the user
  // toggles it freely and the useEffect below auto-tracks file extensions.
  const langHydratedRef = useRef(false);
  useEffect(() => {
    if (langHydratedRef.current) return;
    const stored = localStorage.getItem('rh.lang');
    if (stored === 'js' || stored === 'ts') useRun.getState().setLang(stored);
    langHydratedRef.current = true;
  }, []);
  useEffect(() => {
    if (!langHydratedRef.current) return;
    localStorage.setItem('rh.lang', lang);
  }, [lang]);
  // Auto-detect lang from file extension when the active file changes. The
  // extension drives the default; the explicit toggle in the tab bar overrides.
  useEffect(() => {
    const path = activeFile?.relPath ?? '';
    const lower = path.toLowerCase();
    const detected: 'js' | 'ts' =
      lower.endsWith('.ts') || lower.endsWith('.tsx') || lower.endsWith('.mts') ? 'ts' : 'js';
    if (useRun.getState().lang !== detected) useRun.getState().setLang(detected);
    // We only want this to re-run when the active file's path changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFile?.relPath]);
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
      content: `// untitled-${n}.ts — Ctrl+Enter runs\nconsole.log('hello from tab ${n}');\n`,
      dirty: false
    });
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
      ? `exit ${lastExit.code ?? '—'} · ${lastExit.durationMs}ms${lastExit.killedBy !== null ? ` · ${lastExit.killedBy}` : ''}`
      : null
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', fontSize: 13, background: 'var(--bg-app)', color: 'var(--text)' }}>
      {/* tab bar */}
      <div style={{ display: 'flex', gap: 2, alignItems: 'center', background: 'var(--bg-bar)', padding: '4px 6px' }}>
        <button
          onClick={() => {
            console.log('[ui] Run clicked', { file: activeFile?.relPath, hasContent: !!activeFile?.content });
            emitRunRequested();
          }}
          style={{ background: 'var(--accent)', color: '#fff', border: 'none', padding: '4px 12px', cursor: 'pointer', marginRight: 8 }}
        >
          ▶ Run (Ctrl+Enter)
        </button>
        <select
          value={theme}
          onChange={(e) => setTheme(e.target.value as RhTheme)}
          style={{ background: 'var(--bg-panel)', color: 'var(--text)', border: '1px solid var(--border)', fontSize: 11, padding: '3px 6px', marginRight: 4 }}
        >
          <option value="rh-dark">🌙 dark</option>
          <option value="rh-light">☀️ light</option>
        </select>
        <button
          onClick={() => setShowInspector((v) => !v)}
          title="Toggle inspector tree in inline panel"
          style={{
            background: showInspector ? 'var(--bg-chip)' : 'transparent',
            color: showInspector ? 'var(--text)' : 'var(--text-dim)',
            border: '1px solid var(--border)',
            padding: '3px 8px',
            cursor: 'pointer',
            fontSize: 11,
            marginRight: 8
          }}
        >
          🔍 inspector {showInspector ? 'on' : 'off'}
        </button>
        <span
          title="Force JS passthrough (Node 22+ strips types) or TS transpile via esbuild"
          style={{
            display: 'inline-flex',
            border: '1px solid var(--border)',
            borderRadius: 3,
            overflow: 'hidden',
            marginRight: 8,
            fontSize: 11
          }}
        >
          {(['js', 'ts'] as const).map((opt) => {
            const active = lang === opt;
            return (
              <button
                key={opt}
                onClick={() => setLang(opt)}
                aria-pressed={active}
                style={{
                  background: active ? 'var(--result)' : 'transparent',
                  color: active ? 'var(--bg-app)' : 'var(--text-dim)',
                  border: 'none',
                  padding: '3px 8px',
                  cursor: 'pointer',
                  fontWeight: active ? 600 : 400,
                  fontSize: 11,
                  letterSpacing: 0.5
                }}
              >
                {opt.toUpperCase()}
              </button>
            );
          })}
        </span>
        {files.map((f) => (
          <span
            key={f.id}
            onClick={() => setActive(f.id)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              background: f.id === activeFileId ? 'var(--bg-chip)' : 'transparent',
              color: 'var(--text)',
              padding: '4px 6px 4px 10px',
              cursor: 'pointer',
              borderRadius: 3,
              userSelect: 'none'
            }}
          >
            {f.relPath}
            {f.dirty ? ' •' : ''}
            <button
              title="Close tab"
              onClick={(e) => {
                e.stopPropagation();
                closeFile(f.id);
              }}
              style={{ background: 'transparent', color: 'var(--text-dim)', border: 'none', cursor: 'pointer', fontSize: 11, lineHeight: 1, padding: '0 2px' }}
              onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--err)')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-dim)')}
            >
              ✕
            </button>
          </span>
        ))}
        <button
          title="New tab"
          onClick={createTab}
          style={{ background: 'transparent', color: 'var(--text-dim)', border: '1px dashed var(--border)', borderRadius: 3, cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: '2px 8px', marginLeft: 2 }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-dim)')}
        >
          +
        </button>
        <span style={{ marginLeft: 'auto', color: 'var(--text-dim)', alignSelf: 'center', display: 'flex', gap: 10 }}>
          {ataStatus === 'loading' && <span>types…</span>}
          {ataStatus === 'ready' && <span style={{ color: 'var(--ok)' }}>types ready</span>}
          {ataStatus === 'offline' && <span style={{ color: 'var(--warn)' }}>types unavailable (offline)</span>}
          {badge || status}
        </span>
      </div>

      {/* editor / drawer split */}
      <div ref={splitRef} style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ flex: `${1 - drawerRatio} 1 0`, minHeight: 0, display: 'flex' }}>
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
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
                onScrollTop={setScrollTop}
                onLineCount={setLineCount}
                analyzeActions={analyzeActions}
                inlineOutputs={inlineByLine}
                inlineResults={resultByLine}
                onAnalyze={(type, _code, info) => {
                  const lang = activeFile?.language === 'typescript' ? 'ts' : 'js';
                  useAnalysis.getState().requestFromSelection(info ?? null, activeFile?.content ?? '', [type], false, lang);
                  setDrawerTab('analysis');
                }}
              />
            ) : (
              <div style={{ color: 'var(--text-dim)', padding: 20 }}>No file open</div>
            )}
          </div>
          {activeFile && (
            <LineOutputColumn
              lineCount={lineCount}
              scrollTop={scrollTop}
              allowExpand={showInspector}
            />
          )}
        </div>
        <div onMouseDown={startDrag} style={{ height: 4, cursor: 'row-resize', background: 'var(--border)' }} />
        <div style={{ flex: `${drawerRatio} 1 0`, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ display: 'flex', gap: 2, background: 'var(--bg-bar)', padding: '3px 6px', alignItems: 'center' }}>
            {DRAWER_TABS.map((tab) => (
              <button
                key={tab}
                onClick={() => setDrawerTab(tab)}
                style={{
                  background: tab === drawerTab ? 'var(--bg-chip)' : 'transparent',
                  color: 'var(--text)',
                  border: 'none',
                  padding: '3px 10px',
                  cursor: 'pointer'
                }}
              >
                {tab}
              </button>
            ))}
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
              <label style={{ color: 'var(--text-dim)', fontSize: 11, display: 'flex', gap: 4, alignItems: 'center' }}>
                <input type="checkbox" checked={autoRun} onChange={(e) => setAutoRun(e.target.checked)} /> auto-run
              </label>
              <button
                onClick={() => void requestCancel()}
                disabled={phase === 'idle'}
                style={{
                  background: phase === 'cancelling' ? '#5a1d1d' : 'var(--bg-hover)',
                  color: phase === 'idle' ? 'var(--text-faint)' : 'var(--err)',
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
          <div style={{ flex: 1, overflow: 'auto', padding: 8, color: 'var(--text)', minHeight: 0 }}>
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
