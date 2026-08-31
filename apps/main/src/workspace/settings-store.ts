/** Versioned RuntimeHell preferences stored in %APPDATA%/RuntimeHell. */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  AppSettingsSchema,
  SettingsPatchSchema,
  type AppSettings,
  type SettingsPatch
} from '@rh/protocol';

export type { AppSettings, SettingsPatch } from '@rh/protocol';

export const DEFAULT_SETTINGS: AppSettings = AppSettingsSchema.parse({
  schemaVersion: 2,
  prefs: { timeoutMs: 5000, autorun: false, ignoreScripts: true, defaultRuntime: 'node' },
  appearance: {
    theme: 'dark', accent: 'cyan', background: 'topology', intensity: 'standard', motion: 'system', density: 'compact', uiScale: 100
  },
  editor: {
    fontSize: 13,
    fontLigatures: true,
    tabSize: 2,
    insertSpaces: true,
    wordWrap: 'off',
    lineNumbers: 'on',
    minimap: false,
    folding: true,
    renderWhitespace: 'selection',
    bracketPairColorization: true,
    smoothScrolling: true,
    stickyScroll: false,
    cursorStyle: 'line',
    inlineInspector: true,
    vimMode: false
  },
  layout: { drawerOpen: true, drawerRatio: 0.35, drawerTab: 'console', inlineOutputWidth: 320 },
  session: { tabs: [], activeRelPath: null }
});

export function settingsPath(): string {
  const appData = process.env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming');
  return join(appData, 'RuntimeHell', 'settings.json');
}

type LegacySettings = {
  schemaVersion?: unknown;
  prefs?: { timeoutMs?: unknown; autorun?: unknown; ignoreScripts?: unknown };
  session?: { tabs?: unknown; activeRelPath?: unknown };
};

function legacyToV2(raw: LegacySettings): AppSettings {
  const prefs = raw.prefs ?? {};
  const session = raw.session ?? {};
  return {
    ...DEFAULT_SETTINGS,
    prefs: {
      ...DEFAULT_SETTINGS.prefs,
      timeoutMs: typeof prefs.timeoutMs === 'number' && prefs.timeoutMs > 0 ? Math.round(prefs.timeoutMs) : DEFAULT_SETTINGS.prefs.timeoutMs,
      autorun: typeof prefs.autorun === 'boolean' ? prefs.autorun : DEFAULT_SETTINGS.prefs.autorun,
      ignoreScripts: typeof prefs.ignoreScripts === 'boolean' ? prefs.ignoreScripts : DEFAULT_SETTINGS.prefs.ignoreScripts
    },
    session: {
      tabs: Array.isArray(session.tabs)
        ? (session.tabs as AppSettings['session']['tabs']).filter((tab) => typeof tab?.workspaceId === 'string' && typeof tab?.relPath === 'string')
        : [],
      activeRelPath: typeof session.activeRelPath === 'string' ? session.activeRelPath : null
    }
  };
}

function migrate(raw: unknown): AppSettings | null {
  const current = AppSettingsSchema.safeParse(raw);
  if (current.success) return current.data;
  if (typeof raw !== 'object' || raw === null) return null;
  const legacy = raw as LegacySettings;
  return legacy.schemaVersion === 1 ? legacyToV2(legacy) : null;
}

export async function loadSettings(path = settingsPath()): Promise<{ settings: AppSettings; corruptBackupPath: string | null }> {
  let rawText: string;
  try {
    rawText = await fs.readFile(path, 'utf8');
  } catch {
    return { settings: DEFAULT_SETTINGS, corruptBackupPath: null };
  }
  try {
    const migrated = migrate(JSON.parse(rawText));
    if (migrated !== null) return { settings: migrated, corruptBackupPath: null };
  } catch {
    /* fall through to corrupt handling */
  }
  const backupPath = `${path}.corrupt-${Date.now()}`;
  await fs.writeFile(backupPath, rawText, 'utf8');
  return { settings: DEFAULT_SETTINGS, corruptBackupPath: backupPath };
}

export async function saveSettings(settings: AppSettings, path = settingsPath()): Promise<void> {
  const parsed = AppSettingsSchema.parse(settings);
  await fs.mkdir(join(path, '..'), { recursive: true });
  const tmp = `${path}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(parsed, null, 2), 'utf8');
  await fs.rename(tmp, path);
}

function mergeSection<T extends object>(current: T, patch: Partial<T> | undefined): T {
  return patch === undefined ? current : { ...current, ...patch };
}

function mergeSettings(settings: AppSettings, patch: SettingsPatch): AppSettings {
  return AppSettingsSchema.parse({
    ...settings,
    prefs: mergeSection(settings.prefs, patch.prefs),
    appearance: mergeSection(settings.appearance, patch.appearance),
    editor: mergeSection(settings.editor, patch.editor),
    layout: mergeSection(settings.layout, patch.layout),
    session: mergeSection(settings.session, patch.session)
  });
}

let writeQueue: Promise<AppSettings> = Promise.resolve(DEFAULT_SETTINGS);

/** Read-modify-write helper with deep section merge and serialized writes. */
export function updateSettings(patchInput: unknown): Promise<AppSettings> {
  const patch = SettingsPatchSchema.parse(patchInput ?? {});
  writeQueue = writeQueue.catch(() => DEFAULT_SETTINGS).then(async () => {
    const { settings } = await loadSettings();
    const next = mergeSettings(settings, patch);
    await saveSettings(next);
    return next;
  });
  return writeQueue;
}
