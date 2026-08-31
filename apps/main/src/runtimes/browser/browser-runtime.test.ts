import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { buildBrowserScript } from './browser-runtime.js';

describe('embedded browser runtime page shim', () => {
  it('captures browser globals, results, console calls, and timers', async () => {
    const messages: string[] = [];
    const pageConsole = {
      log: (...args: unknown[]) => messages.push(args.map(String).join(' ')),
      error: (...args: unknown[]) => messages.push(args.map(String).join(' ')),
      warn: (...args: unknown[]) => messages.push(args.map(String).join(' ')),
      info: (...args: unknown[]) => messages.push(args.map(String).join(' ')),
      debug: (...args: unknown[]) => messages.push(args.map(String).join(' ')),
      table: (...args: unknown[]) => messages.push(args.map(String).join(' ')),
      dir: (...args: unknown[]) => messages.push(args.map(String).join(' ')),
      trace: (...args: unknown[]) => messages.push(args.map(String).join(' '))
    };
    const context: Record<string, unknown> = {
      console: pageConsole,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      addEventListener: () => undefined,
      document: { createElement: () => ({ textContent: 'created in DOM' }) }
    };
    context.window = context;

    runInNewContext(buildBrowserScript(`
      const el = document.createElement('div');
      __rh.report(0, { hasWindow: typeof window === 'object', text: el.textContent });
      console.log('timer scheduled');
      setTimeout(() => console.log('timer fired'), 5);
    `), context);
    await new Promise((resolve) => setTimeout(resolve, 30));

    const payloads = messages
      .filter((message) => message.startsWith('__RH_BROWSER__'))
      .map((message) => JSON.parse(message.slice('__RH_BROWSER__'.length)) as { kind: string; value?: { t: string }; text?: string });
    expect(payloads.some((payload) => payload.kind === 'result' && payload.value?.t === 'object')).toBe(true);
    expect(payloads.some((payload) => payload.kind === 'console' && payload.text === 'timer scheduled')).toBe(true);
    expect(payloads.some((payload) => payload.kind === 'console' && payload.text === 'timer fired')).toBe(true);
    expect(payloads.some((payload) => payload.kind === 'complete')).toBe(true);
  });
});
