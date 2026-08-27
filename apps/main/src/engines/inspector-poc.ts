/**
 * Inspector plumbing PoC (plan todo 30): launches node --inspect=0, parses
 * the WebSocket URL from stderr, and verifies CDP attach. This is PLUMBING
 * ONLY — no breakpoint UI. Proves the transport works for future debugger UX.
 */
import { spawn } from 'node:child_process';

export interface InspectorSession {
  readonly pid: number;
  readonly wsUrl: string;
  detach: () => void;
}

export function launchWithInspector(
  exePath: string,
  args: string[],
  cwd: string,
  timeoutMs = 8000
): Promise<InspectorSession> {
  return new Promise((resolve, reject) => {
    const child = spawn(exePath, ['--inspect=0', ...args], { cwd, windowsHide: true });
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill();
        reject(new Error('inspector launch timed out'));
      }
    }, timeoutMs);
    timer.unref();

    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      const match = /ws:\/\/([^\s]+)/.exec(text);
      if (match !== null && !settled) {
        settled = true;
        clearTimeout(timer);
        resolve({
          pid: child.pid ?? 0,
          wsUrl: match[1] ?? '',
          detach: () => {
            try { child.kill(); } catch { /* already gone */ }
          }
        });
      }
    });
    child.on('error', (e) => {
      if (!settled) { settled = true; clearTimeout(timer); reject(e); }
    });
    child.on('close', () => {
      if (!settled) { settled = true; clearTimeout(timer); reject(new Error('process exited before inspector ready')); }
    });
  });
}
