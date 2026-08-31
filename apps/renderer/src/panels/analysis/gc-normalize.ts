export interface NormalizedGcEvent {
  timestampMs: number;
  kind: string;
  beforeUsedMb: number;
  beforeTotalMb: number;
  afterUsedMb: number;
  afterTotalMb: number;
  pauseMs: number;
  secondaryPauseMs: number;
  details: string;
  reason: string;
}

const GC_LINE_RE = /^\s*(?:\[[^\]]+\]\s+)?([\d.]+)\s+ms:\s+([A-Za-z][\w-]*)\s+([\d.]+)\s+\(([\d.]+)\)\s+->\s+([\d.]+)\s+\(([\d.]+)\)\s+MB,\s+(?:pooled:\s+[\d.]+\s+MB,\s+)?([\d.]+)\s+\/\s+([\d.]+)\s+ms(?:\s+\(([^)]*)\))?(?:\s+(.*?))?;?\s*$/i;

/** Parse V8 --trace-gc lines into compact, sortable GC events. */
export function parseV8Gc(raw: string): NormalizedGcEvent[] {
  const events: NormalizedGcEvent[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const match = GC_LINE_RE.exec(line);
    if (match === null) continue;
    const numberAt = (index: number): number => Number(match[index] ?? 0);
    events.push({
      timestampMs: numberAt(1),
      kind: match[2] ?? 'GC',
      beforeUsedMb: numberAt(3),
      beforeTotalMb: numberAt(4),
      afterUsedMb: numberAt(5),
      afterTotalMb: numberAt(6),
      pauseMs: numberAt(7),
      secondaryPauseMs: numberAt(8),
      details: (match[9] ?? '').trim(),
      reason: (match[10] ?? '').replace(/;$/, '').trim()
    });
  }
  return events;
}
