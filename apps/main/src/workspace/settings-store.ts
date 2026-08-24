/**
 * Settings store (plan todo 21): %APPDATA%\RuntimeHell\settings.json with
 * versioned migrations. A corrupt file NEVER blocks boot: defaults are used
 * and the corrupt bytes are preserved next to it as *.corrupt-<ts> for
 * manual recovery.
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export interface AppSettings {
  readonly schemaVersion: 1;
  readonly prefs: {
    readonly timeoutMs: number;
    readonly autorun: boolean;
    readonly ignoreScripts: boolean;
    readonly defaultRuntime: 'node';
  };
  /** Session restore payload (todo 21): open tabs + active tab. */
  readonly session: {
    readonly tabs: { readonly workspaceId: string; readonly relPath: string }[];
    readonly activeRelPath: string | null;
  };
}

export const DEFAULT_SETTINGS: AppSettings = {
  schemaVersion: 1,
  prefs: { timeoutMs: 5000, autorun: false, ignoreScripts: true, defaultRuntime: 'node' },
  session: { tabs: [], activeRelPath: null }
};

export function settingsPath(): string {
  const appData = process.env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming');
  return join(appData, 'RuntimeHell', 'settings.json');
}

/** Forward migrations. Unknown/newer versions reset to defaults (backed up). */
function migrate(raw: unknown): AppSettings | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const rec = raw as Record<string, unknown>;
  const version = rec['schemaVersion'];
  if (version === 1) {
    const prefs = (rec['prefs'] ?? {}) as Record<string, unknown>;
    const session = (rec['session'] ?? {}) as Record<string, unknown>;
    return {
      schemaVersion: 1,
      prefs: {
        timeoutMs: typeof prefs['timeoutMs'] === 'number' ? prefs['timeoutMs'] : DEFAULT_SETTINGS.prefs.timeoutMs,
        autorun: typeof prefs['autorun'] === 'boolean' ? prefs['autorun'] : false,
        ignoreScripts: typeof prefs['ignoreScripts'] === 'boolean' ? prefs['ignoreScripts'] : true,
        defaultRuntime: 'node'
      },
      session: {
        tabs: Array.isArray(session['tabs'])
          ? (session['tabs'] as AppSettings['session']['tabs']).filter(
              (t) => typeof t?.workspaceId === 'string' && typeof t?.relPath === 'string'
            )
          : [],
        activeRelPath: typeof session['activeRelPath'] === 'string' ? session['activeRelPath'] : null
      }
    };
  }
  return null; // unknown version → caller backs up + defaults
}

export async function loadSettings(path = settingsPath()): Promise<{ settings: AppSettings; corruptBackupPath: string | null }> {
  let rawText: string | null = null;
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
  await fs.mkdir(join(path, '..'), { recursive: true });
  const tmp = `${path}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(settings, null, 2), 'utf8');
  await fs.rename(tmp, path);
}

/** Read-modify-write helper used by the renderer-facing IPC handlers. */
export async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const { settings } = await loadSettings();
  const next: AppSettings = {
    schemaVersion: 1,
    prefs: patch.prefs ?? settings.prefs,
    session: patch.session ?? settings.session
  };
  await saveSettings(next);
  return next;
}
