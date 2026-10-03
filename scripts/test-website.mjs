import { createServer } from 'node:http';
import { readFile, stat, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, extname, sep } from 'node:path';
import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';

const root = resolve('website/dist');
const output = resolve('.rhbuild/website');
await mkdir(output, { recursive: true });
const server = createServer(async (request, response) => {
  try {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (!path.startsWith('/RuntimeHell/')) { response.writeHead(404).end(); return; }
    let file = resolve(root, path.slice('/RuntimeHell/'.length));
    if (file !== root && !file.startsWith(root + sep)) { response.writeHead(403).end(); return; }
    if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
    const type = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' }[extname(file)] ?? 'text/plain';
    response.writeHead(200, { 'Content-Type': type }).end(await readFile(file));
  } catch { response.writeHead(404).end(); }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}/RuntimeHell/`;
const profile = await mkdtemp(resolve(tmpdir(), 'rh-site-qa-'));
const browser = await electron.launch({ args: [resolve('scripts/website-preview.cjs'), `--user-data-dir=${profile}`] });
const page = await browser.firstWindow();
try {
  for (const lang of ['en', 'ru']) {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width > 700 ? 1000 : 844 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      page.removeAllListeners('pageerror');
      page.removeAllListeners('response');
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('response', (response) => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
      await page.goto(base + (lang === 'ru' ? 'ru/' : ''), { waitUntil: 'networkidle' });
      assert.equal(await page.locator('html').getAttribute('lang'), lang);
      assert.equal(await page.locator('h1').count(), 1);
      assert.equal(await page.locator('.download-card').count(), 4);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${lang}/${width}: horizontal overflow`);
      for (const image of await page.locator('img[src]').all()) {
        await image.scrollIntoViewIfNeeded();
        await image.evaluate((element) => element.decode());
      }
      await page.locator('.hero-screen [data-lightbox]').click();
      await page.locator('dialog[open]').waitFor();
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('dialog[open]').count(), 0);
      await page.locator('summary').first().click();
      assert.equal(await page.locator('details[open]').count(), 1);
      for (const link of await page.locator('a[href^="#"]').all()) {
        const href = await link.getAttribute('href');
        assert.equal(await page.locator(href).count(), 1, `missing ${href}`);
      }
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: resolve(output, `${lang}-${width}.png`), fullPage: true });
      assert.deepEqual(errors, []);
      const other = lang === 'en' ? 'ru' : 'en';
      await page.locator(`.languages a[lang="${other}"]`).click();
      assert.equal(await page.locator('html').getAttribute('lang'), other);
    }
  }
  const noJs = await electron.launch({ args: [resolve('scripts/website-preview.cjs'), '--no-js', `--user-data-dir=${profile}-nojs`] });
  try {
    const fallback = await noJs.firstWindow();
    await fallback.goto(base);
    assert.equal(await fallback.locator('h1').isVisible(), true);
    await fallback.locator('.download-card').first().scrollIntoViewIfNeeded();
    assert.equal(await fallback.locator('.download-card').first().isVisible(), true);
  } finally { await noJs.close(); }
  console.log('PASS: EN/RU, desktop/mobile, assets, no overflow, downloads, anchors, language switch, screenshot dialog, keyboard Escape, FAQ and no-JS fallback.');
  console.log(`Visual QA: ${output}`);
} finally { await browser.close(); server.close(); }
