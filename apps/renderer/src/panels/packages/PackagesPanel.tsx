import { useEffect } from 'react';
import { usePackages, useDebouncedSearch } from '../../state/packages';

const ROW: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  padding: '3px 0',
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

/**
 * Packages panel (plan todo 13): registry search (debounced), per-workspace
 * install/remove, and a verbatim npm log area — failures show npm stderr
 * exactly as reported.
 */
export function PackagesPanel(): React.JSX.Element {
  const installed = usePackages((s) => s.installed);
  const results = usePackages((s) => s.results);
  const searching = usePackages((s) => s.searching);
  const busy = usePackages((s) => s.busy);
  const log = usePackages((s) => s.log);
  const query = usePackages((s) => s.query);
  const setQuery = usePackages((s) => s.setQuery);
  const refresh = usePackages((s) => s.refresh);
  const install = usePackages((s) => s.install);
  const remove = usePackages((s) => s.remove);
  const bindEvents = usePackages((s) => s.bindEvents);

  useDebouncedSearch();

  useEffect(() => {
    void refresh();
    return bindEvents?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: '#bbb', height: '100%', minHeight: 0 }}>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="search npm…"
        style={{
          background: '#111',
          color: '#ddd',
          border: '1px solid #333',
          padding: '4px 8px',
          fontFamily: 'monospace',
          fontSize: 12
        }}
      />

      <div style={{ flex: 1, overflow: 'auto', minHeight: 60 }}>
        {searching && <div style={{ color: '#888' }}>searching…</div>}
        {!searching &&
          results.map((row) => (
            <div key={row.name} style={ROW}>
              <strong style={{ color: '#9cdcfe' }}>{row.name}</strong>
              <span style={{ color: '#666' }}>v{row.version}</span>
              <span style={{ color: '#888', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {row.description}
              </span>
              {installed[row.name] !== undefined ? (
                <>
                  <span style={{ color: '#6a9955' }}>{installed[row.name]}</span>
                  <button style={BTN} disabled={busy} onClick={() => void remove(row.name)}>
                    remove
                  </button>
                </>
              ) : (
                <button style={BTN} disabled={busy} onClick={() => void install(row.name)}>
                  install
                </button>
              )}
            </div>
          ))}
      </div>

      <div>
        <div style={{ color: '#888', marginBottom: 2 }}>installed</div>
        {Object.keys(installed).length === 0 && <div style={{ color: '#777' }}>no dependencies yet</div>}
        {Object.entries(installed).map(([name, range]) => (
          <span key={name} style={{ display: 'inline-block', background: '#222', padding: '1px 6px', marginRight: 4, marginBottom: 4 }}>
            {name}@{range}
          </span>
        ))}
      </div>

      <div style={{ flex: 0.7, overflow: 'auto', background: '#111', border: '1px solid #222', padding: 4, minHeight: 40 }}>
        <div style={{ color: '#888', marginBottom: 2 }}>npm log (verbatim)</div>
        {log.map((line, i) => (
          <div key={i} style={{ fontFamily: 'monospace', fontSize: 11, whiteSpace: 'pre-wrap', color: line.startsWith('[npm err]') ? '#f48771' : '#aaa' }}>
            {line}
          </div>
        ))}
      </div>
    </div>
  );
}
