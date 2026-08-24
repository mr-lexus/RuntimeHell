import { useEffect } from 'react';
import { useRuntimes } from '../../state/runtimes';
import { useRun } from '../../state/run';

const ROW: React.CSSProperties = {
  display: 'flex',
  gap: 10,
  alignItems: 'center',
  padding: '4px 0',
  borderBottom: '1px solid #2a2a2a',
  fontFamily: 'monospace',
  fontSize: 12
};
const BTN: React.CSSProperties = {
  background: '#2a2a2a',
  color: '#ccc',
  border: 'none',
  padding: '2px 8px',
  cursor: 'pointer',
  fontSize: 11
};

function pct(received: number, total: number | null): string {
  if (total === null || total === 0) return `${(received / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.round((received / total) * 100)}%`;
}

/**
 * Runtimes panel (plan todo 12). Resolution order displayed here is enforced
 * by runtimes/runtime-resolver.ts in the main process:
 *   managed selected version → system installation → offer managed download.
 */
export function RuntimesPanel(): React.JSX.Element {
  const state = useRuntimes();
  const runPhase = useRun((s) => s.phase);
  const runtimeVersion = useRun((s) => s.runtimeVersion);

  useEffect(() => {
    void state.refresh();
    const off = state.bindEvents();
    return () => off?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const installedVersions = new Set(state.installed.filter((e) => e.installedPath !== undefined).map((e) => e.version));

  return (
    <div style={{ fontSize: 12, color: '#bbb' }}>
      <div style={{ color: '#888', marginBottom: 8 }}>
        Resolution order: managed selected version → system installation → offer download. Node pairs with the V8
        engine for analysis.
      </div>

      {state.notice !== null && <div style={{ color: '#f48771', marginBottom: 6 }}>{state.notice}</div>}
      {state.availableError !== null && (
        <div style={{ color: '#dcdcaa', marginBottom: 6 }}>index unavailable: {state.availableError}</div>
      )}

      <div style={ROW}>
        <strong style={{ width: 90 }}>System</strong>
        {state.system ? (
          <span>
            node v{state.system.version} — {state.system.exePath}
          </span>
        ) : (
          <span style={{ color: '#dcdcaa' }}>not detected</span>
        )}
      </div>

      <div style={{ marginTop: 10, marginBottom: 4, color: '#888' }}>Managed installs</div>
      {state.installed.filter((e) => e.installedPath !== undefined).length === 0 && (
        <div style={{ color: '#777' }}>none yet — install a pinned LTS below</div>
      )}
      {state.installed
        .filter((e) => e.installedPath !== undefined)
        .map((e) => (
          <div key={e.version} style={ROW}>
            <input
              type="radio"
              name="selected-runtime"
              checked={state.selectedVersion === e.version}
              onChange={() => state.select(e.version)}
            />
            <strong style={{ width: 90 }}>{e.version}</strong>
            <span style={{ color: '#666', flex: 1 }}>{e.installedPath}</span>
            {runtimeVersion === e.version && runPhase === 'running' && (
              <span style={{ color: '#dcdcaa' }}>in use — removal blocked</span>
            )}
            <button
              style={BTN}
              disabled={runPhase === 'running'}
              title={runPhase === 'running' ? 'cannot remove while a run is active' : `remove ${e.version}`}
              onClick={() => void state.remove(e.version)}
            >
              remove
            </button>
          </div>
        ))}

      <div style={{ marginTop: 10, marginBottom: 4, color: '#888' }}>Available (nodejs.org)</div>
      {state.available.map((row) => {
        const installing = state.progress?.version === row.version;
        return (
          <div key={row.version} style={ROW}>
            <span style={{ width: 90 }}>
              v{row.version} {row.lts ? <span style={{ color: '#569cd6' }}>LTS</span> : ''}
            </span>
            <span style={{ color: '#666', flex: 1 }}>{row.date}</span>
            {installedVersions.has(row.version) ? (
              <span style={{ color: '#6a9955' }}>installed</span>
            ) : installing ? (
              <span style={{ color: '#dcdcaa' }}>{pct(state.progress?.receivedBytes ?? 0, state.progress?.totalBytes ?? null)}</span>
            ) : (
              <button style={BTN} disabled={state.progress !== null} onClick={() => void state.install(row.version)}>
                install
              </button>
            )}
          </div>
        );
      })}
      {!state.loading && state.available.length === 0 && state.availableError === null && (
        <div style={{ color: '#777' }}>no versions listed</div>
      )}
    </div>
  );
}
