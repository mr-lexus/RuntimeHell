/**
 * Runtime detection unit tests (feature): pure parseNvmVersions mapping plus
 * nvmRoot/nvmSymlink env-driven defaults. detectSystemRuntime/detectNvmNode
 * spawn processes / touch the fs — covered by integration, not here.
 */
import { describe, expect, it } from 'vitest';
import { nvmRoot, nvmSymlink, parseNvmVersions, parseRuntimeVersionOutput } from './runtime-detection.js';
import { executableName, isWindows } from '../platform.js';
import { join } from 'node:path';

describe('parseRuntimeVersionOutput', () => {
  it('parses Firefox --version output for system browser detection', () => {
    expect(parseRuntimeVersionOutput('firefox', 'Mozilla Firefox 141.0.1\r\n')).toBe('141.0.1');
    expect(parseRuntimeVersionOutput('chrome', 'Google Chrome 140.0.7339.81\r\n')).toBe('140.0.7339.81');
  });
});

describe('parseNvmVersions', () => {
  it('maps vX.Y.Z dirs to rows, newest first, marking the active target', () => {
    const rows = parseNvmVersions('C:/nvm', ['v20.11.0', 'v22.17.0', 'v18.20.4', 'README.md', 'settings.txt'], 'C:/nvm/v22.17.0');
    const expectedExe = (version: string) => isWindows()
      ? `C:\\nvm\\v${version}\\${executableName('node')}`
      : join('C:/nvm', `v${version}`, 'bin', executableName('node'));
    expect(rows).toEqual([
      { version: '22.17.0', exePath: expectedExe('22.17.0'), active: true },
      { version: '20.11.0', exePath: expectedExe('20.11.0'), active: false },
      { version: '18.20.4', exePath: expectedExe('18.20.4'), active: false }
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

  it('defaults to the native nvm root and active link', () => {
    const home = process.env['NVM_HOME'];
    const symlink = process.env['NVM_SYMLINK'];
    const appdata = process.env['APPDATA'];
    const pf = process.env['ProgramFiles'];
    const nvmDir = process.env['NVM_DIR'];
    const nvmBin = process.env['NVM_BIN'];
    try {
      delete process.env['NVM_HOME'];
      delete process.env['NVM_SYMLINK'];
      if (isWindows()) {
        process.env['APPDATA'] = 'C:/Users/t/AppData/Roaming';
        process.env['ProgramFiles'] = 'C:/Program Files';
        expect(nvmRoot()).toBe('C:\\Users\\t\\AppData\\Roaming\\nvm');
        expect(nvmSymlink()).toBe('C:\\Program Files\\nodejs');
      } else {
        delete process.env['NVM_DIR'];
        delete process.env['NVM_BIN'];
        expect(nvmRoot()).toMatch(/[\\/]\.nvm[\\/]versions[\\/]node$/);
        expect(nvmSymlink()).toBeTruthy();
      }
    } finally {
      if (home !== undefined) process.env['NVM_HOME'] = home;
      else delete process.env['NVM_HOME'];
      if (symlink !== undefined) process.env['NVM_SYMLINK'] = symlink;
      else delete process.env['NVM_SYMLINK'];
      if (appdata !== undefined) process.env['APPDATA'] = appdata;
      else delete process.env['APPDATA'];
      if (pf !== undefined) process.env['ProgramFiles'] = pf;
      else delete process.env['ProgramFiles'];
      if (nvmDir !== undefined) process.env['NVM_DIR'] = nvmDir;
      else delete process.env['NVM_DIR'];
      if (nvmBin !== undefined) process.env['NVM_BIN'] = nvmBin;
      else delete process.env['NVM_BIN'];
    }
  });
});
