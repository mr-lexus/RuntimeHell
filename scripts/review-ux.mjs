/** Isolated Electron UX screenshots and workspace interaction checks. */
import { _electron as electron } from 'playwright';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const profile = await mkdtemp(join(tmpdir(), 'rh-ux-'));
const output = resolve('.rhbuild', process.argv.includes('--before') ? 'ux-before' : 'ux-after');
await mkdir(output, { recursive: true });
const app = await electron.launch({
  args: [resolve('out/main/index.js'), `--user-data-dir=${join(profile, 'chromium')}`],
  env: { ...process.env, USERPROFILE: profile, HOME: profile, APPDATA: join(profile, 'config'), LOCALAPPDATA: join(profile, 'local'), XDG_CONFIG_HOME: join(profile, 'config'), RH_CACHE_ROOT: join(profile, 'cache') }
});
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForFunction(() => Boolean(window.__rh_editor), null, { timeout: 30000 });
  await page.setViewportSize({ width: 1440, height: 900 });
  if (process.argv.includes('--diagnostics')) {
    await page.waitForTimeout(2500);
    console.log(await page.evaluate(() => ({ models: window.__rh_monaco.editor.getModels().map((model) => ({ uri: model.uri.toString(), language: model.getLanguageId() })), markers: window.__rh_monaco.editor.getModelMarkers({}).map(({ code, message }) => ({ code, message })) })));
  }
  const editorArea = await page.locator('.rh-editor-host').evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return { width: rect.width, height: rect.height, viewportShare: rect.width * rect.height / (innerWidth * innerHeight) };
  });
  if (!process.argv.includes('--before')) assert.ok(editorArea.viewportShare > .8, 'default editor should occupy over 80% of the window');
  await page.screenshot({ path: join(output, 'workspace.png') });
  for (const tab of ['console', 'inspector', 'analysis', 'performance', 'packages', 'runtimes']) {
    const trigger = page.locator(`.rh-dock-tab[aria-label="${tab}"]`);
    if (await trigger.getAttribute('aria-selected') !== 'true') await trigger.click();
    await page.screenshot({ path: join(output, `${tab}.png`) });
  }
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.screenshot({ path: join(output, 'settings.png') });
  if (!process.argv.includes('--before')) {
    const checks = [];
    const saved = async (key, value) => page.waitForFunction(async ({ key, value }) => (await window.api.settingsGet()).layout[key] === value, { key, value });
    const chooseLayout = async (name) => {
      await page.getByRole('button', { name: 'Customize layout', exact: true }).click();
      await page.locator('dialog[open]').getByRole('button', { name: new RegExp(`^${name} `) }).click();
      await page.keyboard.press('Escape');
    };
    const command = async (text) => {
      await page.keyboard.press('F1');
      await page.getByRole('combobox', { name: 'Search commands' }).fill(text);
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('.quick-input-widget').isVisible().catch(() => false), false, 'Monaco must not open a second palette');
    };

    // Search, keyboard focus containment, and no background tab-close shortcut.
    await page.getByRole('textbox', { name: 'Search settings' }).fill('vim');
    assert.equal(await page.getByRole('switch', { name: 'Vim / LazyVim mode' }).count(), 1);
    const tabs = await page.locator('.rh-tab[data-file-id]').count();
    await page.keyboard.press('Control+w');
    assert.equal(await page.locator('.rh-tab[data-file-id]').count(), tabs);
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest('dialog[open]'))), true);
    }
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Settings');
    checks.push('settings search, modal focus containment, return focus, shortcut isolation');

    // A real editor edit must survive all workspace presentation changes.
    await page.evaluate(() => {
      window.__rh_ux_editor = window.__rh_editor;
      window.__rh_editor.setValue('const answer = 42;');
      window.__rh_editor.setSelection(1, 19, 1, 19);
    });
    await page.keyboard.insertText(' // keep undo');
    await chooseLayout('Analyze');
    await saved('toolPosition', 'right');
    assert.equal(await page.locator('.rh-workbench-stage.is-right.has-tools').count(), 1);
    await page.screenshot({ path: join(output, 'right-analysis.png') });
    const separator = page.getByRole('separator', { name: 'Resize tool panel' });
    await separator.focus();
    await page.keyboard.press('ArrowLeft');
    await saved('sideRatio', .48);
    await page.getByRole('button', { name: 'Maximize tool panel' }).click();
    assert.equal(await page.locator('.rh-source-frame').isVisible(), false);
    await page.getByRole('button', { name: 'Restore tool panel' }).click();
    await page.keyboard.press('Shift+F11');
    assert.equal(await page.locator('.rh-dock').isVisible(), false);
    await page.screenshot({ path: join(output, 'focus.png') });
    await page.getByRole('button', { name: 'Exit focus mode' }).click();
    assert.equal(await page.locator('.rh-workbench-stage.is-right.has-tools').count(), 1);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => window.__rh_ux_editor === window.__rh_editor), true);
    await page.evaluate(() => window.__rh_editor.setSelection(1, 1, 1, 1));
    // Monaco can split a typing session into word-sized undo groups.
    for (let i = 0; i < 10 && await page.evaluate(() => window.__rh_editor.getValue()) !== 'const answer = 42;'; i++) await page.keyboard.press('Control+z');
    assert.equal(await page.evaluate(() => window.__rh_editor.getValue()), 'const answer = 42;');
    checks.push('same editor and undo across settings, presets, maximize and focus; keyboard resize');

    await page.getByRole('button', { name: 'Show line output panel', exact: true }).click();
    await separator.focus();
    for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowLeft');
    await saved('sideRatio', .65);
    const sourceShare = await page.evaluate(() => document.querySelector('.rh-editor-host').getBoundingClientRect().width / document.querySelector('.rh-editor-region').getBoundingClientRect().width);
    assert.ok(sourceShare >= .54, 'inline results must not consume the editor');
    await page.screenshot({ path: join(output, 'inline-results.png') });
    await page.getByRole('button', { name: 'Hide line output panel', exact: true }).click();
    await chooseLayout('Analyze');
    checks.push('line results keep at least half the source region available to code');

    await page.setViewportSize({ width: 900, height: 650 });
    await page.locator('.rh-workbench-stage.is-bottom.has-tools').waitFor();
    await saved('toolPosition', 'right');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: join(output, 'narrow.png') });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('.rh-workbench-stage.is-right.has-tools').waitFor();
    checks.push('narrow-window fallback preserves preferred docking');

    await page.keyboard.press('F1');
    await page.getByRole('combobox', { name: 'Search commands' }).fill('no-such-command-xyzz');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    assert.equal(await page.getByRole('dialog', { name: 'Command palette' }).isVisible(), true);
    await page.getByRole('combobox', { name: 'Search commands' }).fill('layout');
    await page.screenshot({ path: join(output, 'commands.png') });
    await page.keyboard.press('Escape');
    await command('Open performance');
    await saved('drawerTab', 'performance');
    await page.getByRole('button', { name: 'Measurement settings' }).click();
    await page.screenshot({ path: join(output, 'measurement.png') });
    await page.keyboard.press('Escape');
    await page.reload();
    await page.waitForFunction(() => Boolean(window.__rh_editor));
    await page.locator('.rh-dock-tab[aria-label="performance"][aria-selected="true"]').waitFor();
    await page.locator('.rh-workbench-stage.is-right.has-tools').waitFor();
    checks.push('command search, empty search, measurement options and layout restored after reload');

    await chooseLayout('Code');
    await page.evaluate(() => window.__rh_editor.setValue("console.log('UX smoke', 42);"));
    await page.getByRole('button', { name: /^Run source/ }).click();
    await page.locator('.rh-dock-tab[aria-label="console"][aria-selected="true"]').waitFor();
    await page.locator('#tool-panel-console').getByText(/UX smoke/).first().waitFor({ timeout: 30000 }).catch(async (error) => {
      await page.screenshot({ path: join(output, 'run-failure.png') });
      console.error(await page.locator('#tool-panel-console').innerText());
      throw error;
    });
    await page.screenshot({ path: join(output, 'run.png') });
    checks.push('manual execution reveals console and displays real Node output');

    await command('Use light theme');
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    await page.screenshot({ path: join(output, 'light.png') });
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Appearance', exact: true }).click();
    await page.screenshot({ path: join(output, 'appearance.png') });
    await page.getByRole('combobox', { name: 'Interface scale' }).selectOption('110');
    await page.setViewportSize({ width: 760, height: 520 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: join(output, 'settings-small-110.png') });
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 1440, height: 900 });
    const beforeNew = await page.locator('.rh-tab[data-file-id]').count();
    await page.keyboard.press('Control+n');
    assert.equal(await page.locator('.rh-tab[data-file-id]').count(), beforeNew + 1);
    await command('entry.ts');
    assert.equal(await page.locator('.rh-tab.is-active').getAttribute('data-file-id'), 'default:entry.ts');
    await command('Open runtimes');
    await page.getByRole('searchbox', { name: 'Search runtimes and engines' }).fill('zzzzz-no-engine');
    await page.getByText('No matches. Try a name such as Node, V8 or Bun.').waitFor();
    await page.getByRole('searchbox', { name: 'Search runtimes and engines' }).fill('V8');
    await page.screenshot({ path: join(output, 'catalog-search.png') });
    checks.push('light appearance, 110% scale at minimum window size, new-file shortcut, file search and runtime catalog search');
    assert.deepEqual(errors, [], 'renderer page errors');
    console.log(JSON.stringify({ output, profile, editorArea, checks }, null, 2));
  } else console.log(JSON.stringify({ output, profile, editorArea }));
} finally {
  await app.close();
}
