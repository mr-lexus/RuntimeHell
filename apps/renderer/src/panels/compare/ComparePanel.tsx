import { useEffect, useState } from 'react';
import { useCompare, terminologyFor } from '../../state/compare';
import { BlockLoader } from '../../ui/primitives';

const BTN: React.CSSProperties = {
  background: '#2a2a2a',
  color: '#ccc',
  border: 'none',
  padding: '3px 10px',
  cursor: 'pointer',
  fontSize: 11
};

export function ComparePanel({ code }: { code: string }): React.JSX.Element {
  const entries = useCompare((s) => s.entries);
  const running = useCompare((s) => s.running);
  const selectedEngines = useCompare((s) => s.selectedEngines);
  const toggleEngine = useCompare((s) => s.toggleEngine);
  const startCompare = useCompare((s) => s.startCompare);
  const exportMd = useCompare((s) => s.exportMarkdown);
  const [showExport, setShowExport] = useState(false);

  useEffect(() => {
    if (selectedEngines.length > 0 && entries.length !== selectedEngines.length) {
      useCompare.setState({
        entries: selectedEngines.map((id) => ({
          engineId: id,
          version: null,
          status: 'idle' as const,
          reason: null,
          rawOutput: ''
        }))
      });
    }
  }, [selectedEngines]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: '#bbb' }}>
      <div style={{ color: '#888' }}>
        Select ≥2 engines to compare bytecode side-by-side. Each engine's native terminology is preserved.
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        {['v8', 'spidermonkey', 'javascriptcore'].map((id) => (
          <label key={id} style={{ display: 'flex', gap: 3, alignItems: 'center', cursor: 'pointer', fontSize: 11 }}>
            <input
              className="rh-native-checkbox"
              type="checkbox"
              checked={selectedEngines.includes(id)}
              onChange={() => toggleEngine(id)}
            />
            {terminologyFor(id).displayName}
          </label>
        ))}
        <button
          onClick={() => void startCompare(code)}
          disabled={running || selectedEngines.length < 2}
          style={BTN}
        >
          {running ? <><BlockLoader /> comparing…</> : 'compare'}
        </button>
        <button onClick={() => setShowExport(!showExport)} style={BTN}>
          export md
        </button>
      </div>
      {showExport && (
        <pre
          style={{
            background: '#111',
            border: '1px solid #222',
            padding: 4,
            maxHeight: 200,
            overflow: 'auto',
            fontSize: 11,
            whiteSpace: 'pre-wrap',
            color: '#aaa'
          }}
        >
          {exportMd()}
        </pre>
      )}
      {entries.map((entry) => {
        const term = terminologyFor(entry.engineId);
        return (
          <div key={entry.engineId} style={{ border: '1px solid #333', padding: 6 }}>
            <div style={{ color: 'var(--accent-strong)', fontWeight: 'bold', marginBottom: 4 }}>
              {term.displayName} {entry.version !== null ? `(${entry.version})` : ''}
              {entry.status === 'unsupported' && <span style={{ color: '#f48771' }}> — unsupported</span>}
              {entry.reason !== null && <span style={{ color: '#888', marginLeft: 6 }}>{entry.reason}</span>}
            </div>
            {entry.rawOutput !== '' && (
              <pre
                style={{
                  margin: 0,
                  background: '#111',
                  padding: 4,
                  overflow: 'auto',
                  maxHeight: 200,
                  fontSize: 11,
                  whiteSpace: 'pre-wrap',
                  color: '#ccc'
                }}
              >
                {entry.rawOutput.slice(0, 3000)}
              </pre>
            )}
            {entry.status === 'running' && <div style={{ color: '#dcdcaa' }}><BlockLoader label="analyzing" /></div>}
            {entry.status === 'error' && entry.reason !== null && (
              <div style={{ color: '#f48771' }}>{entry.reason}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
