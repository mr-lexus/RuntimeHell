#!/usr/bin/env node
/**
 * Cross-platform smoke test for the built Electron app.
 * It intentionally exercises native config/cache paths and a real child
 * process, without downloading optional engines or runtimes.
 */
import { _electron as electron } from 'playwright';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const tempHome = await mkdtemp(join(tmpdir(), 'rh-compat-home-'));
const cache = await mkdtemp(join(tmpdir(), 'rh-compat-cache-'));
const env = { ...process.env, RH_CACHE_ROOT: cache };
if (process.platform === 'win32') {
  env.USERPROFILE = tempHome;
  env.APPDATA = join(tempHome, 'AppData', 'Roaming');
  env.LOCALAPPDATA = join(tempHome, 'AppData', 'Local');
  await mkdir(env.APPDATA, { recursive: true });
  await mkdir(env.LOCALAPPDATA, { recursive: true });
} else if (process.platform === 'darwin') {
  env.HOME = tempHome;
  env.XDG_CONFIG_HOME = join(tempHome, 'Library', 'Application Support');
  env.XDG_CACHE_HOME = join(tempHome, 'Library', 'Caches');
  await mkdir(env.XDG_CONFIG_HOME, { recursive: true });
  await mkdir(env.XDG_CACHE_HOME, { recursive: true });
} else {
  env.HOME = tempHome;
  env.XDG_CONFIG_HOME = join(tempHome, '.config');
  env.XDG_CACHE_HOME = join(tempHome, '.cache');
  await mkdir(env.XDG_CONFIG_HOME, { recursive: true });
  await mkdir(env.XDG_CACHE_HOME, { recursive: true });
}

let app;
try {
  app = await electron.launch({ args: ['.'], env, timeout: 60_000 });
  const win = await app.firstWindow();
  await win.waitForFunction(() => window.__rh_editor !== undefined, null, { timeout: 30_000 });
  const platform = process.platform;
  const program = `console.log('compatibility platform:', '${platform}');\n`;
  await win.evaluate(([value]) => window.__rh_editor.setValue(value), [program]);
  await win.locator('.monaco-editor').click();
  await win.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
  await win.waitForFunction(() => /exit\s+0/i.test(document.body.innerText), null, { timeout: 30_000 });
  const body = await win.evaluate(() => document.body.innerText);
  assert.match(body, new RegExp(`compatibility platform:\\s*${platform}`));
  console.log(JSON.stringify({ ok: true, platform, home: homedir() }));
} finally {
  if (app) await app.close();
  await rm(tempHome, { recursive: true, force: true });
  await rm(cache, { recursive: true, force: true });
}
