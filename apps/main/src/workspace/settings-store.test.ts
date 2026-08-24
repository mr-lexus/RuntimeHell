/**
 * Settings store tests (plan todo 21): defaults, round-trip, corrupt-file
 * recovery with backup, unknown-version migration.
 */
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, settingsPath, updateSettings } from './settings-store.js';

let dir = '';
let realAppData: string | undefined;

beforeEach(async () => {
  realAppData = process.env['APPDATA'];
  dir = await mkdtemp(join(tmpdir(), 'rh-settings-'));
  process.env['APPDATA'] = dir;
});

afterEach(async () => {
  if (realAppData !== undefined) process.env['APPDATA'] = realAppData;
  await rm(dir, { recursive: true, force: true });
});

describe('settings store', () => {
  it('returns defaults when the file is missing', async () => {
    const { settings, corruptBackupPath } = await loadSettings();
    expect(settings).toEqual(DEFAULT_SETTINGS);
    expect(corruptBackupPath).toBeNull();
  });

  it('round-trips through save/update', async () => {
    await updateSettings({ prefs: { ...DEFAULT_SETTINGS.prefs, timeoutMs: 9000, autorun: true } });
    const { settings } = await loadSettings();
    expect(settings.prefs.timeoutMs).toBe(9000);
    expect(settings.prefs.autorun).toBe(true);
    expect(settings.prefs.ignoreScripts).toBe(true); // untouched default
  });

  it('recovers from a corrupt file: defaults + backup alongside', async () => {
    await saveSettings(DEFAULT_SETTINGS);
    const path = settingsPath();
    await (await import('node:fs/promises')).writeFile(path, '{ this is not json', 'utf8');

    const { settings, corruptBackupPath } = await loadSettings();
    expect(settings).toEqual(DEFAULT_SETTINGS);
    expect(corruptBackupPath).not.toBeNull();
    const backupText = await readFile(corruptBackupPath!, 'utf8');
    expect(backupText).toContain('this is not json');
    // Only the backup + main file exist in the app-data dir.
    const files = await readdir(join(dir, 'RuntimeHell'));
    expect(files.some((f) => f.startsWith('settings.json.corrupt-'))).toBe(true);
  });

  it('resets unknown newer schema versions to defaults (with backup)', async () => {
    const path = settingsPath();
    await saveSettings({ ...DEFAULT_SETTINGS, schemaVersion: 99 } as never);
    const { settings, corruptBackupPath } = await loadSettings();
    expect(settings.schemaVersion).toBe(1);
    expect(corruptBackupPath).not.toBeNull();
    void path;
  });
});
