/**
 * One-time fd-3 passthrough probe (plan todo 10).
 *
 * Spawns `<exe> --require templates/probe-fd3.cjs` with stdio[3] piped and
 * checks whether the marker line arrives. The result is cached per executable
 * path so every later run reuses the decision — fd3 is never load-bearing:
 * children ALSO emit on stderr unconditionally and the runner deduplicates
 * by frame nonce.
 */
import { spawn } from 'node:child_process';
import { mainAssetPath } from '../asset-paths.js';

// apps/main builds to CommonJS, so __dirname is available (import.meta is not).
const PROBE_SCRIPT = mainAssetPath(__dirname, 'templates', 'probe-fd3.cjs');
const PROBE_MARKER = '__RH_PROBE__ok';
const PROBE_TIMEOUT_MS = 5000;

const cache = new Map<string, Promise<boolean>>();

export function probeFd3Support(exePath: string): Promise<boolean> {
  const cached = cache.get(exePath);
  if (cached !== undefined) return cached;

  const attempt = new Promise<boolean>((resolve) => {
    let settled = false;
    let timer: NodeJS.Timeout | null = null;
    const done = (supported: boolean): void => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      resolve(supported);
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(exePath, ['--require', PROBE_SCRIPT], {
        stdio: ['ignore', 'ignore', 'ignore', 'pipe'],
        windowsHide: true
      });
    } catch {
      done(false);
      return;
    }

    let markerReceived = false;
    const fd3 = child.stdio[3];
    if (!fd3) {
      child.kill();
      done(false);
      return;
    }
    fd3.on('data', (chunk: Buffer) => {
      if (chunk.toString('utf8').includes(PROBE_MARKER)) markerReceived = true;
    });
    child.on('error', () => done(false));
    child.on('close', () => done(markerReceived));

    timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* already gone */
      }
      done(false);
    }, PROBE_TIMEOUT_MS);
    timer.unref();
  });

  cache.set(exePath, attempt);
  return attempt;
}

/** Test seam: reset the per-exe cache. */
export function resetFd3ProbeCache(): void {
  cache.clear();
}
