import { describe, expect, it } from 'vitest';
import { shouldQuitAfterAllWindowsClosed } from './app-lifecycle.js';

describe('application lifecycle', () => {
  it('keeps the application alive for Dock reactivation on macOS', () => {
    expect(shouldQuitAfterAllWindowsClosed('darwin')).toBe(false);
  });

  it('quits with the last window on Windows and Linux', () => {
    expect(shouldQuitAfterAllWindowsClosed('win32')).toBe(true);
    expect(shouldQuitAfterAllWindowsClosed('linux')).toBe(true);
  });
});
