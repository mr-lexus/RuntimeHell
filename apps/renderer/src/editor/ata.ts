/**
 * Automatic Type Acquisition (plan todo 14, evidence fact 6).
 * The heavy lifting (@typescript/ata + the real TypeScript compiler) runs in
 * a dedicated worker (ata.worker.ts) so the main renderer chunk stays lean;
 * this module owns debounce + status + message routing.
 */
export type AtaStatus = 'idle' | 'loading' | 'ready' | 'offline';

type StatusListener = (status: AtaStatus) => void;
const statusListeners = new Set<StatusListener>();
let currentStatus: AtaStatus = 'idle';

function setStatus(next: AtaStatus): void {
  if (currentStatus === next) return;
  currentStatus = next;
  for (const cb of statusListeners) cb(currentStatus);
}

export function onAtaStatus(cb: StatusListener): () => void {
  statusListeners.add(cb);
  return () => {
    statusListeners.delete(cb);
  };
}

export function getAtaStatus(): AtaStatus {
  return currentStatus;
}

export interface AtaController {
  /** Debounced acquisition for the given source code. */
  schedule: (code: string, immediate?: boolean) => void;
  reset: () => void;
}

export interface AtaWorkerChannel {
  postMessage: (data: { code: string }) => void;
  setOnMessage: (
    cb: (msg: { type: 'file' | 'error' | 'done'; code?: string; path?: string; message?: string; count?: number }) => void
  ) => void;
}

export interface AtaDeps {
  spawnWorker: () => AtaWorkerChannel;
  addExtraLib: (code: string, path: string) => void;
}

export function createAtaController(deps: AtaDeps): AtaController {
  let hadError = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const worker = deps.spawnWorker();

  worker.setOnMessage((msg) => {
    switch (msg.type) {
      case 'file':
        if (msg.code !== undefined && msg.path !== undefined) {
          deps.addExtraLib(msg.code, `file:///node_modules/${msg.path}`);
          setStatus('ready');
        }
        break;
      case 'error':
        // "An error does not mean ATA has stopped" — decide at done().
        hadError = true;
        console.warn('[ata]', msg.message ?? '');
        break;
      case 'done':
        setStatus((msg.count ?? 0) > 0 ? 'ready' : hadError ? 'offline' : 'idle');
        break;
    }
  });

  return {
    schedule(code, immediate = false): void {
      if (timer !== null) clearTimeout(timer);
      const run = (): void => {
        timer = null;
        hadError = false;
        setStatus('loading');
        worker.postMessage({ code });
      };
      if (immediate) run();
      else timer = setTimeout(run, 500);
    },
    reset(): void {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      setStatus('idle');
    }
  };
}
