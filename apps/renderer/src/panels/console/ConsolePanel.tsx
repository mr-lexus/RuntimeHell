import { useEffect, useRef, useState } from 'react';
import { useRun } from '../../state/run';

interface HistoryRow {
  runId: string;
  finishedAt: string;
  status: string;
  durationMs: number;
  killedBy: string | null;
}

/**
 * Console panel (plan todo 11/21): merged stdout/stderr with error styling,
 * plus the persisted per-workspace run history ring.
 */
export function ConsolePanel(): React.JSX.Element {
  const lines = useRun((s) => s.lines);
  const notice = useRun((s) => s.notice);
  const clearConsole = useRun((s) => s.clearConsole);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [lines.length]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const response = (await window.api?.historyList('default')) as
        | { ok: boolean; records: HistoryRow[] }
        | undefined;
      if (!cancelled && response?.ok === true) setHistory(response.records.slice().reverse());
    })();
    return () => {
      cancelled = true;
    };
  }, [lines.length]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, paddingBottom: 4 }}>
        {notice !== null && <span style={{ color: '#dcdcaa' }}>{notice}</span>}
        <button onClick={() => setShowHistory((v) => !v)} style={btnStyle}>
          history ({history.length})
        </button>
        <button onClick={clearConsole} style={btnStyle}>
          clear
        </button>
      </div>
      {showHistory && (
        <div style={{ maxHeight: 120, overflow: 'auto', borderBottom: '1px solid #222', marginBottom: 4 }}>
          {history.length === 0 && <div style={{ color: '#777' }}>no runs yet</div>}
          {history.map((h) => (
            <div key={h.runId} style={{ fontFamily: 'monospace', fontSize: 11, color: '#888' }}>
              {new Date(h.finishedAt).toLocaleTimeString()} · {h.status} · {h.durationMs}ms
              {h.killedBy !== null ? ` · ${h.killedBy}` : ''}
            </div>
          ))}
        </div>
      )}
      <div style={{ flex: 1, overflow: 'auto', fontFamily: 'monospace', fontSize: 12, lineHeight: '17px' }}>
        {lines.map((line) => (
          <div key={line.seq} style={{ whiteSpace: 'pre-wrap', color: line.stream === 'stderr' ? '#f48771' : '#cccccc' }}>
            {line.text}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  background: '#2a2a2a',
  color: '#ccc',
  border: 'none',
  padding: '2px 8px',
  cursor: 'pointer',
  fontSize: 11
};
