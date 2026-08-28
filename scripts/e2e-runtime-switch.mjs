#!/usr/bin/env node
/**
 * E2E: runtime switching (user follow-up) — Playwright _electron.
 *
 * Journey: launch the app against the running dev renderer (vite :5189) with
 * the REAL environment (system bun on PATH, managed node in the real cache),
 * type a runtime-discriminator program, run on the default runtime (node),
 * switch the active runtime to bun via the Runtimes panel, run again, and
 * assert the second run actually executed under bun.
 *
 * The test instance uses a temp --user-data-dir so it bypasses the dev
 * electron's single-instance lock and starts with a fresh UI state.
 *
 * Run:  node scripts/e2e-runtime-switch.mjs   (dev stack must be up: pnpm dev)
 */
import { _electron as electron } from 'playwright';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const log = (m) => console.log(`[e2e-rs] ${m}`);

const userData = await mkdtemp(join(tmpdir(), 'rh-rs-userdata-'));
const env = { ...process.env, ELECTRON_RENDERER_URL: 'http://localhost:5189/' };

log('launching electron (dev renderer via ELECTRON_RENDERER_URL)…');
const app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], env, timeout: 60_000 });
const win = await app.firstWindow();
win.on('console', (msg) => {
  const t = msg.text();
  if (t.startsWith('[boot]') || t.startsWith('[run]')) log(t);
});

await win.waitForFunction(() => window.__rh_editor !== undefined, null, { timeout: 30_000 });
log('editor ready');

const PROGRAM = [
  "console.log('runtime:', typeof Bun !== 'undefined' ? 'bun' : typeof Deno !== 'undefined' ? 'deno' : 'node');",
  "console.log('version:', typeof Bun !== 'undefined' ? Bun.version : typeof Deno !== 'undefined' ? Deno.version.deno : process.version);"
].join('\n');
await win.evaluate(([v]) => window.__rh_editor.setValue(v), [PROGRAM]);
log('program typed');

// 1. Run on the default runtime (node).
await win.locator('.monaco-editor').click();
await win.keyboard.press('Control+Enter');
try {
  await win.waitForFunction(() => document.body.innerText.includes('runtime: node'), null, { timeout: 30_000 });
} catch {
  const snap = await win.evaluate(() => document.body.innerText.slice(0, 900));
  log(`NODE RUN SNAPSHOT: ${snap.replace(/\n/g, ' | ')}`);
  throw new Error('node run did not produce runtime: node');
}
log('node run OK');

// 2. Switch the active runtime to bun via the Runtimes panel.
await win.getByRole('button', { name: 'runtimes', exact: true }).click();
await win.getByRole('button', { name: /^Bun$/, exact: true }).first().click();
await win.getByRole('button', { name: 'console', exact: true }).click();
log('switched active runtime to bun');

// 3. Run again — must execute under bun.
await win.locator('.monaco-editor').click();
await win.keyboard.press('Control+Enter');
try {
  await win.waitForFunction(() => document.body.innerText.includes('runtime: bun'), null, { timeout: 30_000 });
} catch {
  const snap = await win.evaluate(() => document.body.innerText.slice(0, 900));
  log(`BUN RUN SNAPSHOT: ${snap.replace(/\n/g, ' | ')}`);
  throw new Error('bun run did not produce runtime: bun');
}
log('bun run OK');

// 4. Status badge must name the runtime that actually ran (bun, not node).
const badge = await win.evaluate(() => {
  const el = [...document.querySelectorAll('span')].find(
    (s) => /exit \d+/.test(s.textContent ?? '') && (s.textContent ?? '').length < 120
  );
  return el?.textContent?.replace(/\s+/g, ' ').trim() ?? '(badge not found)';
});
log(`status badge: ${badge}`);
if (!/bun v/.test(badge)) {
  const dump = await win.evaluate(() => {
    const spans = [...document.querySelectorAll('span')]
      .map((s) => s.textContent?.replace(/\s+/g, ' ').trim())
      .filter((t) => t && t.length < 120)
      .slice(-15);
    return JSON.stringify({ spans, body: document.body.innerText.slice(0, 1200) });
  });
  log(`BADGE DEBUG: ${dump}`);
}
assert.match(badge, /bun v/, `badge must show bun runtime, got: ${badge}`);

console.log(JSON.stringify({ ok: true, nodeRun: 'node', bunRun: 'bun', badge }, null, 2));
await app.close();
await rm(userData, { recursive: true, force: true });
log('PASS');