/**
 * History ring + workspace store tests (plan todo 21).
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendHistory, readHistory, type HistoryRecord } from './history.js';
import { createWorkspace, deleteWorkspace, listWorkspaces } from './workspace-store.js';

let userProfileBackup: string | undefined;
let posixHomeBackup: string | undefined;
let sandbox = '';

beforeEach(async () => {
  userProfileBackup = process.env['USERPROFILE'];
  posixHomeBackup = process.env['HOME'];
  sandbox = await mkdtemp(join(tmpdir(), 'rh-hist-'));
  process.env['USERPROFILE'] = sandbox;
  if (process.platform !== 'win32') process.env['HOME'] = sandbox;
});

afterEach(async () => {
  if (userProfileBackup !== undefined) process.env['USERPROFILE'] = userProfileBackup;
  else delete process.env['USERPROFILE'];
  if (posixHomeBackup !== undefined) process.env['HOME'] = posixHomeBackup;
  else delete process.env['HOME'];
  await rm(sandbox, { recursive: true, force: true });
});

function record(n: number): HistoryRecord {
  return {
    runId: `run-${n}`,
    startedAt: new Date(2026, 0, 1, 0, 0, n).toISOString(),
    finishedAt: new Date(2026, 0, 1, 0, 0, n + 1).toISOString(),
    relPath: 'entry.ts',
    contentSnapshot: `console.log(${n});`,
    status: 'completed',
    exitCode: 0,
    durationMs: n,
    killedBy: null
  };
}

describe('history ring', () => {
  it('appends and reads back records', async () => {
    await appendHistory('default', record(1));
    await appendHistory('default', record(2));
    const records = await readHistory('default');
    expect(records.map((r) => r.runId)).toEqual(['run-1', 'run-2']);
  });

  it('caps at 100 records keeping the NEWEST', async () => {
    for (let i = 1; i <= 120; i++) {
      await appendHistory('default', record(i));
    }
    const records = await readHistory('default');
    expect(records.length).toBe(100);
    expect(records[0]?.runId).toBe('run-21');
    expect(records.at(-1)?.runId).toBe('run-120');
  });

  it('skips corrupt JSONL lines instead of throwing', async () => {
    await appendHistory('default', record(1));
    const { writeFile } = await import('node:fs/promises');
    const path = join(sandbox, 'RuntimeHell', 'workspaces', 'default', '.rhhistory.jsonl');
    await writeFile(path, '{"runId":"run-1"\n' + JSON.stringify(record(2)) + '\n', 'utf8');
    const records = await readHistory('default');
    expect(records.map((r) => r.runId)).toEqual(['run-2']);
  });
});

describe('workspace store', () => {
  it('creates a workspace with generated id + meta', async () => {
    const meta = await createWorkspace(undefined, 'my playground');
    expect(meta.id).toMatch(/^[A-Za-z0-9]{12}$/);
    expect(meta.name).toBe('my playground');
    const listed = await listWorkspaces();
    expect(listed.some((w) => w.id === meta.id)).toBe(true);
  });

  it('delete removes the directory from listings', async () => {
    const meta = await createWorkspace();
    await deleteWorkspace(meta.id);
    expect((await listWorkspaces()).some((w) => w.id === meta.id)).toBe(false);
  });
});
