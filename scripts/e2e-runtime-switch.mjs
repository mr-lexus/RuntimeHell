#!/usr/bin/env node
/**
 * Run against a built app with Node.js and Bun installed on PATH:
 *   pnpm build && node scripts/e2e-runtime-switch.mjs
 */
import { firstTestWindow } from './electron-test-window.mjs';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';

const entry = fileURLToPath(new URL('../out/main/index.js', import.meta.url));
await access(entry);
const profile = await mkdtemp(join(tmpdir(), 'rh-runtime-switch-'));
const config = join(profile, 'config');
const local = join(profile, 'local');
const env = {
  ...process.env,
  USERPROFILE: profile, HOME: profile,
  APPDATA: config, LOCALAPPDATA: local,
  XDG_CONFIG_HOME: config, XDG_CACHE_HOME: local,
  RH_CACHE_ROOT: join(profile, 'cache')
};
delete env.ELECTRON_RENDERER_URL;

const program = [
  "const runtime = typeof Bun !== 'undefined' ? 'bun' : typeof Deno !== 'undefined' ? 'deno' : 'node';",
  "const version = runtime === 'bun' ? Bun.version : runtime === 'deno' ? Deno.version.deno : process.versions.node;",
  "console.log('runtime-check ' + runtime + '@' + version);"
].join('\n');

async function runAndCheck(page, runtime) {
  const consoleTab = page.getByRole('tab', { name: 'console', exact: true });
  if ((await consoleTab.getAttribute('aria-selected')) !== 'true') await consoleTab.click();
  await page.getByRole('button', { name: /^Run source/ }).click();

  const pattern = new RegExp('runtime-check ' + runtime + '@(\\d+\\.\\d+\\.\\d+(?:[-+][\\w.-]+)?)');
  const output = page.locator('.rh-console-output').getByText(pattern).first();
  await output.waitFor();
  const [, version] = (await output.innerText()).match(pattern);
  await page.locator('.rh-statusbar .rh-status').filter({ hasText: /exit 0\b/ }).waitFor();
  const badge = await page.getByRole('button', { name: 'Open runtime selector' }).innerText();
  assert.equal(badge.trim(), 'runtime ' + runtime.toUpperCase() + ' v' + version);
  console.log('[e2e-runtime-switch]', badge.trim(), 'exit 0');
}

let app;
try {
  await Promise.all([mkdir(config), mkdir(local)]);
  app = await electron.launch({ args: [entry, '--user-data-dir=' + join(profile, 'chromium')], env, timeout: 60_000 });
  const page = await firstTestWindow(app);
  page.setDefaultTimeout(30_000);
  await page.waitForFunction(() => Boolean(window.__rh_editor));
  await page.evaluate((source) => window.__rh_editor.setValue(source), program);

  await runAndCheck(page, 'node');
  await page.getByRole('tab', { name: 'runtimes', exact: true }).click();
  await page.getByTitle('run code with Bun', { exact: true }).click();
  await runAndCheck(page, 'bun');
} finally {
  try {
    await app?.close();
  } finally {
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}