import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { findShasum, parseShasums } from './shasums.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'rh-shasums-'));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('parseShasums', () => {
  it('parses standard SHASUMS256.txt lines', () => {
    const text = [
      'a'.repeat(64) + '  node-v22.17.0-win-x64.zip',
      'b'.repeat(64) + '  node-v22.17.0-win-x64.7z',
      '',
      'garbage line without hash'
    ].join('\n');
    const entries = parseShasums(text);
    expect(entries.length).toBe(2);
    expect(findShasum(entries, 'node-v22.17.0-win-x64.zip')).toBe('a'.repeat(64));
    expect(findShasum(entries, 'missing.zip')).toBeNull();
  });

  it('accepts binary-mode asterisk prefix', () => {
    const text = 'c'.repeat(64) + ' *file.zip\n';
    expect(findShasum(parseShasums(text), 'file.zip')).toBe('c'.repeat(64));
  });
});
