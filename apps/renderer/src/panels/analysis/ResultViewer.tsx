import { useMemo, useState } from 'react';
import type { AnalysisResult } from '@rh/protocol';
import { parseV8Bytecode, parseV8Deopts } from '@rh/engine-parsers';

type DrawerTab = 'raw' | 'normalized' | 'artifacts';

const MAX_ROWS = 400;

function NormalizedBytecodeTable({ raw }: { raw: string }): React.JSX.Element {
  const parsed = useMemo(() => parseV8Bytecode(raw), [raw]);
  const rows = useMemo(() => {
    const out: { fn: string; offset: number; op: string; operands: string }[] = [];
    for (const fn of parsed.functions) {
      const label = fn.name || '(top level)';
      for (const instr of fn.instructions) {
        if (out.length >= MAX_ROWS) break;
        out.push({ fn: label, offset: instr.offset, op: instr.bytecode, operands: instr.operands.join(' ') });
      }
      // Constant-pool entries surface definition names (e.g. SFI references)
      // that instruction rows alone don't show.
      for (const poolLine of fn.constantPool) {
        if (out.length >= MAX_ROWS) break;
        out.push({ fn: label, offset: -1, op: 'pool', operands: poolLine });
      }
    }
    return out;
  }, [parsed]);

  if (parsed.functions.length === 0) {
    return <div style={{ color: '#dcdcaa' }}>No normalized rows — raw output is authoritative.</div>;
  }

  return (
    <div>
      <div style={{ background: '#3a3325', color: '#dcdcaa', padding: '2px 6px', marginBottom: 4 }}>
        best-effort normalization — raw output is authoritative
      </div>
      <table style={{ fontFamily: 'monospace', fontSize: 11, borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr style={{ color: '#888', textAlign: 'left' }}>
            <th style={{ width: 130 }}>function</th>
            <th style={{ width: 50 }}>off</th>
            <th style={{ width: 170 }}>opcode</th>
            <th>operands</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderBottom: '1px solid #222' }}>
              <td style={{ color: '#9cdcfe' }}>{r.fn}</td>
              <td>{r.offset}</td>
              <td style={{ color: '#c586c0' }}>{r.op}</td>
              <td style={{ color: '#aaa' }}>{r.operands}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length >= MAX_ROWS && <div style={{ color: '#777' }}>… truncated at {MAX_ROWS} rows</div>}
    </div>
  );
}

function NormalizedDeoptTable({ raw }: { raw: string }): React.JSX.Element {
  const deopts = useMemo(() => parseV8Deopts(raw), [raw]);
  if (deopts.length === 0) {
    return <div style={{ color: '#dcdcaa' }}>No deopt events parsed — raw output is authoritative.</div>;
  }
  return (
    <table style={{ fontFamily: 'monospace', fontSize: 11, borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ color: '#888', textAlign: 'left' }}>
          <th>function</th>
          <th>kind</th>
          <th>reason</th>
          <th>bytecode offset</th>
        </tr>
      </thead>
      <tbody>
        {deopts.map((d, i) => (
          <tr key={i}>
            <td style={{ color: '#9cdcfe' }}>{d.functionName ?? '?'}</td>
            <td>{d.kind}</td>
            <td style={{ color: '#f48771' }}>{d.reason}</td>
            <td>{d.bytecodeOffset}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Per-type result viewer (plan todo 19): Raw verbatim first-class,
 * best-effort normalized tables, artifact listing.
 */
export function ResultViewer({ result }: { result: AnalysisResult }): React.JSX.Element {
  const [tab, setTab] = useState<DrawerTab>('raw');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minHeight: 0 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {(['raw', 'normalized', 'artifacts'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              background: tab === t ? '#333' : 'transparent',
              color: '#ccc',
              border: 'none',
              padding: '1px 8px',
              cursor: 'pointer',
              fontSize: 11
            }}
          >
            {t}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        {result.artifacts.length > 0 && <span style={{ color: '#569cd6', fontSize: 11 }}>{result.artifacts.length} artifact(s)</span>}
      </div>

      {tab === 'raw' && (
        <pre
          style={{
            margin: 0,
            background: '#111',
            padding: 6,
            overflow: 'auto',
            maxHeight: 260,
            fontSize: 11,
            lineHeight: '15px',
            whiteSpace: 'pre-wrap',
            color: '#ccc'
          }}
        >
          {result.rawOutput}
        </pre>
      )}
      {tab === 'normalized' &&
        (result.analysisType === 'bytecode' ? (
          <NormalizedBytecodeTable raw={result.rawOutput} />
        ) : result.analysisType === 'deopts' ? (
          <NormalizedDeoptTable raw={result.rawOutput} />
        ) : (
          <div style={{ color: '#777' }}>no normalizer for '{result.analysisType}' yet</div>
        ))}
      {tab === 'artifacts' && (
        <div style={{ fontFamily: 'monospace', fontSize: 11 }}>
          {result.artifacts.length === 0 && <span style={{ color: '#777' }}>none</span>}
          {result.artifacts.map((a) => (
            <div key={a.path}>
              {a.name} — <span style={{ color: '#666' }}>{a.path}</span>
            </div>
          ))}
        </div>
      )}
      <button
        onClick={() => void navigator.clipboard.writeText(result.rawOutput)}
        style={{
          alignSelf: 'flex-end',
          background: '#2a2a2a',
          color: '#ccc',
          border: 'none',
          padding: '2px 8px',
          cursor: 'pointer',
          fontSize: 11
        }}
      >
        copy raw
      </button>
    </div>
  );
}
