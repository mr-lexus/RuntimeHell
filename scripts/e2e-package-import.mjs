/** Real Electron/preload/editor checks. No registry downloads or user files. */
import { _electron as electron } from 'playwright';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { IPC } from '../packages/protocol/src/ipc-channels.ts';

const profile = await mkdtemp(join(tmpdir(), 'rh-import-e2e-'));
const workspace = join(profile, 'RuntimeHell/workspaces/default');
const name = 'rh-import-fixture';
const directory = join(workspace, 'node_modules', name);
const output = resolve('.rhbuild/package-import');
await mkdir(directory, { recursive: true });
await mkdir(output, { recursive: true });
await writeFile(join(workspace, 'package.json'), JSON.stringify({ private: true, type: 'commonjs', dependencies: { [name]: '1.2.3' } }));
await writeFile(join(directory, 'package.json'), JSON.stringify({ name, version: '1.2.3', main: 'index.cjs' }));
await writeFile(join(directory, 'index.cjs'), 'exports.make = () => 42;');
await writeFile(join(directory, 'README.md'), "```js\nimport { make } from 'rh-import-fixture';\nconsole.log(make());\n```\n");
const app = await electron.launch({
  args: [resolve('out/main/index.js'), `--user-data-dir=${join(profile, 'chromium')}`],
  env: { ...process.env, USERPROFILE: profile, HOME: profile, APPDATA: join(profile, 'config'), LOCALAPPDATA: join(profile, 'local'), XDG_CONFIG_HOME: join(profile, 'config'), RH_CACHE_ROOT: join(profile, 'cache') }
});
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('https://registry.npmjs.org/**', (route) => route.fulfill({ status: 404, body: '{}' }));
  await page.waitForFunction(() => Boolean(window.__rh_editor), null, { timeout: 30000 });
  await page.setViewportSize({ width: 1440, height: 900 });
  // Explicit TS avoids automatic language detection making the fixture CJS.
  await page.locator('.rh-titlebar-language-trigger').click();
  await page.getByRole('menuitemradio', { name: 'TypeScript' }).click();
  const original = "'use strict';\n/** Keep attached. */\nfunction make(): number { return 7; }\nconsole.log(make());\n";
  const value = () => page.evaluate(() => window.__rh_editor.getValue());
  const setValue = (code) => page.evaluate((text) => window.__rh_editor.setValue(text), code);
  await setValue(original);
  await page.evaluate(() => {
    window.__rh_editor.setSelection(3, 10, 3, 14);
    window.__rhImportEvents = [];
    window.api.onRunEvent((event) => window.__rhImportEvents.push(event));
  });
  await page.getByRole('button', { name: 'auto-run off', exact: true }).click();
  await page.locator('.rh-dock-tab[aria-label="packages"]').click();
  const panel = page.locator('#tool-panel-packages');
  const insert = panel.getByRole('button', { name: `Import ${name}`, exact: true });
  await insert.click();
  await panel.getByRole('status').waitFor();
  const imported = await value();
  assert.match(imported, /import \{ make as make2 \} from 'rh-import-fixture';/);
  assert.ok(imported.includes('/** Keep attached. */\nfunction make(): number { return 7; }\nconsole.log(make());'));
  assert.ok(imported.includes('// console.log(make());'));
  await page.waitForTimeout(1100);
  assert.deepEqual(await page.evaluate(() => window.__rhImportEvents), [], 'Import must not execute code with auto-run enabled');
  await page.getByRole('button', { name: 'auto-run on', exact: true }).click();
  await page.evaluate(() => window.__rh_editor.setSelection(1, 1, 1, 1));
  await page.keyboard.press('Control+z');
  await page.waitForFunction((text) => window.__rh_editor.getValue() === text, original, { timeout: 3000 });
  assert.equal(await value(), original, 'One undo must restore both edits and selected text');
  await page.keyboard.press('Control+Shift+z');
  await page.waitForFunction((text) => window.__rh_editor.getValue() === text, imported, { timeout: 3000 });
  assert.equal(await value(), imported, 'Redo restores import and example together');
  await insert.click();
  await panel.getByRole('alert').filter({ hasText: 'already imported' }).waitFor();
  assert.equal(await value(), imported);
  await page.screenshot({ path: join(output, 'imported.png') });
  await setValue('function unfinished(');
  await insert.click();
  await panel.getByRole('alert').filter({ hasText: 'syntax' }).waitFor();
  assert.equal(await value(), 'function unfinished(');
  await panel.getByRole('checkbox').uncheck();
  await setValue('const unrelated: number = 1;');
  await insert.click();
  await panel.getByRole('status').waitFor();
  assert.ok(!(await value()).includes('Example from'));
  await setValue(`${await value()}\nconsole.log('import-smoke', make());`);
  await page.evaluate(() => { window.__rhImportEvents = []; });
  await page.evaluate(() => window.__rh_editor.setSelection(1, 1, 1, 1));
  await page.keyboard.press('Control+Enter');
  await page.waitForFunction(() => window.__rhImportEvents.some((event) => event.type === 'exit'), null, { timeout: 30000 });
  const events = await page.evaluate(() => window.__rhImportEvents);
  assert.ok(events.some((event) => /import-smoke.*42/.test(event.text ?? event.data ?? '')), JSON.stringify(events));
  assert.equal(events.find((event) => event.type === 'exit').code, 0);
  // Explicit JS mode in a CommonJS workspace must use require, not import.
  await page.locator('.rh-titlebar-language-trigger').click();
  await page.getByRole('menuitemradio', { name: 'JavaScript' }).click();
  await setValue('console.log("original");');
  if (!await panel.isVisible()) await page.locator('.rh-dock-tab[aria-label="packages"]').click();
  await insert.click();
  await panel.getByRole('status').waitFor();
  assert.match(await value(), /const rhImportFixture = require\('rh-import-fixture'\);/);
  // Delay only the isolated application's handler to reproduce a tab race.
  const response = await page.evaluate((pkg) => window.api.pkgImportInfo('default', pkg), name);
  await app.evaluate(({ ipcMain }, channel) => {
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, () => new Promise((resolve) => { globalThis.__rhResolveImport = resolve; }));
  }, IPC.packagesImportInfo);
  await insert.click();
  await app.evaluate(async () => { while (!globalThis.__rhResolveImport) await new Promise((resolve) => setTimeout(resolve, 10)); });
  await page.keyboard.press('Control+n');
  await page.waitForFunction(() => !window.__rh_editor.getValue().includes('rhImportFixture'));
  const nextFile = await value();
  await app.evaluate((_electron, result) => globalThis.__rhResolveImport(result), response);
  await panel.getByRole('alert').filter({ hasText: 'active file changed' }).waitFor();
  assert.equal(await value(), nextFile, 'An outstanding request must not edit another file');
  assert.deepEqual(errors, []);
  console.log('PASS: real metadata → preload → panel → Monaco; selection, alias, example, Undo/Redo, duplicate, syntax, no auto-run, real Node execution, CommonJS, tab race.');
} finally { await app.close(); }
