import { List, type RowComponentProps } from 'react-window';
import { useCallback, useMemo, useState } from 'react';
import { useRun } from '../../state/run';
import { flattenValue } from './inspector-tree';

const ROW_HEIGHT = 20;
const GUTTER = '  ';

/**
 * Virtualized value inspector (plan todo 11): renders ResultCapture reports
 * as an expandable tree. Rows are windowed so 5000-node serializations stay
 * smooth; expansion state lives per root index.
 */
interface InspectorPanelProps {
  /** Source slot whose captured values are currently being inspected. */
  fileId?: string | null;
}

type FlattenedRow = ReturnType<typeof flattenValue>[number];
interface InspectorRowItem {
  rootIndex: number;
  row: FlattenedRow;
}
interface InspectorRowProps {
  items: InspectorRowItem[];
  onToggle: (rootIndex: number, key: string) => void;
}

function InspectorRow({ ariaAttributes, index, items, onToggle, style }: RowComponentProps<InspectorRowProps>): React.JSX.Element {
  const item = items[index];
  if (!item) return <div {...ariaAttributes} style={style} />;
  const isPrototype = item.row.isPrototype;
  const arrow = item.row.hasChildren ? (item.row.isExpanded ? '⌄' : '›') : '';
  return (
    <div
      {...ariaAttributes}
      style={{
        ...style,
        display: 'flex',
        alignItems: 'center',
        fontFamily: "'JetBrainsMono Nerd Font Mono', monospace",
        fontSize: 12,
        whiteSpace: 'pre',
        cursor: item.row.hasChildren ? 'pointer' : 'default',
        color: item.row.depth === 0 ? 'var(--accent-strong)' : isPrototype ? 'var(--accent)' : 'var(--text-secondary)',
        fontWeight: isPrototype ? 600 : 400,
        borderLeft: isPrototype ? '2px solid var(--accent)' : '2px solid transparent',
        background: isPrototype ? 'color-mix(in srgb, var(--accent) 6%, transparent)' : 'transparent'
      }}
      onClick={() => item.row.hasChildren && onToggle(item.rootIndex, item.row.key)}
    >
      <span style={{ width: 34, color: 'var(--accent)', textAlign: 'right', marginRight: 8 }}>
        {item.row.depth === 0 ? `#${item.rootIndex}` : ''}
      </span>
      <span style={{ width: 12, color: 'var(--text-faint)' }}>{arrow}</span>
      <span>
        {item.row.depth > 0 && (isPrototype
          ? <><span style={{ fontStyle: 'italic' }}>[[Prototype]]</span><span style={{ color: 'var(--text-faint)', fontWeight: 400 }}> → </span><span>{item.row.label}</span></>
          : `${GUTTER.repeat(item.row.depth - 1)}${item.row.childKey}: `)}
        {item.row.depth === 0 || !isPrototype ? item.row.label : null}
      </span>
    </div>
  );
}

export function InspectorPanel({ fileId }: InspectorPanelProps): React.JSX.Element {
  const reports = useRun((s) => s.reports);
  const runFileId = useRun((s) => s.runFileId);
  // Reports belong to a run/source slot. Do not show the previous tab's
  // captures after the user switches source tabs.
  const visibleReports = fileId === undefined || (fileId !== null && runFileId === fileId) ? reports : [];
  const [expandedByRoot, setExpanded] = useState<Record<number, ReadonlySet<string>>>({});

  const rowsByRoot = useMemo(() => {
    const map = new Map<number, ReturnType<typeof flattenValue>>();
    for (const report of visibleReports) {
      const expanded = expandedByRoot[report.index] ?? new Set<string>(['root']);
      map.set(report.index, flattenValue(report.value, expanded));
    }
    return map;
  }, [visibleReports, expandedByRoot]);

  const toggle = useCallback((rootIndex: number, key: string): void => {
    setExpanded((prev) => {
      const current = new Set(prev[rootIndex] ?? ['root']);
      if (current.has(key)) {
        current.delete(key);
      } else {
        current.add(key);
      }
      return { ...prev, [rootIndex]: current };
    });
  }, []);

  const allRows = useMemo(() => {
    const flattened: InspectorRowItem[] = [];
    for (const report of visibleReports) {
      for (const row of rowsByRoot.get(report.index) ?? []) {
        flattened.push({ rootIndex: report.index, row });
      }
    }
    return flattened;
  }, [rowsByRoot, visibleReports]);

  if (visibleReports.length === 0) {
    return <div className="rh-inspector-empty">No captured values yet — run the file.</div>;
  }

  return (
    <List
      rowComponent={InspectorRow}
      rowCount={allRows.length}
      rowHeight={ROW_HEIGHT}
      rowProps={{ items: allRows, onToggle: toggle }}
      style={{ height: 400, width: '100%' }}
    />
  );
}
