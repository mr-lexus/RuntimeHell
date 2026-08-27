import { useMemo, useState } from 'react';
import type { AnalysisResult } from '@rh/protocol';
import { parseV8Bytecode, parseV8Deopts } from '@rh/engine-parsers';

type DrawerTab = 'normalized' | 'raw' | 'artifacts';

const MAX_ROWS = 400;

function NormalizedBytecodeTable({ raw, focus }: { raw: string; focus?: string | null }): React.JSX.Element {
  const parsed = useMemo(() => parseV8Bytecode(raw), [raw]);
  const [showAll, setShowAll] = useState(false);
  const focusActive = focus !== undefined && focus !== null && focus !== '' && !showAll;
  const focusedFunctions = focusActive ? parsed.functions.filter((fn) => fn.name === focus) : [];
  const visible = focusActive && focusedFunctions.length > 0 ? focusedFunctions : parsed.functions;
  const rows = useMemo(() => {
    const out: { fn: string; offset: number; op: string; operands: string }[] = [];
    for (const fn of visible) {
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
  }, [visible]);

  if (parsed.functions.length === 0) {
    return <div style={{ color: '#dcdcaa' }}>No normalized rows — raw output is authoritative.</div>;
  }

  return (
    <div>
      <div style={{ background: '#3a3325', color: '#dcdcaa', padding: '2px 6px', marginBottom: 4 }}>
        best-effort normalization — raw output is authoritative
      </div>
      {focusActive && focusedFunctions.length > 0 && (
        <div style={{ background: '#1e3a2a', color: '#6a9955', padding: '2px 6px', marginBottom: 4 }}>
          showing bytecode for: <strong>{focus}</strong> ({focusedFunctions.length} block(s)){' '}
          <button
            onClick={() => setShowAll(true)}
            style={{ background: 'transparent', color: '#6a9955', border: 'none', cursor: 'pointer', fontSize: 11 }}
          >
            show all functions
          </button>
        </div>
      )}
      {focusActive && focusedFunctions.length === 0 && (
        <div style={{ background: '#3a3325', color: '#dcdcaa', padding: '2px 6px', marginBottom: 4 }}>
          no bytecode block named '<strong>{focus}</strong>' — showing all functions
        </div>
      )}
      <table style={{ fontFamily: "'JetBrainsMono Nerd Font Mono', monospace", fontSize: 11, borderCollapse: 'collapse', width: '100%' }}>
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
    <table style={{ fontFamily: "'JetBrainsMono Nerd Font Mono', monospace", fontSize: 11, borderCollapse: 'collapse' }}>
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

/** Collapsible AST node for the normalized tree view. */
function AstNode({ name, node, depth }: { name: string; node: unknown; depth: number }): React.JSX.Element {
  const [open, setOpen] = useState(depth < 2);
  const isArray = Array.isArray(node);
  const isObject = node !== null && typeof node === 'object' && !isArray;
  const expandable = isArray || isObject;
  const entries = isArray
    ? (node as unknown[]).map((v, i) => [String(i), v] as const)
    : isObject
      ? Object.entries(node as Record<string, unknown>)
      : [];
  const preview = expandable
    ? isArray
      ? `Array(${(node as unknown[]).length})`
      : `{${Object.keys(node as Record<string, unknown>).slice(0, 3).join(', ')}${Object.keys(node as Record<string, unknown>).length > 3 ? ', …' : ''}}`
    : String(node ?? 'null');

  return (
    <div style={{ paddingLeft: depth > 0 ? 14 : 0 }}>
      <div
        onClick={() => expandable && setOpen((o) => !o)}
        style={{ cursor: expandable ? 'pointer' : 'default', display: 'flex', alignItems: 'center', gap: 4, lineHeight: '18px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
      >
        <span style={{ color: '#666', width: 12, textAlign: 'center', fontSize: 10, userSelect: 'none', flexShrink: 0 }}>
          {expandable ? (open ? '\uf078' : '\uf054') : ''}
        </span>
        <span style={{ color: '#9cdcfe', fontSize: 11, fontFamily: "'JetBrainsMono Nerd Font Mono', monospace" }}>{name}</span>
        {!open && <span style={{ color: '#666', fontSize: 10 }}>: </span>}
        {!open && <span style={{ color: isArray ? '#888' : '#ce9178', fontSize: 11, fontFamily: "'JetBrainsMono Nerd Font Mono', monospace" }}>{preview}</span>}
      </div>
      {open && expandable && (
        <div style={{ borderLeft: '1px solid #333', marginLeft: 5 }}>
          {entries.map(([k, v]) => (
            <AstNode key={k} name={k} node={v} depth={depth + 1} />
          ))}
          {entries.length === 0 && <div style={{ color: '#666', paddingLeft: 16, fontSize: 11 }}>empty</div>}
        </div>
      )}
    </div>
  );
}

/** Parse raw AST JSON and render a collapsible tree. */
function NormalizedAstView({ raw }: { raw: string }): React.JSX.Element {
  const parsed = useMemo(() => {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }, [raw]);

  if (parsed === null) {
    return <div style={{ color: '#dcdcaa' }}>Could not parse AST as JSON — raw output is authoritative.</div>;
  }

  return (
    <div>
      <div style={{ background: '#3a3325', color: '#dcdcaa', padding: '2px 6px', marginBottom: 4, fontSize: 11 }}>
        parsed AST tree — raw output is authoritative
      </div>
      <div style={{ fontFamily: "'JetBrainsMono Nerd Font Mono', monospace", fontSize: 12, overflow: 'auto' }}>
        <AstNode name="root" node={parsed} depth={0} />
      </div>
    </div>
  );
}

/** Parse raw OptCode disassembly into a structured table. */
function NormalizedOptcodeTable({ raw }: { raw: string }): React.JSX.Element {
  const rows = useMemo(() => {
    const out: { pc: string; op: string; operands: string }[] = [];
    const LINE_RE = /^\s*(?:[0-9a-f]+)?\s*([0-9a-f]+)\s+(.+)$/;
    for (const line of raw.split('\n')) {
      const m = LINE_RE.exec(line);
      if (m) {
        const pc = m[1] ?? '';
        const rest = m[2] ?? '';
        const spaceIdx = rest.indexOf(' ');
        const op = spaceIdx === -1 ? rest : rest.slice(0, spaceIdx);
        const operands = spaceIdx === -1 ? '' : rest.slice(spaceIdx + 1);
        out.push({ pc, op, operands });
        if (out.length >= MAX_ROWS) break;
      }
    }
    return out;
  }, [raw]);

  if (rows.length === 0) {
    return <div style={{ color: '#dcdcaa' }}>No optimized instructions parsed — raw output is authoritative.</div>;
  }

  return (
    <div>
      <div style={{ background: '#3a3325', color: '#dcdcaa', padding: '2px 6px', marginBottom: 4 }}>
        best-effort normalization — raw output is authoritative
      </div>
      <table style={{ fontFamily: "'JetBrainsMono Nerd Font Mono', monospace", fontSize: 11, borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr style={{ color: '#888', textAlign: 'left' }}>
            <th style={{ width: 80 }}>pc</th>
            <th style={{ width: 140 }}>opcode</th>
            <th>operands</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderBottom: '1px solid #222' }}>
              <td style={{ color: '#888' }}>{r.pc}</td>
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

/**
 * Per-type result viewer (plan todo 19): Normalized view first-class,
 * raw as fallback, artifact listing.
 */
export function ResultViewer({ result, focusFunction }: { result: AnalysisResult; focusFunction?: string | null }): React.JSX.Element {
  const [tab, setTab] = useState<DrawerTab>('normalized');

  /** Which normalizer to show for this analysis type. */
  const hasNormalizer = result.analysisType === 'bytecode' || result.analysisType === 'deopts' || result.analysisType === 'ast' || result.analysisType === 'optcode';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minHeight: 0 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {(['normalized', 'raw', 'artifacts'] as const).map((t) => {
          const disabled = t === 'normalized' && !hasNormalizer;
          return (
            <button
              key={t}
              onClick={() => !disabled && setTab(t)}
              disabled={disabled}
              style={{
                background: tab === t ? '#333' : 'transparent',
                color: disabled ? '#555' : '#ccc',
                border: 'none',
                padding: '1px 8px',
                cursor: disabled ? 'not-allowed' : 'pointer',
                fontSize: 11,
                opacity: disabled ? 0.5 : 1
              }}
            >
              {t}
            </button>
          );
        })}
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
          <NormalizedBytecodeTable raw={result.rawOutput} focus={focusFunction} />
        ) : result.analysisType === 'deopts' ? (
          <NormalizedDeoptTable raw={result.rawOutput} />
        ) : result.analysisType === 'ast' ? (
          <NormalizedAstView raw={result.rawOutput} />
        ) : result.analysisType === 'optcode' ? (
          <NormalizedOptcodeTable raw={result.rawOutput} />
        ) : (
          <div style={{ color: '#777' }}>no normalizer for '{result.analysisType}' yet</div>
        ))}
      {tab === 'artifacts' && (
        <div style={{ fontFamily: "'JetBrainsMono Nerd Font Mono', monospace", fontSize: 11 }}>
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
