import { FixedSizeList, type ListChildComponentProps } from 'react-window';
import { useMemo, useState } from 'react';
import { useRun } from '../../state/run';
import { flattenValue } from './inspector-tree';

const ROW_HEIGHT = 20;
const GUTTER = '  ';

/**
 * Virtualized value inspector (plan todo 11): renders ResultCapture reports
 * as an expandable tree. Rows are windowed so 5000-node serializations stay
 * smooth; expansion state lives per root index.
 */
export function InspectorPanel(): React.JSX.Element {
  const reports = useRun((s) => s.reports);
  const [expandedByRoot, setExpanded] = useState<Record<number, ReadonlySet<string>>>({});

  const rowsByRoot = useMemo(() => {
    const map = new Map<number, ReturnType<typeof flattenValue>>();
    for (const report of reports) {
      const expanded = expandedByRoot[report.index] ?? new Set<string>(['root']);
      map.set(report.index, flattenValue(report.value, expanded));
    }
    return map;
  }, [reports, expandedByRoot]);

  const toggle = (rootIndex: number, key: string): void => {
    setExpanded((prev) => {
      const current = new Set(prev[rootIndex] ?? ['root']);
      if (current.has(key)) {
        current.delete(key);
      } else {
        current.add(key);
      }
      return { ...prev, [rootIndex]: current };
    });
  };

  if (reports.length === 0) {
    return <div style={{ color: '#777', fontFamily: 'monospace' }}>No captured values yet — run the file.</div>;
  }

  const allRows: { rootIndex: number; row: (typeof rowsByRoot extends Map<number, infer R> ? R : never)[number] }[] = [];
  for (const report of reports) {
    for (const row of rowsByRoot.get(report.index) ?? []) {
      allRows.push({ rootIndex: report.index, row });
    }
  }

  const Row = ({ index, style }: ListChildComponentProps): React.JSX.Element => {
    const item = allRows[index];
    if (!item) return <div style={style} />;
    const arrow = item.row.hasChildren ? '▸' : '';
    return (
      <div
        style={{
          ...style,
          display: 'flex',
          alignItems: 'center',
          fontFamily: 'monospace',
          fontSize: 12,
          whiteSpace: 'pre',
          cursor: item.row.hasChildren ? 'pointer' : 'default',
          color: item.row.depth === 0 ? '#9cdcfe' : '#bbb'
        }}
        onClick={() => item.row.hasChildren && toggle(item.rootIndex, item.row.key)}
      >
        <span style={{ width: 34, color: '#569cd6', textAlign: 'right', marginRight: 8 }}>
          {item.row.depth === 0 ? `#${item.rootIndex}` : ''}
        </span>
        <span style={{ width: 12, color: '#666' }}>{arrow}</span>
        <span>
          {item.row.depth > 0 ? `${GUTTER.repeat(item.row.depth - 1)}${item.row.childKey}: ` : ''}
          {item.row.label}
        </span>
      </div>
    );
  };

  return (
    <FixedSizeList height={400} itemCount={allRows.length} itemSize={ROW_HEIGHT} width="100%">
      {Row}
    </FixedSizeList>
  );
}
