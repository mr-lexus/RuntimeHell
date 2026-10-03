/** Real product screenshots in a disposable profile. No mocked results. */
import { _electron as electron } from 'playwright';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const profile = await mkdtemp(join(tmpdir(), 'rh-product-'));
const output = resolve('website/assets/screens');
await mkdir(output, { recursive: true });
const app = await electron.launch({ args: [resolve('out/main/index.js'), `--user-data-dir=${join(profile, 'chromium')}`], env: { ...process.env, USERPROFILE: profile, HOME: profile, APPDATA: join(profile, 'config'), LOCALAPPDATA: join(profile, 'local'), XDG_CONFIG_HOME: join(profile, 'config'), RH_CACHE_ROOT: join(profile, 'cache') } });
try {
  const page = await app.firstWindow();
  await page.waitForFunction(() => Boolean(window.__rh_editor), null, { timeout: 30000 });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.evaluate(() => window.api.settingsSet({ editor: { fontSize: 17, minimap: false, inlineInspector: true }, appearance: { motion: 'reduced' }, layout: { drawerOpen: false, showStatusBar: true } }));
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__rh_editor));
  const source = [
    '// A small experiment. A clear view of every value.',
    '',
    'class Workspace {',
    '  constructor(public name: string, public runtimes: string[]) {}',
    '  describe() { return `${this.name} · ${this.runtimes.length} runtimes`; }',
    '}',
    '',
    'const workspace = new Workspace("RuntimeHell", ["Node.js", "Deno", "Bun", "Chromium"]);',
    '',
    'const experiments = [',
    '  { name: "inspect values", status: "ready" },',
    '  { name: "compare runtimes", status: "ready" },',
    '  { name: "explore the engine", status: "ready" },',
    '];',
    '',
    'const ready = experiments.filter(item => item.status === "ready");',
    'const names = ready.map(item => item.name);',
    '',
    'workspace.describe();',
    'new Set(workspace.runtimes);',
    '',
    '// No console.log required. Expand any object on the right.'
  ].join('\n');
  await page.evaluate((code) => { window.__rh_editor.setValue(code); window.__rh_editor.setSelection(1, 1, 1, 1); }, source);
  await page.keyboard.press('Control+Enter');
  await page.waitForFunction(() => /exit\s+0/.test(document.body.innerText), null, { timeout: 30000 });
  const consoleTab = page.locator('.rh-dock-tab[aria-label="console"]');
  if (await consoleTab.getAttribute('aria-selected') === 'true') await consoleTab.click();
  await page.locator('[data-inspector-oneliner="8"]').click();
  await page.locator('[data-inspector-overlay]').getByRole('button', { name: 'Toggle [[Prototype]]', exact: true }).click();
  await page.mouse.move(780, 970);
  await page.screenshot({ path: join(output, 'workspace.png') });
  await page.locator('[data-inspector-oneliner="8"]').click();
  await page.getByRole('button', { name: 'Customize layout', exact: true }).click();
  await page.screenshot({ path: join(output, 'layout.png') });
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Hide line output panel', exact: true }).click();
  const benchmark = [
    '// Two approaches. Measure the trade-off.',
    '// A · Array.reduce',
    'function sumWithReduce() {',
    'const values = Array.from({ length: 1000 }, (_, i) => i);',
    'return values.reduce((sum, value) => sum + value, 0);',
    '}',
    '',
    '// B · for…of',
    'function sumWithLoop() {',
    'const values = Array.from({ length: 1000 }, (_, i) => i);',
    'let total = 0;',
    'for (const value of values) total += value;',
    'return total;',
    '}',
    '',
    '// Each selection is an independent benchmark case.',
    '// Warmup → measurement → comparable results.',
    '// Measurements below come from a real local run.'
  ].join('\n');
  await page.evaluate((code) => window.__rh_editor.setValue(code), benchmark);
  await page.getByRole('button', { name: 'Customize layout', exact: true }).click();
  await page.locator('dialog[open]').getByRole('button', { name: /^Analyze / }).click();
  await page.keyboard.press('Escape');
  await page.locator('.rh-dock-tab[aria-label="performance"]').click();
  const panel = page.locator('#tool-panel-performance');
  await panel.getByRole('progressbar', { name: 'Runtime discovery' }).waitFor({ state: 'hidden', timeout: 60000 });
  await page.evaluate(() => window.__rh_editor.setSelection(4, 1, 5, 70));
  await panel.getByRole('button', { name: 'Add selection', exact: true }).click();
  await panel.getByRole('textbox', { name: 'Case 1 label' }).fill('Array.reduce');
  await page.evaluate(() => window.__rh_editor.setSelection(10, 1, 13, 14));
  await panel.getByRole('button', { name: 'Add selection', exact: true }).click();
  await panel.getByRole('textbox', { name: 'Case 2 label' }).fill('for…of');
  await page.getByRole('button', { name: 'Measurement settings' }).click();
  await page.getByRole('button', { name: 'quick', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Run comparison' }).click();
  await panel.locator('.rh-perf-status.is-completed').waitFor({ timeout: 60000 });
  assert.equal(await panel.locator('.rh-perf-chart-row').count() >= 2, true);
  await page.evaluate(() => window.__rh_editor.setSelection(1, 1, 1, 1));
  await page.mouse.move(780, 970);
  await page.screenshot({ path: join(output, 'performance.png') });
  console.log(`Product screenshots: ${output}`);
} catch (error) {
  await (await app.firstWindow()).screenshot({ path: resolve('.rhbuild/product-capture-failure.png') });
  throw error;
} finally { await app.close(); }
