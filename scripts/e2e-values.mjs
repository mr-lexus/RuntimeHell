/** Unlogged values through real Node/Chromium, preload, store and inline UI. */
import { _electron as electron } from 'playwright';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const profile = await mkdtemp(join(tmpdir(), 'rh-values-e2e-'));
const output = resolve('.rhbuild/values');
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
  await page.getByRole('button', { name: 'Show line output panel', exact: true }).click();
  await page.evaluate(() => { window.__rhValuesEvents = []; window.api.onRunEvent((event) => window.__rhValuesEvents.push(event)); });
  const source = [
    'const first = { answer: 42, nested: { ready: true } };',
    'class Base { baseMethod() { return 1; } get inherited() { throw Error("must not run"); } }',
    'class Child extends Base { field = "value"; }',
    'const instance = new Child();',
    'const { answer, nested } = first;',
    'const one = { left: 1 }, two = { right: 2 };',
    'let missing;',
    'Object.defineProperty(first, "hidden", { value: 7 });',
    'first;',
    'let getterReads = 0;',
    'const accessor = { get computed() { getterReads++; return 100; }, get then() { getterReads++; return null; } };',
    'getterReads;',
    'new Promise(resolve => setTimeout(() => resolve({ settled: true }), 1800));',
    'new Date("2026-01-01");'
  ].join('\n');
  const row = (line) => page.locator(`[data-inspector-oneliner="${line}"]`);
  const overlay = page.locator('[data-inspector-overlay]');
  for (const runtime of ['node', 'browser']) {
    await page.getByRole('combobox', { name: 'Run with runtime' }).selectOption(runtime);
    await page.evaluate((code) => { window.__rhValuesEvents = []; window.__rh_editor.setValue(code); window.__rh_editor.setSelection(1, 1, 1, 1); }, source);
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
    await row(4).waitFor();
    await row(4).click();
    await overlay.waitFor();
    await overlay.getByRole('button', { name: 'Toggle [[Prototype]]', exact: true }).click();
    await overlay.getByRole('button', { name: 'Toggle [[Prototype]]', exact: true }).last().click();
    assert.match(await overlay.innerText(), /baseMethod/);
    assert.match(await overlay.innerText(), /\[Getter\]/);
    await page.waitForFunction(() => window.__rhValuesEvents.some((event) => event.type === 'exit'), null, { timeout: 30000 });
    assert.equal(await overlay.count(), 1, 'Promise settlement must not collapse the open object');
    const events = await page.evaluate(() => window.__rhValuesEvents);
    assert.equal(events.find((event) => event.type === 'exit').code, 0, JSON.stringify(events.filter((event) => event.type === 'error')));
    assert.equal(events.filter((event) => event.type === 'console').length, 0);
    assert.match(await row(1).innerText(), /Object/);
    assert.match(await row(5).innerText(), /Values \(2\)/);
    assert.match(await row(6).innerText(), /Values \(2\)/);
    assert.match(await row(7).innerText(), /undefined/);
    assert.match(await row(12).innerText(), /0/);
    await page.screenshot({ path: join(output, `${runtime}-prototype.png`) });
    await row(4).click();
    await row(9).click();
    assert.match(await overlay.innerText(), /hidden.*7/s);
    await row(9).click();
    await row(14).click();
    assert.match(await overlay.innerText(), /\[\[Prototype\]\]/, 'Date prototype is expandable too');
  }
  assert.deepEqual(errors, []);
  console.log('PASS: Node + Chromium unlogged objects, destructuring, same-line values, undefined, inert getters, hidden properties, full inherited prototypes, Date expansion, stable async disclosure.');
} finally { await app.close(); }
