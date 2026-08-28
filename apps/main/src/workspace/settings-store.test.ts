/**
 * Settings store tests (plan todo 21): defaults, round-trip, corrupt-file
 * recovery with backup, unknown-version migration.
 */
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
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

  it('migrates schema v1 while applying v2 visual defaults', async () => {
    const path = settingsPath();
    await saveSettings(DEFAULT_SETTINGS, path);
    await writeFile(path, JSON.stringify({ schemaVersion: 1, prefs: { timeoutMs: 9000, autorun: true, ignoreScripts: false }, session: { tabs: [], activeRelPath: null } }), 'utf8');
    const { settings } = await loadSettings(path);
    expect(settings.schemaVersion).toBe(2);
    expect(settings.prefs.timeoutMs).toBe(9000);
    expect(settings.appearance.background).toBe('topology');
  });

  it('adds the Vim editor default when loading an older v2 settings file', async () => {
    const path = settingsPath();
    await writeFile(path, JSON.stringify({ ...DEFAULT_SETTINGS, editor: { fontSize: 13, inlineInspector: true } }), 'utf8');
    const { settings, corruptBackupPath } = await loadSettings(path);
    expect(corruptBackupPath).toBeNull();
    expect(settings.editor.vimMode).toBe(false);
  });

  it('deep-merges independent patches without resetting other sections', async () => {
    await updateSettings({ appearance: { accent: 'amber' } });
    await updateSettings({ prefs: { autorun: true } });
    const { settings } = await loadSettings();
    expect(settings.appearance.accent).toBe('amber');
    expect(settings.prefs.autorun).toBe(true);
  });

  it('persists a custom six-digit accent without changing schema version', async () => {
    await updateSettings({ appearance: { accent: '#ef6c3a' } });
    const { settings } = await loadSettings();
    expect(settings.schemaVersion).toBe(2);
    expect(settings.appearance.accent).toBe('#ef6c3a');
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
    await saveSettings(DEFAULT_SETTINGS, path);
    await writeFile(path, JSON.stringify({ ...DEFAULT_SETTINGS, schemaVersion: 99 }), 'utf8');
    const { settings, corruptBackupPath } = await loadSettings();
    expect(settings.schemaVersion).toBe(2);
    expect(corruptBackupPath).not.toBeNull();
    void path;
  });
});
