/**
 * Capability probes against REAL downloaded engines (plan todo 16 QA happy).
 * Gated by RH_NET_TESTS=1. Installs v8 (rel) + d8-debug via the todo-15
 * downloader, then asserts: rel → astDump=false, bytecodeDump=true;
 * dbg → astDump=true, bytecodeDump=true; node.exe masquerade → all-false.
 */
import { execFile } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { installEngine } from '../binaries/engine-downloader.js';
import { probeV8Binary } from './probe.js';

const RUN = process.env['RH_NET_TESTS'] === '1';
const execFileP = promisify(execFile);

let dir = '';
let nodeExe = '';

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'rh-probe-net-'));
  process.env['RH_CACHE_ROOT'] = dir;
  const { stdout } = await execFileP('where.exe', ['node']);
  const found = stdout.split(/\r?\n/).find((l) => l.trim().toLowerCase().endsWith('.exe'));
  if (found === undefined) throw new Error('node not found');
  nodeExe = found.trim();
});

afterAll(() => {
  delete process.env['RH_CACHE_ROOT'];
});

describe.skipIf(!RUN)('capability probes on real engines (network)', () => {
  it('d8-debug exposes ast+bytecode; release d8 lacks ast', async () => {
    const dbg = await installEngine({ engineId: 'd8-debug' });
    const rel = await installEngine({ engineId: 'v8' });

    const dbgCaps = await probeV8Binary(join(dbg.entry.installedPath ?? '', 'd8.exe'));
    expect(dbgCaps.bytecodeDump).toBe(true);
    expect(dbgCaps.astDump).toBe(true);

    const relCaps = await probeV8Binary(join(rel.entry.installedPath ?? '', 'd8.exe'));
    expect(relCaps.bytecodeDump).toBe(true);
    expect(relCaps.astDump).toBe(false);
  }, 600_000);

  it('node.exe masquerading as an engine fails cleanly to all-false', async () => {
    const caps = await probeV8Binary(nodeExe);
    const featureKeys = Object.keys(caps).filter((k) => k !== 'notes') as (keyof typeof caps)[];
    for (const key of featureKeys) {
      expect(caps[key], `capability ${key} must be false`).toBe(false);
    }
    expect(caps.notes.some((n) => n.includes('not a valid engine binary'))).toBe(true);
  }, 60_000);
});
