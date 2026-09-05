import { describe, expect, it } from 'vitest';
import { managedRuntimeExecutableRelativePath } from './platform.js';

describe('managed runtime executable layout', () => {
  it('uses the POSIX Node archive layout', () => {
    expect(managedRuntimeExecutableRelativePath('node', 'darwin').replace(/\\/g, '/')).toBe('bin/node');
    expect(managedRuntimeExecutableRelativePath('node', 'linux').replace(/\\/g, '/')).toBe('bin/node');
  });

  it('keeps non-Node managed binaries at the archive root', () => {
    expect(managedRuntimeExecutableRelativePath('deno', 'darwin')).toBe('deno');
    expect(managedRuntimeExecutableRelativePath('deno', 'win32')).toBe('deno.exe');
  });

  it('keeps Windows Node archives flat', () => {
    expect(managedRuntimeExecutableRelativePath('node', 'win32')).toBe('node.exe');
  });
});
