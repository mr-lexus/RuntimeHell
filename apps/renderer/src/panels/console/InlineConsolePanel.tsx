import { useState } from 'react';
import { useRun } from '../../state/run';
import type { SerializedValue } from '@rh/protocol';

function formatValue(v: { t: string; prim?: string; label?: string }): string {
  if (v.t === 'string') return JSON.stringify(v.prim ?? '');
  if (['number', 'boolean', 'null', 'undefined', 'bigint'].includes(v.t)) return v.prim ?? v.t;
  if (v.label) return v.label + (v.prim ? ` ${v.prim}` : '');
  return v.prim ?? v.t;
}

/** Recursive inspector node: click to expand one level of children. */
function ValueNode({ node, depth }: { node: SerializedValue; depth: number }): React.JSX.Element {
  const [open, setOpen] = useState(depth < 1);
  const kids = node.children ?? [];
  const hasKids = kids.length > 0;
  return (
    <div>
      <div
        onClick={() => hasKids && setOpen((o) => !o)}
        style={{
          cursor: hasKids ? 'pointer' : 'default',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          color: depth === 0 ? 'var(--result)' : 'var(--text)',
          padding: '1px 0'
        }}
      >
        {hasKids ? (open ? '⌄ ' : '› ') : ''}
        {formatValue(node)}
        {hasKids && !open ? ` (${kids.length})` : ''}
      </div>
      {open &&
        kids.map((k, i) => (
          <div key={`${k.k}-${i}`} style={{ paddingLeft: 14, borderLeft: '1px solid var(--border)', marginLeft: 4 }}>
            <span style={{ color: 'var(--text-dim)' }}>{k.k}: </span>
            <ValueNode node={k.node} depth={depth + 1} />
          </div>
        ))}
    </div>
  );
}

export function InlineConsolePanel({ inspector = false }: { inspector?: boolean }): React.JSX.Element {
  const inlineByLine = useRun((s) => s.inlineByLine);
  const resultByLine = useRun((s) => s.resultByLine);
  const phase = useRun((s) => s.phase);

  const allLines = Array.from(new Set([...Object.keys(inlineByLine).map(Number), ...Object.keys(resultByLine).map(Number)]))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);

  if (allLines.length === 0) {
    return (
      <div style={{ padding: 12, color: 'var(--text-dim)', fontSize: 12, fontFamily: "'JetBrainsMono Nerd Font Mono', monospace" }}>
        {phase === 'running' ? 'running…' : 'No output yet — run the file (Ctrl+Enter)'}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0, fontFamily: "'JetBrainsMono Nerd Font Mono', monospace", fontSize: 12, color: 'var(--text)' }}>
      {allLines.map((line) => {
        const consoleItems = inlineByLine[line] ?? [];
        const resultVal = (resultByLine as Record<number, SerializedValue>)[line];
        // Skip empty/undefined results that are noise
        const isMeaningfulResult = resultVal !== undefined && resultVal.t !== 'undefined';
        if (consoleItems.length === 0 && !isMeaningfulResult) return null;
        return (
          <div key={line} style={{ display: 'flex', flexDirection: 'column', borderBottom: '1px solid var(--border)', padding: '6px 8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
              <span style={{ background: 'var(--bg-chip)', color: 'var(--text-dim)', padding: '1px 6px', borderRadius: 3, fontSize: 10 }}>L{line}</span>
            </div>
            {isMeaningfulResult && (
              <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--result)', background: 'var(--bg-panel)', padding: '2px 4px', borderRadius: 2, marginBottom: 2 }}>
                → {formatValue(resultVal)}
              </div>
            )}
            {inspector && isMeaningfulResult && (
              <div style={{ padding: '2px 4px', marginBottom: 2 }}>
                <ValueNode node={resultVal} depth={0} />
              </div>
            )}
            {consoleItems.map((entry, idx) => (
              <div
                key={`c-${idx}`}
                style={{
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  color: entry.level === 'error' ? 'var(--err)' : entry.level === 'warn' ? 'var(--warn)' : 'var(--text)',
                  background: entry.level === 'error' ? 'rgba(244,135,113,0.12)' : entry.level === 'warn' ? 'rgba(220,220,170,0.12)' : 'transparent',
                  padding: '2px 4px',
                  borderRadius: 2,
                  marginBottom: 2
                }}
                title={`${entry.level} at L${entry.line}${entry.column ? `:${entry.column}` : ''}`}
              >
                ◀ {entry.text}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
