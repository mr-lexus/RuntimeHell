import { describe, expect, it } from 'vitest';
import { isNpmPackagePage, shouldQuitAfterAllWindowsClosed } from './app-lifecycle.js';

describe('application lifecycle', () => {
  it('recognizes only canonical npm package pages for external links', () => {
    expect(isNpmPackagePage('https://www.npmjs.com/package/@types/node')).toBe(true);
    expect(isNpmPackagePage('https://www.npmjs.com/package/lodash')).toBe(true);
    for (const url of ['https://example.com/package/lodash', 'https://www.npmjs.com/login',
      'https://www.npmjs.com/package/lodash?next=x', 'file:///package/lodash']) {
      expect(isNpmPackagePage(url)).toBe(false);
    }
  });
  it('keeps the application alive for Dock reactivation on macOS', () => {
    expect(shouldQuitAfterAllWindowsClosed('darwin')).toBe(false);
  });

  it('quits with the last window on Windows and Linux', () => {
    expect(shouldQuitAfterAllWindowsClosed('win32')).toBe(true);
    expect(shouldQuitAfterAllWindowsClosed('linux')).toBe(true);
  });
});
