/**
 * Automatic Type Acquisition (plan todo 14, evidence fact 6):
 * @typescript/ata fetches .d.ts for imports found in the active file and adds
 * them into Monaco's TypeScript service via addExtraLib. Acquisition is
 * debounced, re-runs when package.json changes, and degrades to an "offline"
 * status chip without ever breaking editing.
 */
import { setupTypeAcquisition } from '@typescript/ata';
import * as ts from 'typescript';

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

type DelegateShape = NonNullable<Parameters<typeof setupTypeAcquisition>[0]['delegate']>;

/** Structural factory contract — keeps tests free of ATA/TS compiler details. */
export type AcquireFactory = (config: {
  projectName: string;
  delegate: DelegateShape;
  typescript?: unknown;
}) => (code: string) => Promise<void>;

const defaultFactory: AcquireFactory = (config) =>
  setupTypeAcquisition(config as Parameters<typeof setupTypeAcquisition>[0]);

/**
 * Injectable factory keeps debounce/status logic unit-testable without
 * network or the real TypeScript compiler.
 */
export function createAtaController(
  /**
   * Sink for acquired .d.ts files. Callers wire it to their TS service, e.g.
   * `typescriptDefaults.addExtraLib(code, 'file:///node_modules/' + path)`.
   */
  addExtraLib: (code: string, path: string) => void,
  acquireFactory: AcquireFactory | null = null
): AtaController {
  const factory = acquireFactory ?? defaultFactory;

  let hadError = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const acquire = factory({
    projectName: 'runtimehell',
    typescript: ts,
    delegate: {
      started: () => setStatus('loading'),
      receivedFile: (code, path) => {
        addExtraLib(code, `file:///node_modules/${path}`);
        setStatus('ready');
      },
      errorMessage: (message) => {
        // "An error message does not mean ATA has stopped" — record it and
        // decide after finished().
        hadError = true;
        console.warn('[ata]', message);
      },
      finished: (files) => {
        if ((files?.size ?? 0) > 0) {
          setStatus('ready');
          return;
        }
        setStatus(hadError ? 'offline' : 'idle');
      }
    }
  });

  return {
    schedule(code, immediate = false): void {
      if (timer !== null) clearTimeout(timer);
      const run = (): void => {
        timer = null;
        hadError = false;
        try {
          void Promise.resolve(acquire(code)).catch(() => setStatus('offline'));
        } catch {
          setStatus('offline');
        }
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
