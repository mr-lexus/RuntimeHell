import { useEffect, useMemo, useRef, useState } from 'react';
import { useRun, type InlineConsoleEntry } from '../../state/run';
import type { SerializedValue } from '@rh/protocol';

/** Must match CodeEditor's monaco lineHeight option. */
export const LINE_HEIGHT_PX = 20;

/* ── colour palette (VSCode-dark-inspired) ───────────────────────────── */

const C = {
  str: '#ce9178',
  num: '#b5cea8',
  bool: '#569cd6',
  nil: '#569cd6',
  sym: '#c586c0',
  fn: '#dcdcaa',
  cls: '#4ec9b0',
  err: '#f48771',
  date: '#ce9178',
  re: '#d16969',
  coll: '#9cdcfe',
  key: '#9cdcfe',
  proto: '#569cd6',
  dim: 'var(--text-dim)',
  ok: 'var(--ok)',
  warn: 'var(--warn)',
  errBg: 'rgba(244,135,113,0.12)',
  warnBg: 'rgba(220,220,170,0.12)',
  hover: 'rgba(255,255,255,0.04)',
  border: 'var(--border)',
  panel: 'var(--bg-panel)',
  result: 'var(--result)',
  rowBg: 'rgba(86,156,214,0.06)',
  tblHead: 'rgba(86,156,214,0.10)',
  tblAlt: 'rgba(255,255,255,0.025)',
};

/* ── column width (draggable) ────────────────────────────────────────── */

const WIDTH_MIN = 200;
const WIDTH_MAX = 1200;
const WIDTH_DEFAULT = 340;
const WIDTH_STORAGE_KEY = 'rh.inspector-width';

function readStoredWidth(): number {
  try {
    const raw = localStorage.getItem(WIDTH_STORAGE_KEY);
    const n = raw === null ? NaN : Number(raw);
    if (Number.isFinite(n)) return Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, n));
  } catch {
    /* storage unavailable — fall through to default */
  }
  return WIDTH_DEFAULT;
}

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

/* ── format value to single-line text ────────────────────────────────── */

function inlineText(v: SerializedValue): string {
  if (v.t === 'string') return JSON.stringify(v.prim ?? '');
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
    return first ? `${label}{${first.k}…}` : `${label}{}`;
  }
  return v.prim ?? v.t;
}

/* ── ultra-short repr for embedding inside collection previews ────────── */

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

/* ── compact one-line preview shown next to a collapsed key ───────────── */

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

/* ── type badge label ────────────────────────────────────────────────── */

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

/* ── table detection (array of objects with uniform keys) ─────────────── */

interface TableShape { headers: string[]; rows: { k: string; node: SerializedValue }[][] }

function detectTable(v: SerializedValue): TableShape | null {
  if (v.t !== 'array' || !v.children || v.children.length < 1) return null;
  const objKids = v.children.filter((c) => c.node.t === 'object' || c.node.t === 'array');
  if (objKids.length < 1) return null;
  const headerSet = new Map<string, number>();
  for (const c of objKids) {
    for (const child of c.node.children ?? []) {
      if (child.k === '[[Prototype]]') continue;
      if (!headerSet.has(child.k)) headerSet.set(child.k, headerSet.size);
    }
  }
  if (headerSet.size === 0) return null;
  return { headers: Array.from(headerSet.keys()), rows: objKids.map((c) => c.node.children ?? []) };
}

/* ── table renderer ──────────────────────────────────────────────────── */

const CELL_BORDER = '1px solid rgba(255,255,255,0.06)';

function TableView({ shape, depth }: { shape: TableShape; depth: number }): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(depth > 0);
  if (collapsed) {
    return (
      <div
        onClick={() => setCollapsed(false)}
        style={{ cursor: 'pointer', color: C.coll, fontSize: 11, padding: '2px 0', userSelect: 'none' }}
      >
        {'\uf054'} {shape.rows.length} rows × {shape.headers.length} cols
      </div>
    );
  }
  return (
    <div style={{ overflow: 'auto', maxHeight: 320, borderRadius: 6, border: `1px solid ${C.border}` }}>
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

/* ── full inspector tree (compact key: value rows) ───────────────────── */

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
        <span style={{ display: 'inline-block', width: 14 }} />
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
    <div style={{ padding: '1px 0 1px 14px' }}>
      <div
        onClick={() => setOpen((o) => !o)}
        style={{ cursor: 'pointer', whiteSpace: 'pre-wrap', wordBreak: 'break-word', borderRadius: 2 }}
        onMouseEnter={(e) => { e.currentTarget.style.background = C.hover; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        <span style={{ color: C.dim, display: 'inline-block', width: 14, textAlign: 'center', fontSize: 10, userSelect: 'none' }}>{open ? '\uf078' : '\uf054'}</span>
        {keySpan}
        {open
          ? <span style={{ color: C.dim, opacity: 0.6, fontSize: 10, fontStyle: 'italic' }}>{typeTag(node) ?? previewText(node)}</span>
          : <span style={{ color: colorOf(node) }}>{previewText(node)}</span>}
        {node.truncated && !open && <span style={{ color: C.warn, fontSize: 10, marginLeft: 4 }}>…truncated</span>}
      </div>
      {open && (
        <div style={{ borderLeft: `1px solid ${proto ? `${C.proto}66` : C.border}`, marginLeft: 6, paddingLeft: 14 }}>
          {tbl
            ? <TableView shape={tbl} depth={1} />
            : kids.map((ck, ci) => <TreeChild key={`${ck.k}-${ci}`} k={ck.k} node={ck.node} inMap={node.t === 'map'} />)}
          {node.truncated && <div style={{ color: C.warn, fontSize: 10 }}>…truncated</div>}
        </div>
      )}
    </div>
  );
}

/** Root of the inspector: renders the node's children rows directly. */
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

/* ── per-line output row ─────────────────────────────────────────────── */

interface RowOut {
  logs: InlineConsoleEntry[];
  result: SerializedValue | null;
  primary: SerializedValue | null;
}

function isExpandable(v: SerializedValue | null): boolean {
  if (!v) return false;
  return v.t === 'object' || v.t === 'array' || v.t === 'map' || v.t === 'set' ||
    v.t === 'error' || v.t === 'typedarray' ||
    ((v.t === 'function' || v.t === 'class') && (v.children?.length ?? 0) > 0);
}

function OutputRow({ out, ln, canExpand, expanded, onToggle }: {
  out: RowOut;
  ln: number;
  canExpand: boolean;
  expanded: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  const hasExpand = canExpand && isExpandable(out.primary);
  const table = out.primary ? detectTable(out.primary) : null;

  const tableLabel = (entry: InlineConsoleEntry): string => {
    if (entry.level === 'table' && entry.args && entry.args.length > 0) {
      const a: SerializedValue | undefined = entry.args[0];
      if (a) {
        const n = a.size ?? a.children?.length ?? '?';
        return `◀ Table (${n} rows)`;
      }
    }
    return `◀ ${entry.text}`;
  };

  return (
    <div style={{ boxShadow: 'inset 0 -1px 0 var(--border)', background: expanded ? C.rowBg : 'transparent' }}>
      {/* ── collapsed one-liner ── */}
      <div
        data-inspector-oneliner={ln}
        onClick={() => hasExpand && onToggle()}
        style={{
          height: LINE_HEIGHT_PX,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          paddingLeft: 8,
          paddingRight: 6,
          cursor: hasExpand ? 'pointer' : 'default',
          overflow: 'hidden',
          borderRadius: expanded ? '2px 2px 0 0' : 2,
        }}
        onMouseEnter={(e) => { if (hasExpand) e.currentTarget.style.background = C.hover; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = expanded ? C.rowBg : 'transparent'; }}
      >
        {out.logs.map((entry, idx) => (
          <span
            key={`c${idx}`}
            title={`${entry.level} at L${ln}${entry.args ? ` (${entry.args.length} args)` : ''}`}
            style={{
              color: entry.level === 'error' ? C.err : entry.level === 'warn' ? C.warn : C.ok,
              background: entry.level === 'error' ? C.errBg : entry.level === 'warn' ? C.warnBg : 'transparent',
              padding: '0 4px',
              borderRadius: 2,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
          >
            {tableLabel(entry)}
          </span>
        ))}
        {out.result && (
          <span style={{ color: C.result, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            → {inlineText(out.result)}
          </span>
        )}
        {hasExpand && (
          <span style={{ marginLeft: 'auto', color: C.result, fontSize: 10, flexShrink: 0, userSelect: 'none' }}>
            {expanded ? '\uf078' : '\uf054'}
          </span>
        )}
      </div>

      {/* ── expanded inspector (INLINE — no portal needed) ── */}
      {expanded && out.primary && (
        <div
          data-inspector-overlay
          style={{
            padding: '6px 8px 8px 10px',
            background: C.panel,
            border: `1px solid ${C.border}`,
            borderRadius: 4,
            margin: '0 4px 4px 4px',
            maxHeight: 400,
            overflowY: 'auto',
          }}
        >
          {table
            ? <TableView shape={table} depth={0} />
            : <Tree node={out.primary} />}
        </div>
      )}
    </div>
  );
}

/* ── main column ─────────────────────────────────────────────────────── */

export function LineOutputColumn({
  lineCount,
  scrollTop,
  allowExpand
}: {
  lineCount: number;
  scrollTop: number;
  allowExpand: boolean;
}): React.JSX.Element {
  const inlineByLine = useRun((s) => s.inlineByLine);
  const resultByLine = useRun((s) => s.resultByLine);
  const phase = useRun((s) => s.phase);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [expandedLine, setExpandedLine] = useState<number | null>(null);
  const [width, setWidth] = useState<number>(readStoredWidth);
  const [viewportH, setViewportH] = useState<number>(0);
  const dragCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (containerRef.current) containerRef.current.scrollTop = scrollTop;
  }, [scrollTop]);

  /* Track visible height so scrollHeight matches Monaco's contentHeight
     (lineCount*LINE_HEIGHT_PX + max(0, viewportHeight - LINE_HEIGHT_PX)). */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setViewportH(entry.target.clientHeight);
    });
    ro.observe(el);
    setViewportH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    setExpandedLine(null);
  }, [inlineByLine, resultByLine]);

  /* click outside closes expanded row */
  useEffect(() => {
    if (expandedLine === null) return;
    const onDown = (e: MouseEvent): void => {
      const el = e.target as HTMLElement | null;
      if (!el || typeof el.closest !== 'function') return;
      if (el.closest('[data-inspector-overlay]')) return;
      const oneLiner = el.closest('[data-inspector-oneliner]');
      if (oneLiner instanceof HTMLElement && oneLiner.dataset.inspectorOneliner === String(expandedLine)) return;
      setExpandedLine(null);
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [expandedLine]);

  useEffect(() => () => dragCleanupRef.current?.(), []);

  const rows = useMemo(() => {
    const map: Record<number, RowOut> = {};
    for (const [ls, items] of Object.entries(inlineByLine)) {
      const ln = Number(ls);
      if (!Number.isFinite(ln)) continue;
      map[ln] ??= { logs: [], result: null, primary: null };
      map[ln].logs.push(...items);
    }
    for (const [ls, v] of Object.entries(resultByLine)) {
      const ln = Number(ls);
      if (!Number.isFinite(ln) || v.t === 'undefined') continue;
      map[ln] ??= { logs: [], result: null, primary: null };
      map[ln].result = v;
    }
    for (const out of Object.values(map)) {
      if (out.result) {
        out.primary = out.result;
      } else if (out.logs.length > 0) {
        for (const log of out.logs) {
          if (log.args && log.args.length > 0) {
            out.primary = log.args[0] ?? null;
            break;
          }
        }
      }
    }
    return map;
  }, [inlineByLine, resultByLine]);

  const toggleLine = (ln: number): void => {
    setExpandedLine((prev) => (prev === ln ? null : ln));
  };

  /* left-edge drag handle */
  const startWidthDrag = (e: React.MouseEvent): void => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    let latest = startW;
    const prevUserSelect = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    const onMove = (ev: MouseEvent): void => {
      latest = Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, startW + (startX - ev.clientX)));
      setWidth(latest);
    };
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = prevUserSelect;
      document.body.style.cursor = prevCursor;
      try { localStorage.setItem(WIDTH_STORAGE_KEY, String(Math.round(latest))); } catch { /* ok */ }
      dragCleanupRef.current = null;
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    dragCleanupRef.current = onUp;
  };

  const total = Math.max(lineCount, 1);
  const filled = Object.keys(rows).length;
  const extra = Math.max(0, viewportH - LINE_HEIGHT_PX);

  return (
    <div
      style={{
        width,
        flexShrink: 0,
        position: 'relative',
        borderLeft: `1px solid ${C.border}`,
        background: 'var(--bg-app)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0
      }}
    >
      {/* ── left-edge resize handle ── */}
      <div
        onMouseDown={startWidthDrag}
        title="Drag to resize"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 4,
          cursor: 'col-resize',
          zIndex: 200,
          background: 'transparent',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(86,156,214,0.35)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      />
      <div
        ref={containerRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          overflowX: 'hidden',
          position: 'relative',
          fontFamily: "'JetBrainsMono Nerd Font Mono', 'Cascadia Mono', Consolas, monospace",
          fontSize: 12,
          lineHeight: `${LINE_HEIGHT_PX}px`
        }}
      >
        {filled === 0 && phase !== 'running' && (
          <div style={{ position: 'absolute', top: 8, left: 10, color: C.dim, fontSize: 11, whiteSpace: 'nowrap' }}>
            outputs appear next to their line
          </div>
        )}
        {Array.from({ length: total }, (_, i) => i + 1).map((ln) => {
          const out = rows[ln];
          if (!out) return <div key={ln} style={{ height: LINE_HEIGHT_PX }} />;
          return (
            <OutputRow
              key={ln}
              out={out}
              ln={ln}
              canExpand={allowExpand}
              expanded={expandedLine === ln}
              onToggle={() => toggleLine(ln)}
            />
          );
        })}
        {extra > 0 && <div style={{ height: extra }} />}
      </div>
    </div>
  );
}
