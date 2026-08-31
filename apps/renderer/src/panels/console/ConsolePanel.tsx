import { useEffect, useMemo, useRef, useState } from 'react';
import { useRun, type InlineConsoleEntry } from '../../state/run';
import { useUi } from '../../state/ui';
import type { SerializedValue } from '@rh/protocol';
import { detectConsoleTable, detectTable, type TableShape } from './table-shape';

/* ── colour palette ──────────────────────────────────────────────────── */

const C = {
  str: 'var(--rh-value-string, #ce9178)',
  num: 'var(--rh-value-number, #b5cea8)',
  bool: 'var(--rh-value-bool, var(--accent-strong))',
  nil: 'var(--rh-value-null, var(--accent-strong))',
  sym: 'var(--rh-value-symbol, #c586c0)',
  fn: 'var(--rh-value-function, var(--warn))',
  cls: 'var(--rh-value-class, #4ec9b0)',
  err: 'var(--err)',
  date: 'var(--rh-value-date, #ce9178)',
  re: 'var(--rh-value-regexp, #d16969)',
  coll: 'var(--rh-value-collection, var(--accent))',
  key: 'var(--rh-value-key, var(--accent-strong))',
  proto: 'var(--accent)',
  protoBorder: 'color-mix(in srgb, var(--accent) 40%, transparent)',
  dim: 'var(--text-dim)',
  ok: 'var(--ok)',
  warn: 'var(--warn)',
  errBg: 'color-mix(in srgb, var(--err) 12%, transparent)',
  warnBg: 'color-mix(in srgb, var(--warn) 12%, transparent)',
  infoBg: 'color-mix(in srgb, var(--accent) 10%, transparent)',
  hover: 'color-mix(in srgb, var(--bg-hover) 70%, transparent)',
  border: 'var(--frame-weak)',
  panel: 'var(--bg-panel)',
  result: 'var(--result)',
  tblHead: 'color-mix(in srgb, var(--accent) 10%, transparent)',
  tblAlt: 'color-mix(in srgb, var(--bg-hover) 35%, transparent)',
  logBorder: 'color-mix(in srgb, var(--accent) 35%, transparent)',
  warnBorder: 'color-mix(in srgb, var(--warn) 45%, transparent)',
  errBorder: 'color-mix(in srgb, var(--err) 45%, transparent)',
};

/* ── helpers ─────────────────────────────────────────────────────────── */

function colorOf(v: SerializedValue): string {
  switch (v.t) {
    case 'string': return C.str;
    case 'number': return C.num;
    case 'boolean': return C.bool;
    case 'null': case 'undefined': case 'bigint': return C.nil;
    case 'symbol': return C.sym;
    case 'function': case 'class': return C.fn;
    case 'error': return C.err;
    case 'date': return C.date;
    case 'regexp': return C.re;
    default: return C.coll;
  }
}

function inlineText(v: SerializedValue): string {
  if (v.t === 'string') return v.prim ?? '';
  if (['number', 'boolean', 'null', 'undefined', 'bigint'].includes(v.t)) return v.prim ?? v.t;
  if (v.t === 'symbol') return v.prim ?? 'Symbol';
  if (v.t === 'function' || v.t === 'class') return `${v.label ?? '(anonymous)'}(${v.size ?? 0})`;
  if (v.t === 'error') return `${v.label ?? 'Error'}: ${v.children?.find((c) => c.k === 'message')?.node.prim ?? ''}`;
  if (v.t === 'date') return v.prim ?? 'Date';
  if (v.t === 'regexp') return `/${v.prim ?? ''}/${v.label ?? ''}`;
  if (v.t === 'promise') return v.label ?? 'Promise';
  if (v.t === 'map') return `Map(${v.size ?? 0})`;
  if (v.t === 'set') return `Set(${v.size ?? 0})`;
  if (v.t === 'typedarray') return `${v.label ?? 'TypedArray'}(${v.size ?? 0})`;
  if (v.t === 'array') return `Array(${v.size ?? v.children?.length ?? 0})`;
  if (v.t === 'object') {
    const label = v.label ?? 'Object';
    const first = v.children?.[0];
    return first ? `${label} {${first.k}…}` : `${label} {}`;
  }
  return v.prim ?? v.t;
}

function shortInline(v: SerializedValue): string {
  switch (v.t) {
    case 'string': return JSON.stringify(v.prim ?? '');
    case 'number': case 'boolean': case 'null': case 'undefined': case 'bigint':
    case 'symbol': case 'date': case 'regexp': return inlineText(v);
    case 'object': return `${v.label ?? 'Object'} {…}`;
    case 'array': return '[…]';
    case 'map': return 'Map(…)';
    case 'set': return 'Set(…)';
    case 'typedarray': return `${v.label ?? 'TypedArray'}(…)`;
    case 'function': case 'class': return 'ƒ';
    case 'error': return v.label ?? 'Error';
    case 'promise': return v.label ?? 'Promise';
    default: return v.t;
  }
}

function previewText(v: SerializedValue): string {
  switch (v.t) {
    case 'object': {
      const label = v.label ?? 'Object';
      const keys = (v.children ?? []).filter((c) => c.k !== '[[Prototype]]').map((c) => c.k);
      const shown = keys.slice(0, 3);
      return `${label} {${shown.join(', ')}${keys.length > shown.length ? ', …' : ''}}`;
    }
    case 'array': {
      const els = (v.children ?? []).slice(0, 3).map((c) => shortInline(c.node));
      const n = v.size ?? v.children?.length ?? 0;
      return `[${els.join(', ')}${n > els.length ? ', …' : ''}]`;
    }
    case 'map': {
      const entries = (v.children ?? []).slice(0, 2).map((c) => `${c.k} => ${shortInline(c.node)}`);
      const n = v.size ?? v.children?.length ?? 0;
      return `Map(${n}) {${entries.join(', ')}${n > entries.length ? ', …' : ''}}`;
    }
    case 'set': {
      const els = (v.children ?? []).slice(0, 3).map((c) => shortInline(c.node));
      const n = v.size ?? v.children?.length ?? 0;
      return `Set(${n}) {${els.join(', ')}${n > els.length ? ', …' : ''}}`;
    }
    case 'function': return `ƒ ${v.label ?? '(anonymous)'}`;
    case 'class': return `class ${v.label ?? '(anonymous)'}`;
    case 'error': return inlineText(v);
    default: return inlineText(v);
  }
}

function typeTag(v: SerializedValue): string | null {
  switch (v.t) {
    case 'array': return `Array(${v.size ?? v.children?.length ?? 0})`;
    case 'map': return `Map(${v.size ?? 0})`;
    case 'set': return `Set(${v.size ?? 0})`;
    case 'typedarray': return `${v.label ?? 'TypedArray'}(${v.size ?? 0})`;
    case 'object': return v.label ?? null;
    case 'regexp': return `/${v.prim ?? ''}/${v.label ?? ''}`;
    case 'date': return 'Date';
    case 'function': case 'class': return `${v.t === 'class' ? 'class' : 'f'} ${v.label ?? '(anonymous)'}`;
    case 'error': return v.label ?? 'Error';
    case 'promise': return v.label ?? 'Promise';
    case 'symbol': return 'Symbol';
    default: return null;
  }
}

function isExpandable(v: SerializedValue | null): boolean {
  if (!v) return false;
  return v.t === 'object' || v.t === 'array' || v.t === 'map' || v.t === 'set' ||
    v.t === 'error' || v.t === 'typedarray' ||
    ((v.t === 'function' || v.t === 'class') && (v.children?.length ?? 0) > 0);
}

/* ── regex to detect bootstrap stdout echo lines ─────────────────────── */
// bootstrap.cjs writes "L{lineNumber}: {text}\n" to stdout for each console call.
// We suppress these when structured entries exist for that line number.
const BOOTSTRAP_ECHO_RE = /^L(\d+): /;

/* ── table detection ─────────────────────────────────────────────────── */

/* ── table renderer ──────────────────────────────────────────────────── */

const CELL_BORDER = '1px solid rgba(255,255,255,0.06)';

function TableView({ shape }: { shape: TableShape }): React.JSX.Element {
  return (
    <div style={{ overflow: 'auto', maxHeight: 320, borderRadius: 6, border: `1px solid ${C.border}`, margin: '4px 0 4px 22px' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: 11, fontFamily: "'JetBrainsMono Nerd Font Mono', 'Cascadia Mono', Consolas, monospace" }}>
        <thead>
          <tr>
            <th style={{ background: C.tblHead, color: C.dim, padding: '3px 8px', textAlign: 'left', fontWeight: 500, position: 'sticky', top: 0, borderBottom: `1px solid ${C.border}`, borderRight: CELL_BORDER, fontSize: 10, letterSpacing: 0.3 }}>#</th>
            {shape.headers.map((h) => (
              <th key={h} style={{ background: C.tblHead, color: C.key, padding: '3px 8px', textAlign: 'left', fontWeight: 600, position: 'sticky', top: 0, borderBottom: `1px solid ${C.border}`, borderRight: CELL_BORDER, whiteSpace: 'nowrap' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shape.rows.map((row, ri) => (
            <tr key={ri} style={{ background: ri % 2 === 0 ? 'transparent' : C.tblAlt }}>
              <td style={{ padding: '2px 8px', color: C.dim, borderBottom: CELL_BORDER, borderRight: CELL_BORDER, fontSize: 10, textAlign: 'right', userSelect: 'none' }}>{ri}</td>
              {shape.headers.map((h) => {
                const cell = row.find((c) => c.k === h);
                const val = cell?.node;
                return (
                  <td key={h} style={{ padding: '2px 8px', color: val ? colorOf(val) : C.dim, borderBottom: CELL_BORDER, borderRight: CELL_BORDER, wordBreak: 'break-word', maxWidth: 240 }}>
                    {val ? inlineText(val) : <span style={{ opacity: 0.3 }}>—</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── expandable tree (compact key: value rows) ───────────────────────── */

function TreeChild({ k, node, inMap }: { k: string; node: SerializedValue; inMap: boolean }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const kids = node.children ?? [];
  const isCircular = node.refId !== undefined;
  const expandable = kids.length > 0 && !isCircular;
  const proto = k === '[[Prototype]]';
  const sep = inMap ? ' =>' : ':';
  const protoLabel = proto ? (node.label ?? node.t) : null;

  const keySpan = (
    <span style={{ color: proto ? C.proto : C.key, fontSize: 11, fontWeight: proto ? 600 : 400, fontStyle: proto ? 'italic' : 'normal' }}>
      {k}{protoLabel ? `: ${protoLabel}` : ''}{protoLabel ? '' : sep}{' '}
    </span>
  );

  if (!expandable) {
    return (
      <div style={{ padding: '1px 0 1px 14px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {keySpan}
        {isCircular
          ? <span style={{ color: C.dim, fontStyle: 'italic' }}>Circular ↑{node.refId}</span>
          : <span style={{ color: colorOf(node) }}>{previewText(node)}</span>}
        {node.truncated && <span style={{ color: C.warn, fontSize: 10, marginLeft: 4 }}>…truncated</span>}
      </div>
    );
  }

  const tbl = node.t === 'array' ? detectTable(node) : null;
  return (
    <div style={{ padding: '1px 0' }}>
      <div
        onClick={() => setOpen((o) => !o)}
        style={{ cursor: 'pointer', whiteSpace: 'pre-wrap', wordBreak: 'break-word', borderRadius: 2, padding: '0 14px' }}
        onMouseEnter={(e) => { e.currentTarget.style.background = C.hover; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        <span style={{ color: C.dim, display: 'inline-block', width: 14, textAlign: 'center', fontSize: 10, userSelect: 'none' }}>{open ? '⌄' : '›'}</span>
        {keySpan}
        {open
          ? <span style={{ color: C.dim, opacity: 0.6, fontSize: 10, fontStyle: 'italic' }}>{typeTag(node) ?? previewText(node)}</span>
          : <span style={{ color: colorOf(node) }}>{previewText(node)}</span>}
        {node.truncated && !open && <span style={{ color: C.warn, fontSize: 10, marginLeft: 4 }}>…truncated</span>}
      </div>
      {open && (
        <div style={{ borderLeft: `1px solid ${proto ? C.protoBorder : C.border}`, marginLeft: 6, paddingLeft: 14 }}>
          {tbl
            ? <TableView shape={tbl} />
            : kids.map((ck, ci) => <TreeChild key={`${ck.k}-${ci}`} k={ck.k} node={ck.node} inMap={node.t === 'map'} />)}
          {node.truncated && <div style={{ color: C.warn, fontSize: 10 }}>…truncated</div>}
        </div>
      )}
    </div>
  );
}

function Tree({ node }: { node: SerializedValue }): React.JSX.Element {
  const kids = node.children ?? [];
  return (
    <div style={{ fontFamily: "'JetBrainsMono Nerd Font Mono', 'Cascadia Mono', Consolas, monospace", fontSize: 12, lineHeight: '16px' }}>
      {kids.length === 0
        ? <div style={{ color: colorOf(node), paddingLeft: 14, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {node.refId !== undefined ? `Circular ↑${node.refId}` : previewText(node)}
          </div>
        : kids.map((c, i) => <TreeChild key={`${c.k}-${i}`} k={c.k} node={c.node} inMap={node.t === 'map'} />)}
      {node.truncated && <div style={{ color: C.warn, fontSize: 10, paddingLeft: 14 }}>…truncated</div>}
    </div>
  );
}

/* ── render all args of a console entry as space-separated values ─────── */

function ConsoleValueRow({ entry }: { entry: InlineConsoleEntry }): React.JSX.Element {
  const args = entry.args ?? [];
  if (args.length === 0) {
    return <span>{entry.text}</span>;
  }
  return (
    <>
      {args.map((arg, i) => (
        <span key={i} style={{ color: colorOf(arg), marginRight: 6 }}>
          {inlineText(arg)}
        </span>
      ))}
    </>
  );
}

/* ── single console entry row (Chrome DevTools style) ────────────────── */

function ConsoleEntryRow({
  entry,
  result,
}: {
  entry: InlineConsoleEntry | null;
  result: SerializedValue | null;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const primary = entry?.args?.[0] ?? result ?? null;
  const table = entry?.level === 'table' && entry.args
    ? detectConsoleTable(entry.args)
    : primary && entry === null
      ? detectTable(primary)
      : null;
  const hasExpand = isExpandable(primary) || table !== null;

  const isWarn = entry?.level === 'warn';
  const isError = entry?.level === 'error';
  const isInfo = entry?.level === 'info';
  const isDebug = entry?.level === 'debug';
  const isResult = entry === null;

  const accentColor = isError ? C.err : isWarn ? C.warn : isInfo ? 'var(--accent-strong)' : isDebug ? '#c586c0' : C.ok;
  const accentBg = isError ? C.errBg : isWarn ? C.warnBg : isInfo ? C.infoBg : 'transparent';
  const borderColor = isError ? C.errBorder : isWarn ? C.warnBorder : C.logBorder;
  const icon = isError ? '×' : isWarn ? '!' : isInfo ? 'i' : isResult ? '→' : null;

  return (
    <div style={{
      borderBottom: `1px solid ${C.border}`,
      background: expanded ? `${accentBg}` : 'transparent',
      borderLeft: `3px solid ${borderColor}`,
      minHeight: 24,
    }}>
      {/* ── one-liner header ── */}
      <div
        onClick={() => hasExpand && setExpanded((o) => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '3px 8px 3px 6px',
          cursor: hasExpand ? 'pointer' : 'default',
          borderRadius: expanded ? '2px 2px 0 0' : 2,
        }}
        onMouseEnter={(e) => { if (hasExpand) e.currentTarget.style.background = C.hover; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        {/* expand arrow */}
        {hasExpand && (
          <span style={{ color: C.dim, fontSize: 9, flexShrink: 0, width: 12, textAlign: 'center', userSelect: 'none' }}>
            {expanded ? '⌄' : '›'}
          </span>
        )}
        {!hasExpand && <span style={{ width: 12, flexShrink: 0 }} />}

        {/* icon */}
        {icon && (
          <span style={{ color: accentColor, fontSize: 11, flexShrink: 0, fontWeight: 600 }}>
            {icon}
          </span>
        )}

        {/* value text */}
        <span style={{
          flex: 1,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          color: isResult ? C.result : accentColor,
          fontSize: 12,
          fontFamily: "'JetBrainsMono Nerd Font Mono', 'Cascadia Mono', Consolas, monospace",
          lineHeight: '17px',
        }}>
          {entry
            ? (table
            ? <span><span style={{ color: C.dim }}>▶ </span><span style={{ color: C.coll }}>Table</span> <span style={{ color: C.dim, fontSize: 11 }}>({table.rows.length} rows)</span></span>
              : <ConsoleValueRow entry={entry} />
            )
            : <span>→ {result ? inlineText(result) : ''}</span>
          }
        </span>

        {/* source line tag */}
        {entry && (
          <span style={{
            color: C.dim,
            fontSize: 10,
            flexShrink: 0,
            background: 'rgba(255,255,255,0.04)',
            padding: '0 5px',
            borderRadius: 3,
            lineHeight: '16px',
          }}>
            L{entry.line}
          </span>
        )}
      </div>

      {/* ── expanded tree ── */}
      {expanded && primary && (
        <div style={{ padding: '4px 8px 8px 20px', borderRadius: '0 0 2px 2px' }}>
          {table
            ? <TableView shape={table} />
            : <Tree node={primary} />}
        </div>
      )}
    </div>
  );
}

/* ── main console panel ──────────────────────────────────────────────── */

interface HistoryRow {
  runId: string;
  finishedAt: string;
  status: string;
  durationMs: number;
  killedBy: string | null;
}

/**
 * Chrome DevTools-like console panel.
 *
 * Deduplication: the bootstrap.cjs sends BOTH structured console frames
 * (__RH_CONSOLE__ on stderr → inlineByLine) AND raw stdout echoes
 * ("L{N}: text" → lines[]). We suppress the stdout echoes for lines that
 * already have structured entries, so the user sees exactly one row per
 * console call.
 */
interface ConsolePanelProps {
  /** Source slot whose run output is currently being inspected. */
  fileId?: string | null;
}

export function ConsolePanel({ fileId }: ConsolePanelProps): React.JSX.Element {
  const lines = useRun((s) => s.lines);
  const inlineByLine = useRun((s) => s.inlineByLine);
  const resultByLine = useRun((s) => s.resultByLine);
  const notice = useRun((s) => s.notice);
  const runFileId = useRun((s) => s.runFileId);
  const clearConsole = useRun((s) => s.clearConsole);
  // Run output is scoped to the source slot that produced it. Without this
  // guard, switching source tabs leaves the previous file's console visible.
  // An omitted fileId keeps the panel usable in isolated/legacy mounts; the
  // workbench always passes its active source id (including null).
  const isCurrentSource = fileId === undefined || (fileId !== null && runFileId === fileId);
  const visibleLines = isCurrentSource ? lines : [];
  const visibleInlineByLine = isCurrentSource ? inlineByLine : {};
  const visibleResultByLine = isCurrentSource ? resultByLine : {};
  const visibleNotice = isCurrentSource ? notice : null;
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [visibleLines.length, Object.keys(visibleInlineByLine).length, Object.keys(visibleResultByLine).length]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const response = (await window.api?.historyList('default')) as
        | { ok: boolean; records: HistoryRow[] }
        | undefined;
      if (!cancelled && response?.ok === true) setHistory(response.records.slice().reverse());
    })();
    return () => { cancelled = true; };
  }, [visibleLines.length]);

  // Build an ordered list of all source lines that have structured output
  const structuredLineSet = useMemo(() => {
    const s = new Set<number>();
    for (const ln of Object.keys(visibleInlineByLine).map(Number)) {
      if (Number.isFinite(ln) && ln > 0) s.add(ln);
    }
    for (const ln of Object.keys(visibleResultByLine).map(Number)) {
      if (Number.isFinite(ln) && ln > 0) s.add(ln);
    }
    return s;
  }, [visibleInlineByLine, visibleResultByLine]);

  // Sort all line numbers with structured output
  const structuredLineNums = useMemo(
    () => Array.from(structuredLineSet).sort((a, b) => a - b),
    [structuredLineSet],
  );

  // Filter raw stdout lines: suppress bootstrap echo lines ("L{N}: ...") when
  // structured entries already exist for that line number.
  const filteredLines = useMemo(() => {
    return visibleLines.filter((line) => {
      if (line.stream === 'stderr') return true; // always show stderr
      const m = BOOTSTRAP_ECHO_RE.exec(line.text);
      if (!m) return true; // not a bootstrap echo — keep it
      const ln = Number(m[1]);
      return !structuredLineSet.has(ln); // suppress only if structured covers it
    });
  }, [visibleLines, structuredLineSet]);

  const hasStructured = structuredLineNums.length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      {/* ── toolbar ── */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, paddingBottom: 4, flexShrink: 0 }}>
        {visibleNotice !== null && <span style={{ color: 'var(--warn)', fontSize: 11 }}>{visibleNotice}</span>}
        <button onClick={() => setShowHistory((v) => !v)} style={btnStyle}>
          history ({history.length})
        </button>
        <button onClick={clearConsole} style={btnStyle}>
          clear
        </button>
      </div>

      {/* ── history drawer ── */}
      {showHistory && (
        <div style={{ maxHeight: 120, overflow: 'auto', borderBottom: `1px solid ${C.border}`, marginBottom: 4, flexShrink: 0 }}>
          {history.length === 0 && <div style={{ color: C.dim, fontSize: 11, padding: 4 }}>no runs yet</div>}
          {history.map((h) => (
            <div
              key={h.runId}
              onClick={() => {
                const rec = h as unknown as { contentSnapshot?: string; relPath?: string };
                if (typeof rec.contentSnapshot === 'string' && typeof rec.relPath === 'string') {
                  const id = `default:${rec.relPath}`;
                  useUi.getState().openFile({ id, relPath: rec.relPath, language: rec.relPath.endsWith('.ts') ? 'typescript' : 'javascript', content: rec.contentSnapshot, dirty: false });
                  useUi.getState().setActive(id);
                }
              }}
              title="Click to restore snapshot"
              style={{ fontFamily: "'JetBrainsMono Nerd Font Mono', monospace", fontSize: 11, color: 'var(--text-dim)', cursor: 'pointer', padding: '2px 4px', borderRadius: 0 }}
              onMouseEnter={(e) => ((e.currentTarget.style.background = 'var(--bg-hover)'), (e.currentTarget.style.color = 'var(--text)'))}
              onMouseLeave={(e) => ((e.currentTarget.style.background = 'transparent'), (e.currentTarget.style.color = 'var(--text-dim)'))}
            >
              {new Date(h.finishedAt).toLocaleTimeString()} · {h.status} · {h.durationMs}ms
              {h.killedBy !== null ? ` · ${h.killedBy}` : ''} · {(h as unknown as { relPath?: string }).relPath ?? ''} — restore
            </div>
          ))}
        </div>
      )}

      {/* ── console output ── */}
      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {/* Structured console entries + expression results */}
        {hasStructured && structuredLineNums.map((ln) => {
          const entries = visibleInlineByLine[ln] ?? [];
          const result = visibleResultByLine[ln];
          const isMeaningfulResult = result !== undefined && result.t !== 'undefined';
          if (entries.length === 0 && !isMeaningfulResult) return null;
          return (
            <div key={ln}>
              {entries.map((entry, idx) => (
                <ConsoleEntryRow key={`e-${ln}-${idx}`} entry={entry} result={null} />
              ))}
              {isMeaningfulResult && (
                <ConsoleEntryRow entry={null} result={result} />
              )}
            </div>
          );
        })}

        {/* Raw stdout/stderr lines (bootstrap echoes filtered out above) */}
        {filteredLines.map((line) => (
          <div
            key={line.seq}
            style={{
              whiteSpace: 'pre-wrap',
              color: line.stream === 'stderr' ? C.err : '#b0b0b0',
              padding: '2px 8px 2px 22px',
              fontSize: 12,
              fontFamily: "'JetBrainsMono Nerd Font Mono', 'Cascadia Mono', Consolas, monospace",
              lineHeight: '17px',
              borderLeft: `3px solid ${line.stream === 'stderr' ? C.errBorder : 'transparent'}`,
            }}
          >
            {line.text}
          </div>
        ))}

        {/* Empty state */}
        {!hasStructured && filteredLines.length === 0 && (
          <div style={{ padding: 16, color: C.dim, fontSize: 12, fontFamily: "'JetBrainsMono Nerd Font Mono', monospace", textAlign: 'center', marginTop: 8 }}>
            <div style={{ fontSize: 20, marginBottom: 6, opacity: 0.3 }}>◇</div>
            No output yet — run the file (Ctrl+Enter)
          </div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--text-secondary)',
  border: '1px solid var(--frame-normal)',
  padding: '2px 8px',
  cursor: 'pointer',
  fontSize: 11
};
