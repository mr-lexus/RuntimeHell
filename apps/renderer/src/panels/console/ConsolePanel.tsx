import { useEffect, useRef } from 'react';
import { useRun } from '../../state/run';

/**
 * Console panel (plan todo 11): merged stdout/stderr with error styling.
 * stderr lines render red; runner errors arrive on stderr already prefixed
 * `[runner error]`.
 */
export function ConsolePanel(): React.JSX.Element {
  const lines = useRun((s) => s.lines);
  const notice = useRun((s) => s.notice);
  const clearConsole = useRun((s) => s.clearConsole);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [lines.length]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, paddingBottom: 4 }}>
        {notice !== null && <span style={{ color: '#dcdcaa' }}>{notice}</span>}
        <button onClick={clearConsole} style={btnStyle}>
          clear
        </button>
      </div>
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
