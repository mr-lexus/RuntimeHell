/**
 * Run journal + process-tree kill primitives (plan todo 8, extracted from
 * process-runner.ts in todo 10 to keep units single-purpose).
 *
 * Every spawned run is journaled so a crashed parent can sweep orphaned
 * children on startup. Cancellation uses `taskkill /pid <pid> /T /F` on
 * Windows and detached process-group signals on POSIX.
 */
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { cacheRoot } from '../binaries/paths.js';

export function treeKill(pid: number): Promise<void> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      // Children are started detached on POSIX, so signal the whole process
      // group first and fall back to the individual pid for older runtimes.
      try { process.kill(-pid, 'SIGTERM'); } catch {
        try { process.kill(pid, 'SIGTERM'); } catch { /* already dead */ }
      }
      const timer = setTimeout(() => {
        try { process.kill(-pid, 'SIGKILL'); } catch {
          try { process.kill(pid, 'SIGKILL'); } catch { /* already dead */ }
        }
      }, 1000);
      timer.unref?.();
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

const JournalEntrySchema = z.object({
  runId: z.string().min(8),
  pid: z.number().int().positive(),
  startedAt: z.string().refine((value) => Number.isFinite(Date.parse(value)), 'invalid start time'),
  exited: z.boolean()
}).strict();

const MAX_ORPHAN_AGE_MS = 24 * 60 * 60 * 1000;

export function isRecentJournalEntry(entry: JournalEntry, nowMs = Date.now()): boolean {
  const startedAt = Date.parse(entry.startedAt);
  const age = nowMs - startedAt;
  return Number.isFinite(age) && age >= 0 && age <= MAX_ORPHAN_AGE_MS;
}

export async function readJournal(): Promise<JournalEntry[]> {
  try {
    const raw: unknown = JSON.parse(await fs.readFile(journalPath(), 'utf8'));
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((entry) => {
      const parsed = JournalEntrySchema.safeParse(entry);
      return parsed.success ? [parsed.data] : [];
    });
  } catch {
    return [];
  }
}

export async function writeJournal(entries: JournalEntry[]): Promise<void> {
  const run = journalMutation.then(() => writeJournalNow(entries), () => writeJournalNow(entries));
  journalMutation = run.then(() => undefined, () => undefined);
  return run;
}

async function writeJournalNow(entries: JournalEntry[]): Promise<void> {
  const validated = entries.map((entry) => JournalEntrySchema.parse(entry));
  const path = journalPath();
  const tmp = `${path}.tmp`;
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(tmp, JSON.stringify(validated, null, 2), 'utf8');
  await fs.rename(tmp, path);
}

let journalMutation: Promise<void> = Promise.resolve();

/** Serialize read/modify/write journal updates so async process exits cannot
 * resurrect stale entries after an orphan sweep. */
export function updateJournal(mutator: (entries: JournalEntry[]) => void | Promise<void>): Promise<void> {
  const run = journalMutation.then(async () => {
    const entries = await readJournal();
    await mutator(entries);
    await writeJournalNow(entries);
  }, async () => {
    const entries = await readJournal();
    await mutator(entries);
    await writeJournalNow(entries);
  });
  journalMutation = run.then(() => undefined, () => undefined);
  return run;
}

/** Kill any journaled processes that never reported exit (crash recovery). */
export async function sweepOrphans(): Promise<number> {
  let killed = 0;
  await updateJournal(async (entries) => {
    for (const entry of entries) {
      // PIDs are reusable. Never signal an old journal entry that may now
      // identify an unrelated process after a long gap between app launches.
      if (!entry.exited && isRecentJournalEntry(entry) && (await isAlive(entry.pid))) {
        await treeKill(entry.pid);
        killed++;
      }
      entry.exited = true;
    }
    entries.splice(0, entries.length);
  });
  return killed;
}
