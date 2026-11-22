/**
 * E2E (plan todo 4): launch the REAL Electron app, drive Monaco through the
 * test hooks, assert TypeScript diagnostics appear for a deliberate type error,
 * and verify the typed IPC ping round-trip.
 *
 * Requires a prior `pnpm build` (launches out/main/index.js).
 */
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { _electron, type ElectronApplication, type Page } from 'playwright';

const mainEntry = resolve(process.cwd(), 'out/main/index.js');
let currentProfile: string | undefined;
let currentApp: ElectronApplication | undefined;
let processExited: Promise<void> | undefined;

afterEach(async () => {
  const profile = currentProfile;
  try {
    await currentApp?.close();
    await processExited;
  } finally {
    currentApp = undefined;
    currentProfile = undefined;
    processExited = undefined;
    if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

async function launchApp(): Promise<{ app: ElectronApplication; page: Page; profile: string }> {
  const t0 = Date.now();
  const step = (m: string): void => console.log(`[e2e-monaco +${Date.now() - t0}ms] ${m}`);
  const profile = await mkdtemp(join(tmpdir(), 'rh-monaco-'));
  currentProfile = profile;
  const app = await _electron.launch({
    args: [mainEntry, `--user-data-dir=${join(profile, 'chromium')}`],
    env: {
      ...process.env, ELECTRON_ENABLE_LOGGING: '1', USERPROFILE: profile, HOME: profile,
      APPDATA: join(profile, 'config'), LOCALAPPDATA: join(profile, 'local'),
      XDG_CONFIG_HOME: join(profile, 'config'), RH_CACHE_ROOT: join(profile, 'cache')
    }
  });
  currentApp = app;
  const child = app.process();
  processExited = child.exitCode !== null || child.signalCode !== null
    ? Promise.resolve()
    : new Promise<void>((resolve) => { child.once('exit', () => resolve()); });
  app.once('close', () => { if (currentApp === app) currentApp = undefined; });
  step('launched');
  child.stdout?.on('data', (c: Buffer) => {
    const text = c.toString().trim();
    if (text !== '') step(`main.out: ${text.slice(0, 200)}`);
  });
  child.stderr?.on('data', (c: Buffer) => {
    const text = c.toString().trim();
    if (text !== '') step(`main.err: ${text.slice(0, 300)}`);
  });
  const page = await app.firstWindow();
  // Electron handles beforeunload in the main process. Chromium reports a
  // dialog to Playwright even though there is no browser dialog to dismiss.
  page.on('dialog', (dialog) => { if (dialog.type() !== 'beforeunload') void dialog.dismiss(); });
  step('firstWindow');
  await page.waitForSelector('#root', { timeout: 20000 });
  step('#root');
  // #root is static HTML — wait for the editor test hook so React has actually
  // mounted and the workspace bootstrap (settingsGet → openFile) has finished.
  await page.waitForFunction(() => Boolean((window as unknown as Record<string, unknown>)['__rh_editor']), undefined, {
    timeout: 20000
  });
  step('editor-hook');
  return { app, page, profile };
}

describe.skipIf(!existsSync(mainEntry))('monaco e2e (built app)', () => {
  it('reports a conflicting rename and leaves the closed target untouched', async () => {
    const { app, page } = await launchApp();
    try {
      await page.evaluate(() => window.api.saveFile({ workspaceId: 'default', relPath: 'taken.ts', content: 'already saved' }));
      await page.locator('[data-file-id="default:entry.ts"]').click({ button: 'right' });
      await page.getByRole('menuitem', { name: 'Rename…' }).click();
      const dialog = page.getByRole('dialog', { name: 'Rename tab' });
      await dialog.getByRole('textbox').fill('taken.ts');
      await dialog.getByRole('textbox').press('Enter');
      await dialog.getByRole('alert').filter({ hasText: /already exists/i }).waitFor();
      expect(await page.evaluate(() => window.api.readFile({ workspaceId: 'default', relPath: 'taken.ts' }))).toEqual({ ok: true, content: 'already saved' });
      await dialog.getByRole('textbox').fill('available.ts');
      await dialog.getByRole('textbox').press('Enter');
      await page.getByRole('button', { name: 'Close available.ts', exact: true }).waitFor();
      expect(await page.evaluate(() => window.api.readFile({ workspaceId: 'default', relPath: 'available.ts' }))).toMatchObject({ ok: true, content: expect.stringContaining('const values') });
    } finally { await app.close(); }
  }, 60000);

  it.each(['retry', 'discard'])('lets the user %s a failed settings write before closing', async (choice) => {
    const { app, page, profile } = await launchApp();
    const config = process.platform === 'darwin' ? join(profile, 'Library', 'Application Support') : join(profile, 'config');
    const settingsPath = join(config, 'RuntimeHell', 'settings.json');
    let blocked = false;
    try {
      await page.evaluate(() => window.api.settingsSet({}));
      await rename(settingsPath, `${settingsPath}.bak`);
      await mkdir(settingsPath);
      blocked = true;
      await page.getByRole('button', { name: 'auto-run off', exact: true }).click();
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close());
      const dialog = page.getByRole('dialog', { name: 'Settings could not be saved' });
      await dialog.waitFor({ timeout: 5000 });
      if (choice === 'retry') {
        await rmdir(settingsPath);
        await rename(`${settingsPath}.bak`, settingsPath);
        blocked = false;
      }
      const button = dialog.getByRole('button', { name: choice === 'retry' ? 'Retry save' : 'Continue without saving settings' });
      await Promise.all([
        page.waitForEvent('close', { timeout: 8000 }),
        button.click().catch((error: unknown) => {
          // Electron can destroy the page before Playwright acknowledges the click.
          if (!(error instanceof Error) || !error.message.includes('Target page, context or browser has been closed')) throw error;
        })
      ]);
      const path = blocked ? `${settingsPath}.bak` : settingsPath;
      expect(JSON.parse(await readFile(path, 'utf8')).prefs.autorun).toBe(choice === 'retry');
    } finally {
      if (blocked) {
        await rmdir(settingsPath);
        await rename(`${settingsPath}.bak`, settingsPath);
      }
      await currentApp?.close();
    }
  }, 60000);

  it('restores later tabs after a bad entry and remembers which workspace owns the active file', async () => {
    const { app, page } = await launchApp();
    try {
      await page.evaluate(async () => {
        const tabs = ['first', 'second'].map((workspaceId) => ({ workspaceId, relPath: 'same.ts' }));
        for (const tab of tabs) await window.api.saveFile({ ...tab, content: tab.workspaceId });
        await window.api.settingsSet({
          session: { tabs: [{ workspaceId: 'old invalid id', relPath: 'invalid.ts' }, ...tabs], activeRelPath: 'same.ts' }
        });
      });
      await page.reload();
      await page.locator('[data-file-id="first:same.ts"].is-active').waitFor({ timeout: 8000 });
      await page.locator('[data-file-id="second:same.ts"]').click();
      await expect.poll(() => page.evaluate(async () => (await window.api.settingsGet()).session.activeWorkspaceId), { timeout: 5000 }).toBe('second');
      await page.reload();
      await page.locator('[data-file-id="second:same.ts"].is-active').waitFor({ timeout: 8000 });
      expect(await page.evaluate(() => (window as unknown as { __rh_editor: { getValue(): string } }).__rh_editor.getValue())).toBe('second');
    } finally {
      await app.close();
    }
  }, 60000);

  it('restores the cursor and undo history when returning to an open tab', async () => {
    const { app, page } = await launchApp();
    try {
      await page.evaluate(() => {
        const editor = (window as unknown as { __rh_editor: { setValue(value: string): void; setSelection(a: number, b: number, c: number, d: number): void } }).__rh_editor;
        editor.setValue('alpha\nbeta');
        editor.setSelection(2, 2, 2, 2);
      });
      await page.keyboard.type('X');
      await page.getByRole('button', { name: 'New tab', exact: true }).click();
      await page.locator('[data-file-id="default:untitled-2.ts"].is-active').waitFor();
      await page.locator('[data-file-id="default:entry.ts"]').click();
      const cursor = await page.evaluate(() => {
        const editor = (window as unknown as { __rh_monaco: { editor: { getEditors(): { focus(): void; getPosition(): unknown }[] } } }).__rh_monaco.editor.getEditors()[0]!;
        editor.focus();
        return editor.getPosition();
      });
      expect(cursor).toMatchObject({ lineNumber: 2, column: 3 });
      await page.keyboard.press('ControlOrMeta+z');
      expect(await page.evaluate(() => (window as unknown as { __rh_editor: { getValue(): string } }).__rh_editor.getValue())).toBe('alpha\nbeta');
      await page.getByRole('button', { name: 'Close entry.ts', exact: true }).click();
      await expect.poll(() => page.evaluate(() => {
        const monaco = (window as unknown as { __rh_monaco: { editor: { getModels(): { getValue(): string }[] } } }).__rh_monaco;
        return monaco.editor.getModels().some((model) => model.getValue() === 'alpha\nbeta');
      }), { timeout: 5000 }).toBe(false);
    } finally {
      await app.close();
    }
  }, 60000);

  it('writes the last edit before reload and native window close', async () => {
    const { app, page, profile } = await launchApp();
    const entry = join(profile, 'RuntimeHell', 'workspaces', 'default', 'entry.ts');
    let writeBlocked = false;
    try {
      await page.locator('.monaco-editor').first().click();
      await page.evaluate(() => {
        (window as unknown as { __rh_editor: { setValue: (value: string) => void } }).__rh_editor.setValue('const beforeReload = 1;');
      });
      const reload = page.waitForEvent('load', { timeout: 15000 });
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.reload());
      await reload;
      await page.waitForFunction(() => Boolean((window as unknown as Record<string, unknown>).__rh_editor));
      expect(await page.evaluate(() => (window as unknown as { __rh_editor: { getValue: () => string } }).__rh_editor.getValue())).toBe('const beforeReload = 1;');
      await page.locator('.monaco-editor').first().click();

      await rename(entry, `${entry}.bak`);
      await mkdir(entry);
      writeBlocked = true;
      await page.evaluate(() => {
        (window as unknown as { __rh_editor: { setValue: (value: string) => void } }).__rh_editor.setValue('const beforeClose = 2;');
        void window.api.windowClose();
      });
      await page.getByRole('status').filter({ hasText: 'Could not save entry.ts' }).waitFor();
      expect(await page.evaluate(() => (window as unknown as { __rh_editor: { getValue: () => string } }).__rh_editor.getValue())).toBe('const beforeClose = 2;');
      await rmdir(entry);
      writeBlocked = false;
      const closed = page.waitForEvent('close', { timeout: 10000 });
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close());
      await closed;
      expect(await readFile(entry, 'utf8')).toBe('const beforeClose = 2;');
    } finally {
      if (writeBlocked) await rmdir(entry);
      await currentApp?.close();
    }
  }, 60000);

  it('saves edits when switching away and closing a tab before autosave', async () => {
    const { app, page } = await launchApp();
    try {
      const edit = (value: string) => page.evaluate((source) => {
        const editor = (window as unknown as { __rh_editor: { setValue: (value: string) => void } }).__rh_editor;
        editor.setValue(source);
      }, value);
      const read = (relPath: string) => page.evaluate((path) => window.api.readFile({ workspaceId: 'default', relPath: path }), relPath);
      await edit('const retained = 1;');
      await page.getByRole('button', { name: 'New tab', exact: true }).click();
      await expect.poll(() => read('entry.ts'), { timeout: 5000 }).toEqual({ ok: true, content: 'const retained = 1;' });

      await edit('const retained = 2;');
      await page.getByRole('button', { name: 'Close untitled-2.ts', exact: true }).click();
      await expect.poll(() => read('untitled-2.ts'), { timeout: 5000 }).toEqual({ ok: true, content: 'const retained = 2;' });
      await page.getByRole('button', { name: 'New tab', exact: true }).click();
      await page.getByRole('button', { name: 'Close untitled-3.ts', exact: true }).waitFor();
      await expect.poll(() => read('untitled-3.ts'), { timeout: 5000 }).toMatchObject({ ok: true, content: expect.stringContaining('hello from tab 3') });
    } finally {
      await app.close();
    }
  }, 60000);

  it('runs Vim text objects, macros, and the LazyVim help mapping', async () => {
    const { app, page } = await launchApp();
    const originalVimMode = await page.evaluate(async () => (await window.api.settingsGet()).editor.vimMode);
    try {
      await page.evaluate(() => window.api.settingsSet({ editor: { vimMode: true } }));
      await page.reload();
      await page.waitForFunction(() => Boolean((window as unknown as Record<string, unknown>)['__rh_editor']), undefined, { timeout: 20000 });
      await page.locator('.rh-vim-statusline').waitFor({ state: 'visible', timeout: 10000 });

      const sourceCount = await page.locator('.rh-tab[data-file-id]').count();
      await page.evaluate(() => ((window as unknown as Record<string, unknown>)['__rh_editor'] as { setSelection: (a: number, b: number, c: number, d: number) => void }).setSelection(1, 1, 1, 1));
      await page.keyboard.press('Control+n');
      expect(await page.locator('.rh-tab[data-file-id]').count()).toBe(sourceCount);

      await page.evaluate(() => {
        const editor = (window as unknown as Record<string, unknown>)['__rh_editor'] as {
          setValue: (value: string) => void;
          setSelection: (startLine: number, startCol: number, endLine: number, endCol: number) => void;
        };
        editor.setValue('alpha beta\nsecond line\n');
        editor.setSelection(1, 1, 1, 1);
      });

      await page.keyboard.press('d');
      await page.keyboard.press('i');
      await page.keyboard.press('w');
      expect(await page.evaluate(() => ((window as unknown as Record<string, unknown>)['__rh_editor'] as { getValue: () => string }).getValue())).toBe(' beta\nsecond line\n');

      await page.keyboard.press('u');
      expect(await page.evaluate(() => ((window as unknown as Record<string, unknown>)['__rh_editor'] as { getValue: () => string }).getValue())).toBe('alpha beta\nsecond line\n');

      await page.evaluate(() => {
        const editor = (window as unknown as Record<string, unknown>)['__rh_editor'] as {
          setValue: (value: string) => void;
          setSelection: (startLine: number, startCol: number, endLine: number, endCol: number) => void;
        };
        editor.setValue('abcd');
        editor.setSelection(1, 1, 1, 1);
      });
      for (const key of ['q', 'a', 'x', 'q', '@', 'a']) await page.keyboard.press(key);
      expect(await page.evaluate(() => ((window as unknown as Record<string, unknown>)['__rh_editor'] as { getValue: () => string }).getValue())).toBe('cd');

      await page.keyboard.press('Space');
      await page.keyboard.press('Shift+/');
      await page.locator('.rh-vim-help').waitFor({ state: 'visible', timeout: 5000 });
      expect(await page.locator('.rh-vim-help-heading').textContent()).toContain('LazyVim keybindings');
    } finally {
      await page.evaluate((vimMode) => window.api.settingsSet({ editor: { vimMode } }), originalVimMode).catch(() => undefined);
      await app.close();
    }
  }, 60000);

  it('checks an imported function against its acquired declaration', async () => {
    const { page } = await launchApp();
    const responses = new Map<string, string>([
      ['/v1/package/resolve/npm/rh-types-fixture@latest', JSON.stringify({ version: '1.0.0' })],
      ['/v1/package/npm/rh-types-fixture@1.0.0/flat', JSON.stringify({ files: [{ name: '/index.d.ts' }] })],
      ['/npm/rh-types-fixture@1.0.0/package.json', JSON.stringify({ types: 'index.d.ts' })],
      ['/npm/rh-types-fixture@1.0.0/index.d.ts', 'export function twice(value: number): number;'],
    ]);
    await page.context().route(/^https:\/\/(?:data\.jsdelivr\.com|cdn\.jsdelivr\.net)\//, async (route) => {
      const body = responses.get(new URL(route.request().url()).pathname);
      await route.fulfill({ status: body ? 200 : 404, headers: { 'access-control-allow-origin': '*' }, body });
    });
    await page.evaluate(() => {
      const editor = (window as unknown as { __rh_editor: { setValue: (value: string) => void } }).__rh_editor;
      editor.setValue('import { twice } from "rh-types-fixture";\ntwice("wrong");');
    });
    await expect.poll(() => page.evaluate(() => {
      const monaco = (window as unknown as { __rh_monaco: typeof import('monaco-editor') }).__rh_monaco;
      return monaco.editor.getModelMarkers({}).map((marker) => marker.code);
    }), { timeout: 8000 }).toEqual(['2345']);
  }, 30000);

  it('boots, pings main, and surfaces TS diagnostics for a type error', async () => {
    const { app, page } = await launchApp();
    try {
      const policy = await page.evaluate(() =>
        document.querySelector<HTMLMetaElement>('meta[http-equiv="Content-Security-Policy"]')?.content);
      expect(policy?.split(/;\s*/)).toContain("script-src 'self'");

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
      expect(await page.evaluate(() => ((window as unknown as Record<string, unknown>)['__rh_monaco'] as { editor: { getModelMarkers: (options: object) => Array<{ code?: string }> } }).editor.getModelMarkers({}).some((marker) => marker.code === '2322'))).toBe(true);

      // The language picker must change the Monaco model as well as the run
      // preference. TS-only syntax is valid in TypeScript and a syntax error
      // in JavaScript, then becomes valid again when switched back.
      const languageTrigger = page.locator('.rh-titlebar-language-trigger');
      const initialLanguage = await languageTrigger.textContent();
      expect(initialLanguage === null || !/JavaScript|TypeScript/.test(initialLanguage)).toBe(true);
      expect(await languageTrigger.getAttribute('aria-label')).toMatch(/Language: (JavaScript|TypeScript)/);
      await languageTrigger.click();
      const languageOptions = page.locator('.rh-titlebar-language-option');
      const optionText = await languageOptions.allTextContents();
      expect(optionText.join(' ')).toContain('JavaScript');
      expect(optionText.join(' ')).toContain('TypeScript');
      await languageOptions.filter({ hasText: 'TypeScript' }).click();
      expect((await languageTrigger.textContent()) ?? '').not.toMatch(/JavaScript|TypeScript/);
      expect(await languageTrigger.getAttribute('aria-label')).toBe('Language: TypeScript');
      await page.evaluate(() => {
        const ed = (window as never as Record<string, unknown>)['__rh_editor'] as { setValue: (v: string) => void; setLanguage: (v: string) => void };
        ed.setLanguage('typescript');
        ed.setValue('interface User { name: string }\nconst user: User = { name: \'ok\' };\n');
      });
      await page.waitForTimeout(1000);
      const tsLanguageId = await page.evaluate(() => ((window as never as Record<string, unknown>)['__rh_monaco'] as { editor: { getEditors: () => Array<{ getModel: () => { getLanguageId: () => string } | null }> } }).editor.getEditors()[0]?.getModel()?.getLanguageId());
      expect(tsLanguageId).toBe('typescript');
      await page.waitForFunction(() => ((window as unknown as Record<string, unknown>)['__rh_monaco'] as { editor: { getModelMarkers: (options: object) => unknown[] } }).editor.getModelMarkers({}).length === 0, undefined, { timeout: 5000 });

      await page.evaluate(() => {
        const ed = (window as never as Record<string, unknown>)['__rh_editor'] as { setLanguage: (v: string) => void };
        ed.setLanguage('javascript');
      });
      await page.waitForFunction(() => ((window as never as Record<string, unknown>)['__rh_monaco'] as { editor: { getModelMarkers: (o: object) => unknown[] } }).editor.getModelMarkers({}).length > 0, undefined, { timeout: 5000 });
      const jsMarkerCount = await page.evaluate(() => ((window as never as Record<string, unknown>)['__rh_monaco'] as { editor: { getModelMarkers: (o: object) => unknown[] } }).editor.getModelMarkers({}).length);
      expect(jsMarkerCount).toBeGreaterThanOrEqual(1);
      const jsLanguageId = await page.evaluate(() => ((window as never as Record<string, unknown>)['__rh_monaco'] as { editor: { getEditors: () => Array<{ getModel: () => { getLanguageId: () => string } | null }> } }).editor.getEditors()[0]?.getModel()?.getLanguageId());
      expect(jsLanguageId).toBe('javascript');

      await page.evaluate(() => {
        const ed = (window as never as Record<string, unknown>)['__rh_editor'] as { setLanguage: (v: string) => void };
        ed.setLanguage('typescript');
      });
      await page.waitForTimeout(1000);
      const restoredTsLanguageId = await page.evaluate(() => ((window as never as Record<string, unknown>)['__rh_monaco'] as { editor: { getEditors: () => Array<{ getModel: () => { getLanguageId: () => string } | null }> } }).editor.getEditors()[0]?.getModel()?.getLanguageId());
      expect(restoredTsLanguageId).toBe('typescript');
      await page.waitForFunction(() => ((window as unknown as Record<string, unknown>)['__rh_monaco'] as { editor: { getModelMarkers: (options: object) => unknown[] } }).editor.getModelMarkers({}).length === 0, undefined, { timeout: 5000 });
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
      expect(layering).not.toBeNull();
      expect(layering).toMatchObject({ zIndex: '10', overflow: 'visible' });
      // The menu position depends on the available viewport and Monaco's
      // remembered cursor location. When it actually crosses the dock, the
      // source frame must remain the topmost layer; otherwise there is no
      // occlusion relationship to assert.
      if (layering?.hasOverlap) expect(layering.topmost).toBe(true);
    } finally {
      await app.close();
    }
  }, 60000);
});
