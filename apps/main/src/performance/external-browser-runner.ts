import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { RunEvent, RunResult } from '@rh/protocol';
import { ProcessRunner, type RunHandle, type RunOptions } from '../execution/process-runner.js';
import type { BrowserRuntimeRunner } from '../runtimes/browser/browser-runtime.js';

const MAX_EVENT_BYTES = 2 * 1024 * 1024;

export type ExternalBrowserId = 'chrome' | 'firefox';

export function externalBrowserId(executable: string): ExternalBrowserId {
  // Detection results can come from a different host (for example, a
  // Windows-style imported path while tests run on POSIX). `path.basename`
  // only understands the current host's separator, so split both forms.
  const fileName = executable.split(/[\\/]/).pop() ?? executable;
  return fileName.toLowerCase().startsWith('firefox') ? 'firefox' : 'chrome';
}

export function browserLaunchArgs(id: ExternalBrowserId, url: string, profileDir: string): string[] {
  if (id === 'firefox') return ['--headless', '--no-remote', '--new-instance', '--profile', profileDir, url];
  return [
    '--headless=new', '--disable-gpu', '--disable-extensions', '--disable-background-networking',
    '--no-first-run', '--disable-default-apps', `--user-data-dir=${profileDir}`, url
  ];
}

function response(res: ServerResponse, status: number, type: string, body: string): void {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(body);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_EVENT_BYTES) {
        reject(new Error('browser benchmark event exceeded the size limit'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function pageHtml(token: string): string {
  const eventPath = JSON.stringify(`/event/${token}`);
  const donePath = JSON.stringify(`/done/${token}`);
  const errorPath = JSON.stringify(`/error/${token}`);
  return `<!doctype html><html><head><meta charset="utf-8"><title>RuntimeHell benchmark</title></head><body>
<script>
(() => {
  let queue = Promise.resolve();
  let bootError = null;
  const post = (path, body) => fetch(path, { method: 'POST', headers: { 'content-type': 'text/plain;charset=UTF-8' }, body });
  globalThis.__rhPerformanceEmit = (value) => {
    const line = '__RH_PERF__' + JSON.stringify(value);
    queue = queue.then(() => post(${eventPath}, line)).then((reply) => { if (!reply.ok) throw new Error('benchmark transport failed: ' + reply.status); });
  };
  globalThis.__rhPerformanceFlush = () => queue;
  addEventListener('error', (event) => { bootError = event.error || new Error(event.message || 'browser script failed'); });
  addEventListener('load', async () => {
    try {
      if (bootError) throw bootError;
      await globalThis.__rhPerformanceDone;
      await queue;
      await post(${donePath}, 'done');
    } catch (error) {
      await post(${errorPath}, String(error && (error.stack || error.message) || error));
    }
  });
})();
</script>
<script src="/harness/${token}"></script>
</body></html>`;
}

interface Session {
  readonly runId: string;
  readonly startedAt: number;
  readonly resolve: (result: RunResult) => void;
  server: Server | null;
  child: RunHandle | null;
  unsubscribe: (() => void) | null;
  settled: boolean;
  completing: boolean;
  cancelled: boolean;
}

/** Runs a benchmark page in an installed desktop browser without a driver. */
export class ExternalBrowserRuntime implements BrowserRuntimeRunner {
  private readonly listeners = new Set<(event: RunEvent) => void>();
  private readonly runner: ProcessRunner;

  constructor(createRunner: () => ProcessRunner = () => new ProcessRunner()) {
    this.runner = createRunner();
  }

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
    const session: Session = {
      runId, startedAt: Date.now(), resolve: resolveResult, server: null,
      child: null, unsubscribe: null, settled: false, completing: false, cancelled: false
    };
    const handle: RunHandle = {
      runId,
      pid: null,
      result,
      cancel: async () => {
        if (session.settled) return;
        session.cancelled = true;
        try {
          await session.child?.cancel();
          await session.child?.result;
        }
        finally { this.finish(session, 'cancelled', null, 'user'); }
      }
    };
    void this.launch(session, handle, options);
    return handle;
  }

  private async launch(session: Session, publicHandle: RunHandle, options: RunOptions): Promise<void> {
    try {
      const harnessPath = options.args?.at(-1);
      if (!harnessPath) throw new Error('external browser benchmark entry path missing');
      const source = await fs.readFile(harnessPath, 'utf8');
      const profileDir = join(options.cwd, 'browser-profile');
      await fs.mkdir(profileDir, { recursive: true });
      if (session.cancelled) return;
      const token = randomUUID();
      const server = createServer((req, res) => { void this.route(session, token, source, req, res); });
      session.server = server;
      const port = await new Promise<number>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
          server.off('error', reject);
          const address = server.address();
          if (address === null || typeof address === 'string') reject(new Error('browser benchmark server did not bind a TCP port'));
          else resolve(address.port);
        });
      });
      if (session.cancelled) { server.close(); return; }
      let childRunId = '';
      session.unsubscribe = this.runner.onEvent((event) => {
        if (event.runId !== childRunId || session.settled) return;
        if (event.type === 'stdout' || event.type === 'stderr') this.emit({ ...event, runId: session.runId });
      });
      const child = this.runner.run({
        exePath: options.exePath,
        args: browserLaunchArgs(externalBrowserId(options.exePath), `http://127.0.0.1:${port}/run/${token}`, profileDir),
        cwd: options.cwd,
        timeoutMs: options.timeoutMs,
        extraEnv: options.extraEnv
      });
      childRunId = child.runId;
      session.child = child;
      publicHandle.pid = child.pid;
      const ended = await child.result;
      if (!session.settled && !session.completing) {
        const status = ended.status === 'timeout' ? 'timeout' : session.cancelled ? 'cancelled' : 'error';
        this.finish(session, status, ended.exitCode, ended.status === 'timeout' ? 'timeout' : ended.status === 'cancelled' ? 'user' : null);
      }
    } catch (error) {
      if (!session.settled) {
        this.emit({ type: 'stderr', runId: session.runId, data: error instanceof Error ? error.message : String(error) });
        this.finish(session, session.cancelled ? 'cancelled' : 'error', 1, session.cancelled ? 'user' : null);
      }
    }
  }

  private async route(session: Session, token: string, source: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? '';
    try {
      if (req.method === 'GET' && url === `/run/${token}`) return response(res, 200, 'text/html;charset=UTF-8', pageHtml(token));
      if (req.method === 'GET' && url === `/harness/${token}`) return response(res, 200, 'text/javascript;charset=UTF-8', source);
      if (req.method === 'POST' && url === `/event/${token}`) {
        const body = await readBody(req);
        this.emit({ type: 'stdout', runId: session.runId, data: `${body}\n` });
        return response(res, 204, 'text/plain', '');
      }
      if (req.method === 'POST' && url === `/done/${token}`) {
        await readBody(req);
        response(res, 204, 'text/plain', '');
        session.completing = true;
        try {
          await session.child?.cancel();
          await session.child?.result;
        }
        finally { this.finish(session, 'completed', 0, null); }
        return;
      }
      if (req.method === 'POST' && url === `/error/${token}`) {
        const body = await readBody(req);
        response(res, 204, 'text/plain', '');
        this.emit({ type: 'stderr', runId: session.runId, data: body });
        session.completing = true;
        try {
          await session.child?.cancel();
          await session.child?.result;
        }
        finally { this.finish(session, 'error', 1, null); }
        return;
      }
      response(res, 404, 'text/plain', 'not found');
    } catch (error) {
      if (!res.headersSent) response(res, 500, 'text/plain', 'transport error');
      this.emit({ type: 'stderr', runId: session.runId, data: error instanceof Error ? error.message : String(error) });
    }
  }

  private finish(session: Session, status: RunResult['status'], code: number | null, killedBy: 'timeout' | 'user' | null): void {
    if (session.settled) return;
    session.settled = true;
    session.unsubscribe?.();
    session.server?.close();
    const durationMs = Date.now() - session.startedAt;
    this.emit({ type: 'exit', runId: session.runId, code, signal: null, durationMs, killedBy });
    session.resolve({ runId: session.runId, status, exitCode: code, durationMs, reports: [] });
  }
}
