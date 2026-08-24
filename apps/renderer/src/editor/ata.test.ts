/**
 * ATA controller unit tests (plan todo 14): debounce coalescing, extraLib
 * path policy, status-chip transitions incl. offline degradation — with an
 * injected acquire factory so no network or real TS compiler is involved.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAtaController, getAtaStatus, onAtaStatus } from './ata';

interface FakeDelegate {
  receivedFile?(code: string, path: string): void;
  progress?(downloaded: number, estimatedTotal: number): void;
  errorMessage?(message: string, error: Error): void;
  started?(): void;
  finished?(files: Map<string, string>): void;
}

function makeFakeAcquire() {
  const acquire = vi.fn(async (code: string): Promise<void> => {
    const d = lastConfig.delegate;
    if (code.includes('lodash')) {
      d.receivedFile?.('declare const _: any;', 'lodash/index.d.ts');
      d.finished?.(new Map([['lodash/index.d.ts', 'declare const _: any;']]));
    } else if (code.includes('offline-pkg')) {
      d.errorMessage?.('fetch failed', new Error('offline'));
      d.finished?.(new Map());
    } else {
      d.started?.();
      d.finished?.(new Map());
    }
  });
  let lastConfig!: { delegate: FakeDelegate };
  const factory = vi.fn((config: { delegate: FakeDelegate }) => {
    lastConfig = config;
    return acquire;
  });
  return { factory, acquire };
}

describe('createAtaController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces rapid edits into one acquisition', async () => {
    const { factory, acquire } = makeFakeAcquire();
    const extras: string[] = [];
    const controller = createAtaController((code, path) => extras.push(`${path}=${code}`), factory);

    expect(factory).toHaveBeenCalledTimes(1); // built at controller creation

    controller.schedule('import _ from "lodash";');
    controller.schedule('import _ from "lodash"; // v2');
    controller.schedule('import _ from "lodash"; // v3');
    expect(acquire).not.toHaveBeenCalled(); // timer pending
    await vi.advanceTimersByTimeAsync(600);

    expect(acquire).toHaveBeenCalledTimes(1);
    // receivedFile routes through addExtraLib with node_modules prefix.
    expect(extras[0]).toContain('file:///node_modules/lodash/index.d.ts');
  });

  it('marks ready when types arrive and offline when acquisition errors with no files', async () => {
    const { factory } = makeFakeAcquire();
    const controller = createAtaController(() => {}, factory);

    // NOTE: status is module-scoped by design (single editor instance), so
    // these assert on current state rather than per-test event history.
    controller.schedule('import _ from "lodash";', true);
    await Promise.resolve();
    await Promise.resolve();
    expect(getAtaStatus()).toBe('ready');

    controller.schedule('import x from "offline-pkg";', true);
    await Promise.resolve();
    await Promise.resolve();
    expect(getAtaStatus()).toBe('offline');
  });

  it('immediate=true bypasses the debounce timer', async () => {
    const { factory, acquire } = makeFakeAcquire();
    const controller = createAtaController(() => {}, factory);
    controller.schedule('import _ from "lodash";', true);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(acquire).toHaveBeenCalledTimes(1);
  });
});
