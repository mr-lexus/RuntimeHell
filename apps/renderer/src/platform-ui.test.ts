import { describe, expect, it } from 'vitest';
import { localExecutablePlaceholder, primaryShortcut } from './platform-ui';

describe('platform UI labels', () => {
  it('uses the native primary modifier', () => {
    expect(primaryShortcut('Enter', 'darwin')).toBe('Cmd+Enter');
    expect(primaryShortcut('Enter', 'win32')).toBe('Ctrl+Enter');
    expect(primaryShortcut('Enter', 'linux')).toBe('Ctrl+Enter');
  });

  it('shows a native-looking local path placeholder', () => {
    expect(localExecutablePlaceholder('darwin')).toBe('/path/to/executable-or-folder');
    expect(localExecutablePlaceholder('linux')).toBe('/path/to/executable-or-folder');
    expect(localExecutablePlaceholder('win32')).toBe('C:\\path\\to\\executable-or-folder');
  });
});
