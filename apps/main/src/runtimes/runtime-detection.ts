/** Cross-platform system runtime and browser detection. */
import { spawn } from 'node:child_process';
import { access, readdir, realpath, stat } from 'node:fs/promises';
import { homedir, platform as osPlatform } from 'node:os';
import { isAbsolute, join } from 'node:path';
import type { NvmInfo, NvmVersionInfo, SystemRuntimeInfo } from '@rh/protocol';
import { commandLookup, executableName, isWindows } from '../platform.js';

export interface DetectedRuntime extends SystemRuntimeInfo {}
export type RuntimeId = 'node' | 'deno' | 'bun';
export type BrowserId = 'chrome' | 'firefox';

function spawnOptions(): { windowsHide?: boolean } {
  return isWindows() ? { windowsHide: true } : {};
}

/** Extract a semver-ish token from the first useful version line. */
export function parseRuntimeVersionOutput(id: string, output: string): string | null {
  const text = output.trim();
  if (!text) return null;
  const patterns: RegExp[] = id === 'chrome'
    ? [/Google Chrome\s+([\d.]+)/i, /Chromium\s+([\d.]+)/i]
    : id === 'firefox'
      ? [/Mozilla Firefox\s+([\d.]+)/i]
      : [/(?:^|\s)v?(\d+(?:\.\d+){2,3}(?:[-+][0-9A-Za-z.-]+)?)/];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match?.[1]) return match[1];
  }
  return null;
}

function lookupCommand(command: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(commandLookup(), [command], spawnOptions());
    let output = '';
    child.stdout?.on('data', (chunk) => { output += String(chunk); });
    child.on('error', () => resolve(null));
    child.on('close', (code) => {
      if (code !== 0) return resolve(null);
      const first = output.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
      resolve(first ?? null);
    });
  });
}

async function resolveCandidate(candidate: string): Promise<string | null> {
  if (isAbsolute(candidate) || candidate.includes('/') || candidate.includes('\\')) {
    try {
      const resolved = await realpath(candidate);
      const details = await stat(resolved);
      return details.isFile() ? resolved : null;
    } catch {
      return null;
    }
  }
  return lookupCommand(candidate);
}

async function readVersion(exePath: string, id: string): Promise<string | null> {
  if (isWindows() && (id === 'chrome' || id === 'firefox')) {
    return readWindowsProductVersion(exePath);
  }
  return new Promise((resolve) => {
    const child = spawn(exePath, ['--version'], spawnOptions());
    let output = '';
    child.stdout?.on('data', (chunk) => { output += String(chunk); });
    child.stderr?.on('data', (chunk) => { output += String(chunk); });
    const timer = setTimeout(() => { child.kill(); resolve(null); }, 5000);
    child.on('error', () => { clearTimeout(timer); resolve(null); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 && !output) return resolve(null);
      resolve(parseRuntimeVersionOutput(id, output));
    });
  });
}

/** Read PE metadata instead of launching a GUI browser with `--version`. */
function readWindowsProductVersion(exePath: string): Promise<string | null> {
  return new Promise((resolve) => {
    const powershell = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const child = spawn(powershell, [
      '-NoProfile', '-NonInteractive', '-Command',
      '[Diagnostics.FileVersionInfo]::GetVersionInfo($env:RH_BROWSER_EXE).ProductVersion'
    ], {
      windowsHide: true,
      env: {
        SystemRoot: process.env['SystemRoot'],
        windir: process.env['windir'],
        TEMP: process.env['TEMP'],
        TMP: process.env['TMP'],
        PATH: join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32'),
        RH_BROWSER_EXE: exePath
      }
    });
    let output = '';
    child.stdout?.on('data', (chunk) => { output += String(chunk); });
    const timer = setTimeout(() => { child.kill(); resolve(null); }, 5000);
    child.on('error', () => { clearTimeout(timer); resolve(null); });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? parseRuntimeVersionOutput('browser', output) : null);
    });
  });
}

/** Detect a command or explicit executable path and read its version. */
export async function detectExecutable(id: string, candidates: string[]): Promise<DetectedRuntime | null> {
  for (const candidate of candidates) {
    const exePath = await resolveCandidate(candidate);
    if (!exePath) continue;
    const version = await readVersion(exePath, id);
    if (version) return { exePath, version };
  }
  return null;
}

export function detectSystemRuntime(id: 'node' | 'deno' | 'bun'): Promise<DetectedRuntime | null> {
  return detectExecutable(id, [id, ...commonRuntimeCandidates(id)]);
}

/** GUI-launched Electron apps may not inherit the user's shell PATH. Keep
 * detection shell-free but cover conventional package-manager/user bins. */
function commonRuntimeCandidates(id: 'node' | 'deno' | 'bun'): string[] {
  const roots = osPlatform() === 'darwin'
    ? ['/usr/local/bin', '/opt/homebrew/bin', join(homedir(), '.local', 'bin')]
    : osPlatform() === 'linux'
      ? ['/usr/local/bin', '/usr/bin', '/snap/bin', join(homedir(), '.local', 'bin')]
      : [];
  const userRoots = id === 'deno'
    ? [join(homedir(), '.deno', 'bin')]
    : id === 'bun'
      ? [join(homedir(), '.bun', 'bin')]
      : [];
  return [...roots, ...userRoots].map((root) => join(root, executableName(id)));
}

function browserCandidates(id: 'chrome' | 'firefox'): string[] {
  if (isWindows()) {
    const roots = [process.env['PROGRAMFILES'], process.env['PROGRAMFILES(X86)'], process.env['LOCALAPPDATA']].filter(Boolean) as string[];
    return id === 'chrome'
      ? ['chrome', ...roots.flatMap((root) => [join(root, 'Google', 'Chrome', 'Application', 'chrome.exe')])]
      : ['firefox', ...roots.flatMap((root) => [join(root, 'Mozilla Firefox', 'firefox.exe')])];
  }
  if (osPlatform() === 'darwin') {
    return id === 'chrome'
      ? ['google-chrome', join('/Applications', 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome'), join(homedir(), 'Applications', 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome')]
      : ['firefox', join('/Applications', 'Firefox.app', 'Contents', 'MacOS', 'firefox'), join(homedir(), 'Applications', 'Firefox.app', 'Contents', 'MacOS', 'firefox')];
  }
  return id === 'chrome'
    ? ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']
    : ['firefox'];
}

export function detectSystemBrowser(id: 'chrome' | 'firefox'): Promise<DetectedRuntime | null> {
  return detectExecutable(id, browserCandidates(id));
}

/** Native nvm-windows and nvm (POSIX) roots. */
export function nvmRoot(): string {
  if (isWindows()) return process.env['NVM_HOME'] || join(process.env['APPDATA'] || join(homedir(), 'AppData', 'Roaming'), 'nvm');
  const configured = process.env['NVM_DIR'];
  if (configured) return /[\\/]versions[\\/]node$/.test(configured) ? configured : join(configured, 'versions', 'node');
  return join(homedir(), '.nvm', 'versions', 'node');
}

export function nvmSymlink(): string {
  if (isWindows()) return process.env['NVM_SYMLINK'] ?? join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'nodejs');
  return process.env['NVM_BIN'] || dirnameSafe(process.execPath);
}

function dirnameSafe(path: string): string {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return index > 0 ? path.slice(0, index) : path;
}

export function parseNvmVersions(root: string, names: string[], activeTarget: string | null): NvmVersionInfo[] {
  const rows = names
    .filter((name) => /^v\d+\.\d+\.\d+$/.test(name))
    .map((name) => {
      const version = name.slice(1);
      const exePath = isWindows() ? join(root, name, executableName('node')) : join(root, name, 'bin', executableName('node'));
      const normalizedTarget = activeTarget ? activeTarget.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase() : null;
      const normalizedVersion = join(root, name).replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
      const normalizedExeDir = dirnameSafe(exePath).replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
      const active = normalizedTarget !== null && (normalizedTarget === normalizedVersion || normalizedTarget === normalizedExeDir);
      return { version, exePath, active };
    });
  return rows.sort((a, b) => b.version.localeCompare(a.version, undefined, { numeric: true }));
}

export async function detectNvmNode(): Promise<NvmInfo | null> {
  const root = nvmRoot();
  let names: string[];
  try { names = await readdir(root); } catch { return null; }
  let activeTarget: string | null = null;
  try { activeTarget = await realpath(nvmSymlink()); } catch { /* no active link */ }
  const versions = parseNvmVersions(root, names, activeTarget);
  const existing: NvmVersionInfo[] = [];
  for (const row of versions) {
    try { await access(row.exePath); existing.push(row); } catch { /* stale directory */ }
  }
  return existing.length > 0 ? { root, versions: existing } : null;
}
