#!/usr/bin/env node
/**
 * Copies runtime assets next to the built main bundle (plan todo 22).
 * electron-vite's lib build only emits bundled JS; anything referenced via
 * __dirname at runtime must be copied explicitly:
 *   out/main/templates/*.cjs  (result-capture bootstrap + fd3 probe)
 *   out/main/assets/icon.png   (BrowserWindow/taskbar icon)
 */
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const src = resolve(process.cwd(), 'apps/main/src/execution/templates');
const dest = resolve(process.cwd(), 'out/main/templates');
const mitataSrc = resolve(process.cwd(), 'apps/main/node_modules/mitata/src');
const mitataDest = resolve(process.cwd(), 'out/main/mitata/src');
const iconSrc = resolve(process.cwd(), 'build/icon.png');
const iconDest = resolve(process.cwd(), 'out/main/assets/icon.png');

if (!existsSync(src)) {
  console.error(`[copy-main-assets] missing source: ${src}`);
  process.exit(1);
}
cpSync(src, dest, { recursive: true });
console.log(`[copy-main-assets] ${src} -> ${dest}`);

if (!existsSync(iconSrc)) {
  console.error(`[copy-main-assets] missing source: ${iconSrc}; run pnpm brand:icons`);
  process.exit(1);
}
mkdirSync(resolve(process.cwd(), 'out/main/assets'), { recursive: true });
cpSync(iconSrc, iconDest);
console.log(`[copy-main-assets] ${iconSrc} -> ${iconDest}`);

if (!existsSync(mitataSrc)) {
  console.error(`[copy-main-assets] missing Mitata source: ${mitataSrc}`);
  process.exit(1);
}
cpSync(mitataSrc, mitataDest, { recursive: true });
console.log(`[copy-main-assets] ${mitataSrc} -> ${mitataDest}`);
