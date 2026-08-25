/**
 * Updater scaffold (plan todo 31): checks a generic publish feed for a newer
 * version and reports availability. Actual download+apply is intentionally
 * NOT wired — this is the scaffold only; electron-updater integration lands
 * when a real update feed exists.
 */
import { net } from 'electron';
import { app } from 'electron';

export interface UpdateCheckResult {
  readonly currentVersion: string;
  readonly latestVersion: string | null;
  readonly updateAvailable: boolean;
  readonly error: string | null;
}

export async function checkForUpdates(feedUrl: string): Promise<UpdateCheckResult> {
  const currentVersion = app.getVersion();
  try {
    const response = await net.fetch(`${feedUrl}/latest.json`, { method: 'GET' });
    if (!response.ok) {
      return { currentVersion, latestVersion: null, updateAvailable: false, error: `HTTP ${response.status}` };
    }
    const body = (await response.json()) as { version?: string };
    const latestVersion = typeof body.version === 'string' ? body.version : null;
    const updateAvailable = latestVersion !== null && latestVersion !== currentVersion;
    return { currentVersion, latestVersion, updateAvailable, error: null };
  } catch (e) {
    return {
      currentVersion,
      latestVersion: null,
      updateAvailable: false,
      error: e instanceof Error ? e.message : String(e)
    };
  }
}
