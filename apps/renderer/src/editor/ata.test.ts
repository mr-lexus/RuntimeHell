/**
 * ATA controller unit tests (plan todo 14): debounce coalescing, extraLib
 * path policy, status transitions incl. offline — with a FAKE worker channel
 * so no network/TS compiler is involved.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAtaController, getAtaStatus, onAtaStatus, type AtaWorkerChannel } from './ata';

type EmitMsg = { type: 'file' | 'error' | 'done'; code?: string; path?: string; message?: string; count?: number };

function makeFakeWorker(): {
  channel: AtaWorkerChannel & { emit: (msg: EmitMsg) => void };
  posted: { code: string }[];
} {
  const posted: { code: string }[] = [];
  let listener: (msg: EmitMsg) => void = () => {};
  const channel = {
    posted,
    postMessage: (data: { code: string }) => posted.push(data),
    setOnMessage: (cb: (msg: EmitMsg) => void) => {
      listener = cb;
    },
    emit: (msg: EmitMsg) => listener(msg)
  };
  return { channel, posted };
}

describe('createAtaController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces rapid edits into one worker post', async () => {
    const { channel, posted } = makeFakeWorker();
    const extras: string[] = [];
    const controller = createAtaController({
      spawnWorker: () => channel,
      addExtraLib: (code, path) => extras.push(`${path}=${code}`)
    });

    controller.schedule('import _ from "lodash";');
    controller.schedule('import _ from "lodash"; // v2');
    controller.schedule('import _ from "lodash"; // v3');
    expect(posted.length).toBe(0); // timer pending
    await vi.advanceTimersByTimeAsync(600);

    expect(posted.length).toBe(1);
    // Worker 'file' messages route into addExtraLib with node_modules prefix.
    channel.emit({ type: 'file', code: 'declare const _: any;', path: 'lodash/index.d.ts' });
    expect(extras[0]).toContain('file:///node_modules/lodash/index.d.ts');
  });

  it('marks ready when types arrive and offline when errors end with no files', async () => {
    const seen: string[] = [];
    const off = onAtaStatus((s) => seen.push(s));
    const { channel, posted } = makeFakeWorker();
    createAtaController({ spawnWorker: () => channel, addExtraLib: () => {} });

    channel.emit({ type: 'file', code: 'd', path: 'zod/index.d.ts' });
    expect(getAtaStatus()).toBe('ready');

    channel.emit({ type: 'error', message: 'fetch failed' });
    channel.emit({ type: 'done', count: 0 });
    expect(getAtaStatus()).toBe('offline');

    off();
  });

  it('immediate=true bypasses the debounce timer', async () => {
    const { channel, posted } = makeFakeWorker();
    const controller = createAtaController({ spawnWorker: () => channel, addExtraLib: () => {} });
    controller.schedule('import _ from "lodash";', true);
    expect(posted.length).toBe(1);
  });
});
