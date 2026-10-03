/** Deterministic Electron UX checks with real preload validation.
 * Uses an isolated profile/cache. Run after pnpm build; --real uses Node. */
import { _electron as electron } from 'playwright';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { IPC } from '../packages/protocol/src/ipc-channels.ts';

const profile = await mkdtemp(join(tmpdir(), 'rh-perf-e2e-'));
const output = resolve('.rhbuild', 'performance-after');
const real = process.argv.includes('--real');
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
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => { document.documentElement.dataset.motion = 'system'; });
  const panel = page.locator('#tool-panel-performance');
  const checks = [];
  const capture = (name) => page.screenshot({ path: join(output, `${name}.png`) });
  const chooseLayout = async (name) => {
    await page.getByRole('button', { name: 'Customize layout', exact: true }).click();
    await page.locator('dialog[open]').getByRole('button', { name: new RegExp(`^${name} `) }).click();
    await page.keyboard.press('Escape');
  };
  const wheel = async (over) => {
    const scroll = panel.locator('.rh-perf-scroll');
    await scroll.evaluate((element) => { element.scrollTop = 0; });
    const box = await (over ?? scroll).boundingBox();
    assert.ok(box && box.height > 0, 'scroll region must remain usable');
    await page.mouse.move(box.x + Math.min(80, box.width / 2), box.y + Math.min(40, box.height / 2));
    await page.mouse.wheel(0, 450);
    await page.waitForFunction(() => document.querySelector('#tool-panel-performance .rh-perf-scroll').scrollTop > 0);
    const owners = await panel.evaluate((root) => [root, ...root.querySelectorAll('*')].filter((element) => element.clientHeight > 0 && element.scrollHeight > element.clientHeight + 3 && /auto|scroll/.test(getComputedStyle(element).overflowY)).map((element) => element.className));
    assert.deepEqual(owners, ['rh-perf-scroll'], 'exactly one vertical scrollbar must own the wheel');
    await scroll.focus();
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('PageDown');
    await page.waitForFunction(() => document.querySelector('#tool-panel-performance .rh-perf-scroll').scrollTop > 0);
  };

  if (!real) await app.evaluate(({ ipcMain }, channels) => {
    const probe = globalThis.__rhPerfProbe = { request: null, catalogCalls: 0, resolveCatalog: null };
    ipcMain.removeHandler(channels.performanceCatalog);
    ipcMain.handle(channels.performanceCatalog, () => {
      probe.catalogCalls++;
      return new Promise((resolve) => { probe.resolveCatalog = resolve; });
    });
    ipcMain.removeHandler(channels.performanceStart);
    ipcMain.handle(channels.performanceStart, (_event, request) => {
      probe.request = request;
      const totalGroups = request.targets.reduce((sum, target) => sum + target.profiles.length, 0);
      return { accepted: true, requestId: request.requestId, totalGroups, totalCells: totalGroups * request.cases.length };
    });
    ipcMain.removeHandler(channels.performanceCancel);
    ipcMain.handle(channels.performanceCancel, () => ({ ok: true }));
  }, IPC);
  await page.locator('.rh-dock-tab[aria-label="performance"]').click();
  const discovery = panel.getByRole('progressbar', { name: 'Runtime discovery' });
  if (!real) {
    await discovery.waitFor();
    assert.equal(await discovery.getAttribute('aria-valuenow'), null, 'discovery must not show fake percentages');
    const sweep = panel.locator('.rh-progress-sweep');
    const transforms = async () => {
      const first = await sweep.evaluate((element) => getComputedStyle(element).transform);
      await page.waitForTimeout(220);
      return [first, await sweep.evaluate((element) => getComputedStyle(element).transform)];
    };
    const [first, second] = await transforms();
    assert.notEqual(first, second, 'discovery must animate without progress events');
    await capture('opening');
    for (const [mode, os, moving] of [['system', 'reduce', false], ['full', 'reduce', true], ['reduced', 'no-preference', false], ['system', 'no-preference', true]]) {
      await page.emulateMedia({ reducedMotion: os });
      await page.evaluate((motion) => { document.documentElement.dataset.motion = motion; }, mode);
      const [a, b] = await transforms();
      assert.equal(a !== b, moving, `motion=${mode}, OS=${os}`);
    }
    await page.locator('.rh-dock-tab[aria-label="console"]').click();
    await page.locator('.rh-dock-tab[aria-label="performance"]').click();
    assert.equal(await app.evaluate(() => globalThis.__rhPerfProbe.catalogCalls), 1, 'reopening must not restart pending probes');
    await app.evaluate(() => globalThis.__rhPerfProbe.resolveCatalog({ targets: [{ ref: { source: 'runtime', id: 'node' }, label: 'Node.js · test runtime', available: true, reason: null, runtimeId: 'node', runtimeVersion: '24', engineId: 'v8', profiles: [{ id: 'natural', label: 'Default', description: 'Runtime defaults', available: true, classification: 'stable' }] }] }));
    checks.push('indeterminate discovery, CSS motion, all OS/app motion combinations, deduplicated discovery');
  }
  await discovery.waitFor({ state: 'hidden', timeout: 40000 });
  await page.evaluate(() => window.__rh_editor.setValue('Math.sqrt(12345);'));
  for (let i = 0; i < (real ? 1 : 16); i++) await page.getByRole('button', { name: 'Add file', exact: true }).click();

  if (real) {
    await page.getByRole('button', { name: 'Measurement settings' }).click();
    await page.getByRole('button', { name: 'quick', exact: true }).click();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Run comparison' }).click();
    await panel.locator('.rh-perf-status.is-completed').waitFor({ timeout: 60000 });
    assert.equal(await panel.getByRole('progressbar').getAttribute('aria-valuenow'), '100');
    assert.ok(await panel.locator('.rh-perf-chart-row').count() > 0);
    await capture('real-node-completed');
    checks.push('real Node benchmark through manager, preload, store and results chart');
  } else {
    await wheel();
    await capture('bottom-scroll');
    await chooseLayout('Analyze');
    await page.locator('.rh-workbench-stage.is-right.has-tools').waitFor();
    await page.locator('.rh-dock-tab[aria-label="performance"]').click();
    await wheel();
    await capture('right-scroll');
    await page.setViewportSize({ width: 900, height: 650 });
    await page.locator('.rh-workbench-stage.is-bottom.has-tools').waitFor();
    await wheel();
    await capture('narrow-scroll');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('.rh-workbench-stage.is-right.has-tools').waitFor();
    checks.push('wheel + PageDown, single scroll owner: bottom, right, narrow fallback');

    const start = async () => {
      await page.getByRole('button', { name: 'Run comparison' }).click();
      await panel.locator('.rh-perf-status.is-running').waitFor();
      assert.equal(await panel.getByRole('button', { name: /^Results / }).getAttribute('aria-pressed'), 'true');
      return app.evaluate(() => globalThis.__rhPerfProbe.request);
    };
    const emit = (event) => app.evaluate(({ BrowserWindow }, { channel, event }) => BrowserWindow.getAllWindows()[0].webContents.send(channel, event), { channel: IPC.performanceEvent, event });
    let request = await start();
    assert.equal(await panel.getByRole('progressbar').getAttribute('aria-valuenow'), null);
    await emit({ type: 'progress', requestId: request.requestId, phase: 'warmup', completed: 0, total: 100, message: 'Warming code samples' });
    await emit({ type: 'progress', requestId: request.requestId, phase: 'measurement', completed: 20, total: 100, message: 'Case A · sample 2/5' });
    const fill = panel.locator('.rh-progress-fill');
    await page.waitForTimeout(400);
    await emit({ type: 'progress', requestId: request.requestId, phase: 'measurement', completed: 80, total: 100, message: 'Case A · sample 4/5' });
    await page.waitForTimeout(80);
    const scale = await fill.evaluate((element) => new DOMMatrix(getComputedStyle(element).transform).a);
    assert.ok(scale > .2 && scale < .8, `progress must interpolate, got ${scale}`);
    await capture('measuring');
    const result = {
      requestId: request.requestId, groupId: 'node:natural', target: request.targets[0].target, profile: request.targets[0].profiles[0],
      environment: { platform: 'test', arch: 'x64', cpu: 'Test CPU', logicalCores: 8, runtimeId: 'node', runtimeVersion: '24', engineId: 'v8', executable: '/test/node', flags: [], gcMode: 'runtime' },
      results: request.cases.map((item, i) => ({ caseId: item.id, label: item.label, metrics: { minNsPerOp: 90 + i, meanNsPerOp: 100 + i, medianNsPerOp: 100 + i, p75NsPerOp: 102 + i, p95NsPerOp: 106 + i, p99NsPerOp: 108 + i, maxNsPerOp: 110 + i, stddevNsPerOp: 5, throughput: 1000000, sampleCount: 5, totalIterations: 1250 }, samples: [], warnings: [] })),
      comparisons: [], scheduleSeed: 1, rounds: 5
    };
    await emit({ type: 'result', requestId: request.requestId, result });
    await emit({ type: 'done', requestId: request.requestId, status: 'completed', completedGroups: 1, totalGroups: 1 });
    await panel.locator('.rh-perf-status.is-completed').waitFor();
    await page.waitForTimeout(500);
    assert.equal(await panel.getByRole('progressbar').getAttribute('aria-valuenow'), '100');
    assert.equal(await panel.locator('.rh-progress-sweep').count(), 0, 'terminal status stops animating but stays visible');
    await capture('completed');
    await wheel(panel.locator('.rh-perf-chart'));
    await capture('results-scroll');
    const matrix = panel.locator('.rh-perf-matrix-wrap');
    await matrix.scrollIntoViewIfNeeded();
    const box = await matrix.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + 20);
    await page.mouse.wheel(450, 0);
    await page.waitForFunction(() => document.querySelector('.rh-perf-matrix-wrap').scrollLeft > 0);
    checks.push('smooth interpolation, automatic results view, persistent completion, vertical results and horizontal matrix scroll');

    request = await start();
    await emit({ type: 'progress', requestId: request.requestId, phase: 'measurement', completed: 35, total: 100, message: 'Case B · sample 2/5' });
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    await page.getByRole('button', { name: 'Stopping…' }).waitFor();
    await emit({ type: 'done', requestId: request.requestId, status: 'cancelled', completedGroups: 0, totalGroups: 1 });
    await panel.locator('.rh-perf-status.is-cancelled').waitFor();
    assert.equal(await panel.getByRole('progressbar').getAttribute('aria-valuenow'), '35');
    await capture('cancelled');
    request = await start();
    await emit({ type: 'progress', requestId: request.requestId, phase: 'preparing', completed: 1, total: 100, message: 'Preparing' });
    await emit({ type: 'cell-error', requestId: request.requestId, groupId: 'node:natural', target: request.targets[0].target, profile: request.targets[0].profiles[0], message: 'Fixture: runtime failed', partialResults: [] });
    await emit({ type: 'done', requestId: request.requestId, status: 'failed', completedGroups: 0, totalGroups: 1 });
    await panel.locator('.rh-perf-status.is-failed').waitFor();
    assert.equal(await panel.getByRole('progressbar').getAttribute('aria-valuenow'), '1');
    await panel.getByText('Fixture: runtime failed').waitFor();
    await capture('failed');
    checks.push('stopping feedback, retained cancellation fraction, failures without fabricated 100%');

    await page.getByRole('button', { name: /^Runtimes ·/ }).click();
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest('dialog[open]'))), true);
    }
    await page.keyboard.press('Escape');
    assert.match(await page.evaluate(() => document.activeElement.textContent), /Runtimes/);
    checks.push('runtime dialog keyboard focus containment and return');

    await panel.getByRole('button', { name: /^Code samples/ }).click();
    await page.evaluate(() => window.__rh_editor.setValue(''));
    await page.getByRole('button', { name: 'Run comparison' }).click();
    await panel.getByText('Every case must contain executable code.').waitFor();
    assert.equal(await panel.getByRole('button', { name: /^Results/ }).getAttribute('aria-pressed'), 'true');
    checks.push('validation errors open Results even when no process was started');
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ checks, screenshots: output }, null, 2));
} catch (error) {
  const page = await app.firstWindow();
  await page.screenshot({ path: join(output, 'failure.png') });
  console.error(await page.locator('#tool-panel-performance').innerText());
  throw error;
} finally { await app.close(); }
