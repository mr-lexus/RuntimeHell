/**
 * Run history (plan todo 21): ring buffer of the last 100 runs per workspace,
 * persisted as JSONL (one record per line; corrupt lines skipped on read).
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { workspaceRoot } from './files.js';

export interface HistoryRecord {
  readonly runId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly relPath: string;
  /** Request snapshot: full content for small scratchpads, capped here. */
  readonly contentSnapshot: string;
  readonly status: string;
  readonly exitCode: number | null;
  readonly durationMs: number;
  readonly killedBy: string | null;
}

const MAX_RECORDS = 100;
const MAX_SNAPSHOT_CHARS = 20_000;

function historyPath(workspaceId: string): string {
  return join(workspaceRoot(workspaceId), '.rhhistory.jsonl');
}

export async function appendHistory(workspaceId: string, record: HistoryRecord): Promise<void> {
  const capped: HistoryRecord = {
    ...record,
    contentSnapshot:
      record.contentSnapshot.length > MAX_SNAPSHOT_CHARS
        ? record.contentSnapshot.slice(0, MAX_SNAPSHOT_CHARS)
        : record.contentSnapshot
  };
  const records = await readHistory(workspaceId);
  records.push(capped);
  const trimmed = records.slice(Math.max(0, records.length - MAX_RECORDS));
  await fs.mkdir(join(historyPath(workspaceId), '..'), { recursive: true });
  await fs.writeFile(historyPath(workspaceId), trimmed.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
}

export async function readHistory(workspaceId: string): Promise<HistoryRecord[]> {
  let text: string;
  try {
    text = await fs.readFile(historyPath(workspaceId), 'utf8');
  } catch {
    return [];
  }
  const out: HistoryRecord[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try {
      const parsed = JSON.parse(line) as HistoryRecord;
      if (typeof parsed.runId === 'string' && typeof parsed.finishedAt === 'string') out.push(parsed);
    } catch {
      /* corrupt line skipped — history is best-effort */
    }
  }
  return out;
}
