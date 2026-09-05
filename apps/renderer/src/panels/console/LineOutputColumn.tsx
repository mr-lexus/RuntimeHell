import { useEffect, useMemo, useRef, useState } from 'react';
import { useRun, type InlineConsoleEntry } from '../../state/run';
import type { EditorScrollController } from '../../editor/CodeEditor';
import type { SerializedValue } from '@rh/protocol';
import { detectConsoleTable, detectTable, type TableShape } from './table-shape';

/** Default line step used when the column is rendered outside WorkbenchShell. */
export const LINE_HEIGHT_PX = 20;

/* ── colour palette (VSCode-dark-inspired) ───────────────────────────── */

const C = {
  str: 'var(--rh-value-string, #d99a78)',
  num: 'var(--rh-value-number, #9fca9f)',
  bool: 'var(--rh-value-bool, var(--accent-strong))',
  nil: 'var(--rh-value-null, var(--accent-strong))',
  sym: 'var(--rh-value-symbol, #c5a0d8)',
  fn: 'var(--rh-value-function, var(--warn))',
  cls: 'var(--rh-value-class, #72c5b3)',
  err: 'var(--err)',
  date: 'var(--rh-value-date, #d99a78)',
  re: 'var(--rh-value-regexp, #d47a87)',
  coll: 'var(--rh-value-collection, var(--accent))',
  key: 'var(--rh-value-key, var(--accent-strong))',
  proto: 'var(--accent)',
  protoBorder: 'color-mix(in srgb, var(--accent) 40%, transparent)',
  dim: 'var(--text-dim)',
  ok: 'var(--ok)',
  warn: 'var(--warn)',
  errBg: 'color-mix(in srgb, var(--err) 12%, transparent)',
  warnBg: 'color-mix(in srgb, var(--warn) 12%, transparent)',
  hover: 'color-mix(in srgb, var(--bg-hover) 70%, transparent)',
  border: 'var(--border)',
  panel: 'var(--bg-panel)',
  result: 'var(--result)',
  rowBg: 'color-mix(in srgb, var(--accent) 6%, transparent)',
  tblHead: 'color-mix(in srgb, var(--accent) 10%, transparent)',
  tblAlt: 'color-mix(in srgb, var(--text) 2.5%, transparent)',
};

/* ── column width (draggable) ────────────────────────────────────────── */

const WIDTH_MIN = 96;
const WIDTH_DEFAULT = 340;
const WIDTH_STORAGE_KEY = 'rh.inspector-width';

function readStoredWidth(): number {
  try {
    const raw = localStorage.getItem(WIDTH_STORAGE_KEY);
    const n = raw === null ? NaN : Number(raw);
    if (Number.isFinite(n)) return Math.max(WIDTH_MIN, n);
  } catch {
    /* storage unavailable — fall through to default */
  }
  return WIDTH_DEFAULT;
}

function maxWidthForRegion(element: HTMLElement | null): number {
  const region = element?.closest<HTMLElement>('.rh-editor-region');
  if (!region) return Number.POSITIVE_INFINITY;
  // Keep a small usable slice for the editor, but do not impose a fixed
  // inspector maximum: the available width changes with the window.
  return Math.max(WIDTH_MIN, region.clientWidth - WIDTH_MIN);
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
  if (v.t === 'array') return `Array exotic object(${v.size ?? v.children?.length ?? 0})`;
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
    case 'array': return `Array exotic object(${v.size ?? v.children?.length ?? 0})`;
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
        {'›'} {shape.rows.length} rows × {shape.headers.length} cols
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

  const keySpan = proto
    ? <><span style={{ color: C.proto, fontSize: 11, fontWeight: 600, fontStyle: 'italic' }}>[[Prototype]]</span><span style={{ color: C.dim, fontSize: 11 }}> → </span><span style={{ color: C.proto, fontSize: 11, fontWeight: 600 }}>{protoLabel}</span></>
    : <span style={{ color: C.key, fontSize: 11 }}>{k}{sep}{' '}</span>;

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

function OutputRow({ out, ln, canExpand, expanded, onToggle, lineHeight }: {
  out: RowOut;
  ln: number;
  canExpand: boolean;
  expanded: boolean;
  onToggle: () => void;
  lineHeight: number;
}): React.JSX.Element {
  const isTableEntry = out.logs.some((entry) => entry.level === 'table');
  const tableEntry = out.logs.find((entry) => entry.level === 'table');
  const table = tableEntry?.args
    ? detectConsoleTable(tableEntry.args)
    : isTableEntry && out.primary
      ? detectTable(out.primary)
      : null;
  const consoleValues = out.logs.flatMap((entry) => entry.args ?? []);
  const detailValues = [
    ...consoleValues,
    ...(out.result
      ? [out.result]
      : consoleValues.length === 0 && out.primary
        ? [out.primary]
        : []),
  ];
  const hasExpand = canExpand && (table !== null || detailValues.some((value) => isExpandable(value)));

  const tableLabel = (entry: InlineConsoleEntry): string => {
    if (entry.level === 'table' && entry.args && entry.args.length > 0) {
      const shape = detectConsoleTable(entry.args);
      const n = shape?.rows.length ?? entry.args[0]?.size ?? entry.args[0]?.children?.length ?? '?';
      return `◀ Table (${n} rows)`;
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
          height: lineHeight,
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
            {expanded ? '⌄' : '›'}
          </span>
        )}
      </div>

      {/* ── expanded inspector (INLINE — no portal needed) ── */}
      {expanded && detailValues.length > 0 && (
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
            : detailValues.map((value, index) => (
              <div key={index} style={{ marginTop: detailValues.length > 1 && index > 0 ? 6 : 0 }}>
                {detailValues.length > 1 && (
                  <div style={{ color: C.dim, fontSize: 10, margin: '0 0 2px 14px' }}>argument {index + 1}</div>
                )}
                <Tree node={value} />
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

/* ── main column ─────────────────────────────────────────────────────── */

export function LineOutputColumn({
  lineCount,
  scrollTop,
  allowExpand,
  fileId,
  lineHeight = LINE_HEIGHT_PX,
  scrollController
}: {
  lineCount: number;
  scrollTop: number;
  allowExpand: boolean;
  fileId: string | null;
  lineHeight?: number;
  scrollController?: EditorScrollController;
}): React.JSX.Element {
  const inlineByLine = useRun((s) => s.inlineByLine);
  const resultByLine = useRun((s) => s.resultByLine);
  const runFileId = useRun((s) => s.runFileId);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [expandedLine, setExpandedLine] = useState<number | null>(null);
  const [width, setWidth] = useState<number>(readStoredWidth);
  const [viewportH, setViewportH] = useState<number>(0);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const rowHeight = Math.max(18, lineHeight);

  /* Track visible height so the translated output surface covers Monaco's
     viewport even when the source is shorter than the editor region. */
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

  // A stored width may have been created on a larger window. Clamp it only
  // when the current editor region is known, and keep it in sync while the
  // window is resized.
  useEffect(() => {
    const el = containerRef.current;
    const region = el?.closest<HTMLElement>('.rh-editor-region');
    if (!region) return;
    const fitToRegion = (): void => setWidth((current) => Math.min(current, maxWidthForRegion(el)));
    const ro = new ResizeObserver(fitToRegion);
    ro.observe(region);
    fitToRegion();
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
    if (fileId === null || runFileId !== fileId) return {};
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
            out.primary = log.args.find((arg) => isExpandable(arg)) ?? log.args[0] ?? null;
            break;
          }
        }
      }
    }
    return map;
  }, [fileId, inlineByLine, resultByLine, runFileId]);

  const toggleLine = (ln: number): void => {
    setExpandedLine((prev) => (prev === ln ? null : ln));
  };

  /* left-edge drag handle */
  const startWidthDrag = (e: React.PointerEvent<HTMLDivElement>): void => {
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture?.(e.pointerId);
    const startX = e.clientX;
    const startW = width;
    let latest = startW;
    const prevUserSelect = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    const onMove = (ev: PointerEvent): void => {
      latest = Math.min(maxWidthForRegion(containerRef.current), Math.max(WIDTH_MIN, startW + (startX - ev.clientX)));
      setWidth(latest);
    };
    const onUp = (): void => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      if (handle.hasPointerCapture?.(e.pointerId)) handle.releasePointerCapture(e.pointerId);
      document.body.style.userSelect = prevUserSelect;
      document.body.style.cursor = prevCursor;
      try { localStorage.setItem(WIDTH_STORAGE_KEY, String(Math.round(latest))); } catch { /* ok */ }
      dragCleanupRef.current = null;
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
    dragCleanupRef.current = onUp;
  };

  const nudgeWidth = (delta: number): void => {
    setWidth((current) => {
      const next = Math.min(maxWidthForRegion(containerRef.current), Math.max(WIDTH_MIN, current + delta));
      try { localStorage.setItem(WIDTH_STORAGE_KEY, String(Math.round(next))); } catch { /* ok */ }
      return next;
    });
  };

  const forwardWheel = (event: React.WheelEvent<HTMLDivElement>): void => {
    if (!scrollController || event.deltaY === 0) return;
    const deltaY = event.deltaMode === 1
      ? event.deltaY * rowHeight
      : event.deltaMode === 2
        ? event.deltaY * Math.max(viewportH, rowHeight)
        : event.deltaY;
    event.preventDefault();
    scrollController.scrollBy(deltaY);
  };

  const total = Math.max(lineCount, 1);
  // Keep one stable scroll surface sized like Monaco, but only mount rows
  // that actually contain output. Rendering an empty div for every source
  // line made tab switches visibly paint the inspector one line at a time.
  const contentHeight = Math.max(total * rowHeight, viewportH) + (expandedLine === null ? 0 : 420);
  const outputRows = Object.entries(rows)
    .map(([line, out]) => [Number(line), out] as const)
    .sort(([a], [b]) => a - b);

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
        minHeight: 0,
        height: '100%',
      }}
      onWheel={forwardWheel}
    >
      {/* ── left-edge resize handle ── */}
      <div
        onPointerDown={startWidthDrag}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') { e.preventDefault(); nudgeWidth(16); }
          if (e.key === 'ArrowRight') { e.preventDefault(); nudgeWidth(-16); }
        }}
        title="Drag to resize"
        aria-label="Resize line output panel"
        role="separator"
        aria-orientation="vertical"
        tabIndex={0}
        style={{
          position: 'absolute',
          left: -4,
          top: 0,
          bottom: 0,
          width: 8,
          cursor: 'col-resize',
          zIndex: 200,
          background: 'transparent',
          touchAction: 'none',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(86,156,214,0.35)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      />
      <div
        ref={containerRef}
        style={{
          flex: 1,
          // Monaco is the canonical scroll surface for this column.  Keep
          // the output viewport clipped and move its content by Monaco's
          // scrollTop rather than maintaining a second independent scrollbar.
          overflowY: 'hidden',
          overflowX: 'hidden',
          position: 'relative',
          fontFamily: "'JetBrainsMono Nerd Font Mono', 'Cascadia Mono', Consolas, monospace",
          fontSize: 12,
          lineHeight: `${rowHeight}px`
        }}
      >
        <div
          style={{
            position: 'relative',
            width: '100%',
            height: contentHeight,
            minHeight: contentHeight,
            // Keep line N at the same y-coordinate as Monaco line N.
            transform: `translate3d(0, -${Math.max(0, scrollTop)}px, 0)`,
            willChange: 'transform'
          }}
        >
          {outputRows.map(([ln, out]) => (
            <div key={ln} style={{ position: 'absolute', top: (ln - 1) * rowHeight, left: 0, right: 0, minHeight: rowHeight, zIndex: expandedLine === ln ? 2 : 1 }}>
              <OutputRow
                out={out}
                ln={ln}
                canExpand={allowExpand}
                expanded={expandedLine === ln}
                onToggle={() => toggleLine(ln)}
                lineHeight={rowHeight}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
