/**
 * Embedded browser runtime.
 *
 * A BrowserWindow is used instead of a Node child process so the selected
 * lane really runs in Chromium's V8 realm. Node integration stays disabled;
 * the page therefore exposes window/document/fetch/timers/etc. but not
 * process/require. The runner uses console-message as a small, main-process
 * transport for RuntimeHell result and console frames.
 */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { RunEvent, RunResult, SerializedValue } from '@rh/protocol';
import type { RunHandle, RunOptions } from '../../execution/process-runner.js';

const MARKER = '__RH_BROWSER__';
const PAGE_HTML = '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>';

type BrowserConsoleLevel = 'log' | 'error' | 'warn' | 'info' | 'debug' | 'table' | 'dir' | 'trace';

type BrowserPayload =
  | { kind: 'result'; index: number; phase: 'immediate' | 'fulfilled' | 'rejected'; value: SerializedValue; line?: number }
  | { kind: 'console'; line: number; level: BrowserConsoleLevel; text: string; args: SerializedValue[] }
  | { kind: 'error'; message: string }
  | { kind: 'complete' };

interface BrowserSession {
  readonly runId: string;
  readonly reports: Map<number, SerializedValue>;
  window: import('electron').BrowserWindow | null;
  settled: boolean;
  failed: boolean;
  cancelled: 'user' | 'timeout' | null;
  startedAt: number;
  timeout: NodeJS.Timeout;
  resolveResult: (result: RunResult) => void;
}

/** A ProcessRunner-shaped surface so ExecutionManager can keep event routing identical. */
export interface BrowserRuntimeRunner {
  onEvent(cb: (event: RunEvent) => void): () => void;
  run(options: RunOptions): RunHandle;
}

/**
 * Build the script evaluated in the browser page. Kept pure so the execution
 * contract can be tested without starting Electron.
 */
export function buildBrowserScript(source: string): string {
  const encodedSource = JSON.stringify(source);
  return `
(() => {
  'use strict';
  const MARKER = ${JSON.stringify(MARKER)};
  const nativeConsole = globalThis.console;
  const transportLog = nativeConsole.log.bind(nativeConsole);
  const nativeSetTimeout = globalThis.setTimeout.bind(globalThis);
  const nativeClearTimeout = globalThis.clearTimeout.bind(globalThis);
  const nativeSetInterval = globalThis.setInterval.bind(globalThis);
  const nativeClearInterval = globalThis.clearInterval.bind(globalThis);
  const nativeRequestAnimationFrame = typeof globalThis.requestAnimationFrame === 'function' ? globalThis.requestAnimationFrame.bind(globalThis) : null;
  const nativeCancelAnimationFrame = typeof globalThis.cancelAnimationFrame === 'function' ? globalThis.cancelAnimationFrame.bind(globalThis) : null;
  const nativeFetch = typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null;
  let pending = 0;
  const pendingHandles = new Map();

  function emit(payload) {
    try { transportLog(MARKER + JSON.stringify(payload)); } catch (_) {}
  }
  function textOf(value) {
    try {
      if (typeof value === 'string') return value;
      if (value === undefined) return 'undefined';
      if (value === null) return 'null';
      if (typeof value === 'object') return JSON.stringify(value);
      return String(value);
    } catch (_) { return String(value); }
  }
  function serialize(value, depth, ancestors, state) {
    if (state.nodes++ >= 5000) return { t: 'object', prim: '<node cap reached>', truncated: true };
    const type = typeof value;
    if (value === null) return { t: 'null' };
    if (type === 'undefined') return { t: 'undefined' };
    if (type === 'boolean' || type === 'number' || type === 'bigint' || type === 'symbol') return { t: type === 'bigint' ? 'bigint' : type, prim: String(value) };
    if (type === 'string') return value.length > 10000 ? { t: 'string', prim: value.slice(0, 10000), size: value.length, truncated: true } : { t: 'string', prim: value };
    if (type === 'function') return { t: /^class[\\s{]/.test(Function.prototype.toString.call(value)) ? 'class' : 'function', label: value.name || '(anonymous)', size: value.length };
    if (depth >= 20) return { t: 'object', prim: '<depth cap reached>', truncated: true };
    const backEdge = ancestors.indexOf(value);
    if (backEdge !== -1) return { t: 'object', prim: '[Circular]', refId: backEdge };
    if (value instanceof Error) return { t: 'error', label: value.name || 'Error', children: [{ k: 'message', node: { t: 'string', prim: String(value.message) } }, { k: 'stack', node: { t: 'string', prim: String(value.stack || '') } }] };
    if (value instanceof Date) return { t: 'date', prim: value.toISOString() };
    if (value instanceof RegExp) return { t: 'regexp', prim: value.source, label: value.flags };
    if (typeof Promise !== 'undefined' && value instanceof Promise) return { t: 'promise', label: 'promise (settlement reported separately)' };
    if (ArrayBuffer.isView(value)) return { t: 'typedarray', label: value.constructor?.name || 'TypedArray', size: value.length ?? value.byteLength ?? 0 };
    if (Array.isArray(value)) {
      const node = { t: 'array', size: value.length, children: [] };
      ancestors.push(value);
      for (let i = 0; i < value.length && state.nodes < 5000; i++) node.children.push({ k: String(i), node: serialize(value[i], depth + 1, ancestors, state) });
      ancestors.pop();
      if (node.children.length < value.length) node.truncated = true;
      return node;
    }
    const node = { t: 'object', label: value.constructor?.name && value.constructor.name !== 'Object' ? value.constructor.name : undefined, children: [] };
    ancestors.push(value);
    let keys = [];
    try { keys = Object.keys(value); } catch (_) {}
    for (const key of keys) {
      if (state.nodes >= 5000) { node.truncated = true; break; }
      let child;
      try { child = value[key]; } catch (_) { child = '<threw>'; }
      node.children.push({ k: key, node: serialize(child, depth + 1, ancestors, state) });
    }
    ancestors.pop();
    return node;
  }
  const serializeRoot = (value) => serialize(value, 0, [], { nodes: 0 });
  const rh = {
    report(index, value, line) {
      try {
        emit({ kind: 'result', index, phase: 'immediate', value: serializeRoot(value), ...(typeof line === 'number' ? { line } : {}) });
        if (value && typeof value.then === 'function') {
          Promise.resolve(value).then(
            (resolved) => emit({ kind: 'result', index, phase: 'fulfilled', value: serializeRoot(resolved), ...(typeof line === 'number' ? { line } : {}) }),
            (error) => emit({ kind: 'result', index, phase: 'rejected', value: serializeRoot(error), ...(typeof line === 'number' ? { line } : {}) })
          );
        }
      } catch (error) { emit({ kind: 'error', message: String(error) }); }
      return value;
    },
    console(line, level, args) {
      emit({ kind: 'console', line, level, text: args.map(textOf).join(' '), args: args.map(serializeRoot) });
    }
  };
  globalThis.__rh = rh;

  function installGlobal(name, value) {
    try { Object.defineProperty(globalThis, name, { configurable: true, writable: true, value }); } catch (_) { try { globalThis[name] = value; } catch (_) {} }
  }
  installGlobal('setTimeout', (callback, delay, ...args) => {
    pending++;
    let id;
    const wrapped = () => { pendingHandles.delete(id); pending--; callback(...args); };
    id = nativeSetTimeout(wrapped, delay);
    pendingHandles.set(id, { type: 'timeout' });
    return id;
  });
  installGlobal('clearTimeout', (id) => { if (pendingHandles.delete(id)) pending--; nativeClearTimeout(id); });
  installGlobal('setInterval', (callback, delay, ...args) => {
    pending++;
    const id = nativeSetInterval(() => callback(...args), delay);
    pendingHandles.set(id, { type: 'interval' });
    return id;
  });
  installGlobal('clearInterval', (id) => { if (pendingHandles.delete(id)) pending--; nativeClearInterval(id); });
  if (nativeRequestAnimationFrame !== null) {
    installGlobal('requestAnimationFrame', (callback) => {
      pending++;
      let id;
      id = nativeRequestAnimationFrame((time) => { pendingHandles.delete(id); pending--; callback(time); });
      pendingHandles.set(id, { type: 'raf' });
      return id;
    });
    installGlobal('cancelAnimationFrame', (id) => { if (pendingHandles.delete(id)) pending--; nativeCancelAnimationFrame?.(id); });
  }
  if (nativeFetch !== null) installGlobal('fetch', (...args) => { pending++; return nativeFetch(...args).finally(() => { pending--; }); });

  for (const level of ['log', 'error', 'warn', 'info', 'debug', 'table', 'dir', 'trace']) {
    try { nativeConsole[level] = (...args) => rh.console(0, level, args); } catch (_) {}
  }
  globalThis.addEventListener('error', (event) => emit({ kind: 'error', message: event.error?.stack || event.message || 'browser error' }));
  globalThis.addEventListener('unhandledrejection', (event) => emit({ kind: 'error', message: String(event.reason?.stack || event.reason || 'unhandled rejection') }));

  const source = ${encodedSource};
  const waitForIdle = () => {
    if (pending === 0) emit({ kind: 'complete' });
    else nativeSetTimeout(waitForIdle, 5);
  };
  (async () => {
    try { await (new Function('return (async () => {\\n' + source + '\\n})();'))(); }
    catch (error) { emit({ kind: 'error', message: String(error?.stack || error) }); }
    finally { waitForIdle(); }
  })();
})();`;
}

export class EmbeddedBrowserRuntime implements BrowserRuntimeRunner {
  private readonly listeners = new Set<(event: RunEvent) => void>();
  private readonly sessions = new Map<string, BrowserSession>();

  onEvent(cb: (event: RunEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(event: RunEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  run(options: RunOptions): RunHandle {
    const runId = randomUUID();
    let resolveResult!: (result: RunResult) => void;
    const result = new Promise<RunResult>((resolve) => { resolveResult = resolve; });
    const session: BrowserSession = {
      runId,
      reports: new Map(),
      window: null,
      settled: false,
      failed: false,
      cancelled: null,
      startedAt: Date.now(),
      timeout: setTimeout(() => undefined, 2 ** 31 - 1),
      resolveResult
    };
    const handle: RunHandle = {
      runId,
      pid: null,
      result,
      cancel: async () => {
        if (session.settled) return;
        session.cancelled = 'user';
        session.window?.close();
        this.finish(session, 'cancelled', null);
      }
    };
    this.sessions.set(runId, session);
    void this.launch(session, options);
    return handle;
  }

  private async launch(session: BrowserSession, options: RunOptions): Promise<void> {
    try {
      const { BrowserWindow } = await import('electron');
      if (session.cancelled !== null) return;
      const win = new BrowserWindow({
        show: false,
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
      });
      session.window = win;
      win.webContents.on('will-navigate', (event) => event.preventDefault());
      win.webContents.on('console-message', (_event, _level, message) => this.handleConsoleMessage(session, message));
      win.on('closed', () => {
        if (!session.settled) this.finish(session, session.cancelled === 'timeout' ? 'timeout' : 'completed', null);
      });
      session.timeout = setTimeout(() => {
        if (session.settled) return;
        session.cancelled = 'timeout';
        win.close();
        this.finish(session, 'timeout', null);
      }, options.timeoutMs);
      await win.loadURL(`data:text/html,${encodeURIComponent(PAGE_HTML)}`);
      if (session.settled) return;
      const entryPath = options.args?.[options.args.length - 1];
      if (!entryPath) throw new Error('browser runtime entry path missing');
      const source = await readFile(entryPath, 'utf8');
      await win.webContents.executeJavaScript(buildBrowserScript(source), true);
    } catch (error) {
      if (!session.settled) {
        session.failed = true;
        this.emit({ type: 'error', runId: session.runId, message: error instanceof Error ? error.message : String(error) });
        this.finish(session, 'error', null);
      }
    }
  }

  private handleConsoleMessage(session: BrowserSession, message: string): void {
    if (session.settled || !message.startsWith(MARKER)) return;
    let payload: BrowserPayload;
    try { payload = JSON.parse(message.slice(MARKER.length)) as BrowserPayload; } catch { return; }
    switch (payload.kind) {
      case 'result':
        session.reports.set(payload.index, payload.value);
        this.emit({ type: 'result', runId: session.runId, index: payload.index, value: payload.value, line: payload.line });
        break;
      case 'console':
        this.emit({ type: 'console', runId: session.runId, line: payload.line, column: 0, level: payload.level, text: payload.text, args: payload.args });
        break;
      case 'error':
        session.failed = true;
        this.emit({ type: 'error', runId: session.runId, message: payload.message });
        break;
      case 'complete':
        this.finish(session, session.failed ? 'crashed' : 'completed', session.failed ? 1 : 0);
        break;
    }
  }

  private finish(session: BrowserSession, status: RunResult['status'], code: number | null): void {
    if (session.settled) return;
    session.settled = true;
    clearTimeout(session.timeout);
    this.sessions.delete(session.runId);
    const durationMs = Date.now() - session.startedAt;
    this.emit({ type: 'exit', runId: session.runId, code, signal: null, durationMs, killedBy: session.cancelled });
    session.resolveResult({ runId: session.runId, status, exitCode: code, durationMs, reports: [...session.reports.entries()].sort((a, b) => a[0] - b[0]).map(([index, value]) => ({ index, value })) });
    if (session.window && !session.window.isDestroyed()) session.window.close();
  }
}
