/**
 * Report-frame transport plumbing (plan todo 10).
 *
 * Children emit capture frames as `__RH__{json}\n` lines. Two carriers exist:
 *   - stderr sentinel lines (ALWAYS emitted — fd3 is never load-bearing)
 *   - fd 3 NDJSON frames (when the parent probed support and opted in)
 *
 * The splitter reassembles lines across chunk boundaries, extracts sentinel
 * frames, and passes all other text through untouched so the user console
 * never sees protocol traffic.
 */
import type { SerializedValue } from '@rh/protocol';

export type ReportTransport = 'fd3' | 'stderr';

export type ReportPhase = 'immediate' | 'fulfilled' | 'rejected' | 'error';

export interface ReportFrame {
  readonly index: number;
  readonly phase: ReportPhase;
  readonly nonce?: number;
  readonly value?: SerializedValue;
  readonly err?: string;
}

export const SENTINEL_PREFIX = '__RH__' as const;

const REPORT_PHASES: readonly ReportPhase[] = ['immediate', 'fulfilled', 'rejected', 'error'];

interface RawFrame {
  readonly i: number;
  readonly phase: string;
  readonly n?: number;
  readonly v?: SerializedValue;
  readonly err?: string;
}

function isRawFrame(value: unknown): value is RawFrame {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record['i'] === 'number' &&
    Number.isInteger(record['i']) &&
    record['i'] >= 0 &&
    typeof record['phase'] === 'string'
  );
}

/** Parse one sentinel payload (JSON after the prefix). Returns null on garbage. */
export function parseReportFrame(json: string): ReportFrame | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isRawFrame(parsed)) return null;
  const phase = REPORT_PHASES.find((p) => p === parsed.phase);
  if (phase === undefined) return null;
  return {
    index: parsed.i,
    phase,
    nonce: typeof parsed.n === 'number' ? parsed.n : undefined,
    value: parsed.v,
    err: typeof parsed.err === 'string' ? parsed.err : undefined
  };
}

export interface SentinelSplitterHandlers {
  /** Called with the JSON payload of every complete sentinel line. */
  readonly onSentinel: (jsonPayload: string) => void;
  /** Called with non-protocol text (line boundaries normalized to `\n`). */
  readonly onText: (text: string) => void;
}

/**
 * Incremental line router. Feed chunks as they arrive; call flush() when the
 * stream closes so a trailing unterminated line is still routed.
 */
export class SentinelLineSplitter {
  private pending = '';

  constructor(private readonly handlers: SentinelSplitterHandlers) {}

  push(chunk: string): void {
    this.pending += chunk;
    let newlineAt = this.pending.indexOf('\n');
    while (newlineAt !== -1) {
      const line = this.pending.slice(0, newlineAt);
      this.pending = this.pending.slice(newlineAt + 1);
      this.route(line, true);
      newlineAt = this.pending.indexOf('\n');
    }
  }

  flush(): void {
    if (this.pending === '') return;
    const line = this.pending;
    this.pending = '';
    // Unterminated trailing content: no fabricated newline.
    this.route(line, false);
  }

  private route(line: string, terminated: boolean): void {
    if (!line.startsWith(SENTINEL_PREFIX)) {
      this.handlers.onText(terminated ? line + '\n' : line);
      return;
    }
    const payload = line.slice(SENTINEL_PREFIX.length);
    // Unparseable sentinel lines are surfaced as text instead of dropped so
    // protocol bugs remain debuggable in the console.
    if (parseReportFrame(payload) === null) {
      this.handlers.onText(terminated ? line + '\n' : line);
      return;
    }
    this.handlers.onSentinel(payload);
  }
}
