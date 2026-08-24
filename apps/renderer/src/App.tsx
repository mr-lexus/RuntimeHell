import { useEffect, useRef, useState } from 'react';
import { exposeMonacoForTests } from './editor/monaco-setup';
import { CodeEditor } from './editor/CodeEditor';
import { ConsolePanel } from './panels/console/ConsolePanel';
import { InspectorPanel } from './panels/inspector/InspectorPanel';
import { emitRunRequested, onRunRequested, useActiveFile, useUi, type DrawerTab } from './state/ui';
import { useRun } from './state/run';

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
  const [status, setStatus] = useState<string>('ready');
  const splitRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    exposeMonacoForTests();
    openFile(DEMO_FILE);
    // Real executor wiring (todo 11): Ctrl+Enter and toolbar both funnel into
    // the run store; streamed events update it via the preload bridge.
    const offRun = onRunRequested(() => void useRun.getState().requestStart());
    const offEvents = window.api?.onRunEvent((event) => useRun.getState().handleEvent(event));
    return () => {
      offRun();
      offEvents?.();
    };
  }, [openFile]);

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
      ? `exit ${lastExit.code ?? '—'} · ${lastExit.durationMs}ms${lastExit.killedBy !== null ? ` · ${lastExit.killedBy}` : ''}`
      : null
  ]
    .filter(Boolean)
    .join(' · ');

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
            {f.dirty ? ' •' : ''}
          </button>
        ))}
        <span style={{ marginLeft: 'auto', color: '#888', alignSelf: 'center' }}>{badge || status}</span>
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
              }}
              onSave={onSave}
              onRun={() => emitRunRequested()}
              onFormatError={(m) => setStatus(`format error: ${m}`)}
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
            {drawerTab === 'analysis' && <div>Engine analysis appears here (todo 19).</div>}
            {drawerTab === 'packages' && <div>Package management appears here (todo 13).</div>}
            {drawerTab === 'runtimes' && <div>Runtime versions appear here (todo 12).</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
