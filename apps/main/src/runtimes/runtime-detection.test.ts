/**
 * Runtime detection unit tests (feature): pure parseNvmVersions mapping plus
 * nvmRoot/nvmSymlink env-driven defaults. detectSystemRuntime/detectNvmNode
 * spawn processes / touch the fs — covered by integration, not here.
 */
import { describe, expect, it } from 'vitest';
import { nvmRoot, nvmSymlink, parseNvmVersions } from './runtime-detection.js';

describe('parseNvmVersions', () => {
  it('maps vX.Y.Z dirs to rows, newest first, marking the active target', () => {
    const rows = parseNvmVersions('C:/nvm', ['v20.11.0', 'v22.17.0', 'v18.20.4', 'README.md', 'settings.txt'], 'C:/nvm/v22.17.0');
    expect(rows).toEqual([
      { version: '22.17.0', exePath: 'C:\\nvm\\v22.17.0\\node.exe', active: true },
      { version: '20.11.0', exePath: 'C:\\nvm\\v20.11.0\\node.exe', active: false },
      { version: '18.20.4', exePath: 'C:\\nvm\\v18.20.4\\node.exe', active: false }
    ]);
  });

  it('marks nothing active when the symlink target is absent', () => {
    const rows = parseNvmVersions('C:/nvm', ['v20.11.0'], null);
    expect(rows[0]?.active).toBe(false);
  });

  it('matches the active target case- and separator-insensitively (Windows paths)', () => {
    const rows = parseNvmVersions('C:/nvm', ['v20.11.0'], 'c:/NVM/V20.11.0');
    expect(rows[0]?.active).toBe(true);
  });

  it('returns [] when no version dirs exist', () => {
    expect(parseNvmVersions('C:/nvm', ['settings.txt'], null)).toEqual([]);
  });
});

describe('nvmRoot / nvmSymlink', () => {
  it('honors NVM_HOME and NVM_SYMLINK env vars', () => {
    const home = process.env['NVM_HOME'];
    const symlink = process.env['NVM_SYMLINK'];
    try {
      process.env['NVM_HOME'] = 'D:/custom-nvm';
      process.env['NVM_SYMLINK'] = 'D:/custom-nodejs';
      expect(nvmRoot()).toBe('D:/custom-nvm');
      expect(nvmSymlink()).toBe('D:/custom-nodejs');
    } finally {
      if (home !== undefined) process.env['NVM_HOME'] = home;
      else delete process.env['NVM_HOME'];
      if (symlink !== undefined) process.env['NVM_SYMLINK'] = symlink;
      else delete process.env['NVM_SYMLINK'];
    }
  });

  it('defaults to %APPDATA%\\nvm and Program Files\\nodejs', () => {
    const home = process.env['NVM_HOME'];
    const symlink = process.env['NVM_SYMLINK'];
    const appdata = process.env['APPDATA'];
    const pf = process.env['ProgramFiles'];
    try {
      delete process.env['NVM_HOME'];
      delete process.env['NVM_SYMLINK'];
      process.env['APPDATA'] = 'C:/Users/t/AppData/Roaming';
      process.env['ProgramFiles'] = 'C:/Program Files';
      expect(nvmRoot()).toBe('C:\\Users\\t\\AppData\\Roaming\\nvm');
      expect(nvmSymlink()).toBe('C:\\Program Files\\nodejs');
    } finally {
      if (home !== undefined) process.env['NVM_HOME'] = home;
      else delete process.env['NVM_HOME'];
      if (symlink !== undefined) process.env['NVM_SYMLINK'] = symlink;
      else delete process.env['NVM_SYMLINK'];
      if (appdata !== undefined) process.env['APPDATA'] = appdata;
      else delete process.env['APPDATA'];
      if (pf !== undefined) process.env['ProgramFiles'] = pf;
      else delete process.env['ProgramFiles'];
    }
  });
});