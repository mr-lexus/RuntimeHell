/**
 * Run journal + process-tree kill primitives (plan todo 8, extracted from
 * process-runner.ts in todo 10 to keep units single-purpose).
 *
 * Every spawned run is journaled so a crashed parent can sweep orphaned
 * children on startup. Cancellation uses `taskkill /pid <pid> /T /F` on
 * Windows so the whole tree dies; idempotent, with a direct TerminateProcess
 * fallback when taskkill is stalled or blocked.
 */
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { cacheRoot } from '../binaries/paths.js';

export function treeKill(pid: number): Promise<void> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      try {
        process.kill(pid);
      } catch {
        /* already dead */
      }
      resolve();
      return;
    }
    // Windows: taskkill /T /F kills the whole tree. Some environments stall
    // or block taskkill (security policy, degraded system); fall back to a
    // direct TerminateProcess so cancellation still works. The fallback kills
    // only the target process (not its children) — best effort when taskkill
    // is unavailable.
    const tk = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
    let settled = false;
    let timer: NodeJS.Timeout | null = null;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      resolve();
    };
    const fallback = (): void => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      try {
        process.kill(pid);
      } catch {
        /* already dead */
      }
      resolve();
    };
    timer = setTimeout(fallback, 2000);
    tk.on('error', () => fallback());
    tk.on('close', () => {
      if (settled) return;
      // taskkill can exit without killing (blocked/stalled); verify liveness.
      try {
        process.kill(pid, 0);
        fallback();
      } catch {
        finish();
      }
    });
  });
}

export async function isAlive(pid: number): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      process.kill(pid, 0);
      resolve(true);
    } catch {
      resolve(false);
    }
  });
}

function journalPath(): string {
  return join(cacheRoot(), 'run-journal.json');
}

export interface JournalEntry {
  runId: string;
  pid: number;
  startedAt: string;
  exited: boolean;
}

export async function readJournal(): Promise<JournalEntry[]> {
  try {
    return JSON.parse(await fs.readFile(journalPath(), 'utf8')) as JournalEntry[];
  } catch {
    return [];
  }
}

export async function writeJournal(entries: JournalEntry[]): Promise<void> {
  await fs.mkdir(cacheRoot(), { recursive: true });
  await fs.writeFile(journalPath(), JSON.stringify(entries, null, 2), 'utf8');
}

/** Kill any journaled processes that never reported exit (crash recovery). */
export async function sweepOrphans(): Promise<number> {
  const entries = await readJournal();
  let killed = 0;
  for (const entry of entries) {
    if (!entry.exited && (await isAlive(entry.pid))) {
      await treeKill(entry.pid);
      killed++;
    }
    entry.exited = true;
  }
  await writeJournal([]);
  return killed;
}
