/**
 * E2E (plan todo 4): launch the REAL Electron app, drive Monaco through the
 * test hooks, assert TypeScript diagnostics appear for a deliberate type error,
 * and verify the typed IPC ping round-trip.
 *
 * Requires a prior `pnpm build` (launches out/main/index.js).
 */
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { _electron, type ElectronApplication, type Page } from 'playwright';

const mainEntry = resolve(process.cwd(), 'out/main/index.js');

async function launchApp(): Promise<{ app: ElectronApplication; page: Page }> {
  const t0 = Date.now();
  const step = (m: string): void => console.log(`[e2e-monaco +${Date.now() - t0}ms] ${m}`);
  const app = await _electron.launch({
    args: [mainEntry],
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' }
  });
  step('launched');
  app.process().stdout?.on('data', (c: Buffer) => {
    const text = c.toString().trim();
    if (text !== '') step(`main.out: ${text.slice(0, 200)}`);
  });
  app.process().stderr?.on('data', (c: Buffer) => {
    const text = c.toString().trim();
    if (text !== '') step(`main.err: ${text.slice(0, 300)}`);
  });
  const page = await app.firstWindow();
  step('firstWindow');
  await page.waitForSelector('#root', { timeout: 20000 });
  step('#root');
  // #root is static HTML — wait for the editor test hook so React has actually
  // mounted and the workspace bootstrap (settingsGet → openFile) has finished.
  await page.waitForFunction(() => Boolean((window as unknown as Record<string, unknown>)['__rh_editor']), undefined, {
    timeout: 20000
  });
  step('editor-hook');
  return { app, page };
}

describe.skipIf(!existsSync(mainEntry))('monaco e2e (built app)', () => {
  it('boots, pings main, and surfaces TS diagnostics for a type error', async () => {
    const { app, page } = await launchApp();
    try {
      // IPC round-trip through the sandboxed preload bridge.
      const pong = await page.evaluate(async () => {
        const res = (await window.api.ping(Date.now())) as { pong: boolean };
        return res.pong === true;
      });
      expect(pong).toBe(true);

      // Editor hook present.
      const hasEditor = await page.evaluate(() => Boolean((window as never as Record<string, unknown>)['__rh_editor']));
      expect(hasEditor).toBe(true);

      // Inject a deliberate type error and wait for the TS worker to flag it.
      await page.evaluate(() => {
        const ed = (window as never as Record<string, unknown>)['__rh_editor'] as { setValue: (v: string) => void };
        ed.setValue('const x: string = 1;\n');
      });
      await page.waitForTimeout(4000);
      const markerCount = await page.evaluate(() => {
        const m = (window as never as Record<string, unknown>)['__rh_monaco'] as {
          editor: { getModelMarkers: (o: object) => unknown[] };
        };
        return m.editor.getModelMarkers({}).length;
      });
      expect(markerCount).toBeGreaterThanOrEqual(1);
    } finally {
      await app.close();
    }
  }, 60000);

  it('keeps the Monaco context menu above the bottom dock', async () => {
    const { app, page } = await launchApp();
    try {
      const consoleTab = page.locator('.rh-dock-tab[aria-label="console"]');
      const dock = page.locator('.rh-dock');
      const dockCollapsed = await dock.evaluate((element) => element.classList.contains('is-collapsed'));
      const consoleSelected = await consoleTab.getAttribute('aria-selected') === 'true';
      if (dockCollapsed || !consoleSelected) await consoleTab.click();

      await page.evaluate(async () => {
        const monaco = (window as unknown as Record<string, unknown>)['__rh_monaco'] as {
          editor: { getEditors: () => Array<{ getAction: (id: string) => { run: () => Promise<void> } | null }> };
        };
        const action = monaco.editor.getEditors()[0]?.getAction('editor.action.showContextMenu');
        if (!action) throw new Error('Monaco context-menu action is unavailable');
        await action.run();
      });
      const menu = page.locator('.context-view.monaco-menu-container:not([aria-hidden="true"])');
      await menu.waitFor({ state: 'visible', timeout: 5000 });
      const layering = await menu.evaluate((contextMenu) => {
        const source = document.querySelector<HTMLElement>('.rh-source-frame');
        const dockElement = document.querySelector<HTMLElement>('.rh-dock');
        if (!source || !dockElement) return null;
        const sourceStyle = getComputedStyle(source);
        const dockRect = dockElement.getBoundingClientRect();
        const menuRect = contextMenu.getBoundingClientRect();
        const overlapTop = Math.max(dockRect.top, menuRect.top);
        const overlapBottom = Math.min(dockRect.bottom, menuRect.bottom);
        const overlapLeft = Math.max(dockRect.left, menuRect.left);
        const overlapRight = Math.min(dockRect.right, menuRect.right);
        const hasOverlap = overlapTop < overlapBottom && overlapLeft < overlapRight;
        const menuRoot = contextMenu.getRootNode();
        const topmost = hasOverlap && menuRoot instanceof ShadowRoot
          ? menuRoot.elementFromPoint((overlapLeft + overlapRight) / 2, (overlapTop + overlapBottom) / 2)?.closest('.context-view.monaco-menu-container') === contextMenu
          : hasOverlap && document.elementFromPoint((overlapLeft + overlapRight) / 2, (overlapTop + overlapBottom) / 2)?.closest('.context-view.monaco-menu-container') === contextMenu;
        return { zIndex: sourceStyle.zIndex, overflow: sourceStyle.overflow, hasOverlap, topmost };
      });
      expect(layering).toEqual({ zIndex: '10', overflow: 'visible', hasOverlap: true, topmost: true });
    } finally {
      await app.close();
    }
  }, 60000);
});
