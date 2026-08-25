/**
 * SpiderMonkey dis() parser tests (plan todo 24).
 * Synthetic fixture mirrors the documented table shape; a REAL-binary golden
 * fixture is generated during network QA (t24) and committed alongside.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSmDis } from './sm-dis.js';

const SYNTHETIC = [
  'flags:',
  'loc     op',
  '-----   --',
  'main:',
  '00000 :  GetGName "sum"',
  '00005 :  Call 1',
  '00010 :  Return',
  '',
  'Source notes:',
  'ofs line pc delta desc args'
].join('\n');

describe('parseSmDis', () => {
  it('parses loc/op rows into instructions', () => {
    const parsed = parseSmDis(SYNTHETIC);
    expect(parsed.blocks.length).toBe(1);
    const block = parsed.blocks[0];
    expect(block?.label).toBe('main');
    expect(block?.instructions.map((i) => i.op)).toEqual(['GetGName', 'Call', 'Return']);
    expect(block?.instructions[0]).toMatchObject({ offset: 0, operands: '"sum"' });
  });

  it('keeps source notes separate from instructions', () => {
    const parsed = parseSmDis(SYNTHETIC);
    expect(parsed.blocks[0]?.sourceNotes.join(' ')).toContain('Source notes:');
    expect(parsed.blocks[0]?.instructions.length).toBe(3);
  });

  it('never throws on garbage; unknown lines land in rawLines', () => {
    const parsed = parseSmDis('total garbage\n!!!\n');
    expect(parsed.blocks.length).toBe(0);
    expect(parsed.preambleRaw.join('\n')).toContain('total garbage');
  });
});

describe('parseSmDis — real binary golden (when present)', () => {
  const goldenPath = join(process.cwd(), 'packages', 'engine-parsers', 'fixtures', 'sm-dis.golden.txt');

  it.skipIf(!existsSafe(goldenPath))('parses the committed real-shell dump', () => {
    const parsed = parseSmDis(readFileSync(goldenPath, 'utf8'));
    expect(parsed.blocks.length).toBeGreaterThanOrEqual(1);
    expect(parsed.blocks.some((b) => b.instructions.length > 0)).toBe(true);
  });

  function existsSafe(p: string): boolean {
    try {
      readFileSync(p);
      return true;
    } catch {
      return false;
    }
  }
});
