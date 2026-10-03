import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { buildBrowserScript } from './browser-runtime.js';

describe('embedded browser runtime page shim', () => {
  it('inspects hidden/symbol properties without invoking own, constructor or then getters', () => {
    const messages: string[] = [];
    const write = (...args: unknown[]): void => { messages.push(args.map(String).join(' ')); };
    runInNewContext(buildBrowserScript(`
      let reads = 0;
      const parent = { get inherited() { reads++; return 1; } };
      const value = Object.create(parent, {
        hidden: { value: 42 },
        constructor: { get() { reads++; throw Error('unsafe'); } },
        then: { get() { reads++; return null; } }
      });
      value[Symbol.for('token')] = 7;
      __rh.report(0, value, 1);
      __rh.report(1, reads, 2);
    `), { console: { log: write }, setTimeout, clearTimeout, setInterval, clearInterval, addEventListener: () => undefined });
    const frames = messages.filter((message) => message.startsWith('__RH_BROWSER__')).map((message) => JSON.parse(message.slice('__RH_BROWSER__'.length)) as { kind: string; index?: number; value?: import('@rh/protocol').SerializedValue });
    const value = frames.find((frame) => frame.index === 0)?.value;
    expect(value?.children).toContainEqual({ k: 'hidden', node: { t: 'number', prim: '42' } });
    expect(value?.children).toContainEqual({ k: 'Symbol(token)', node: { t: 'number', prim: '7' } });
    expect(value?.children).toContainEqual({ k: 'then', node: { t: 'string', prim: '[Getter]' } });
    expect(frames.find((frame) => frame.index === 1)?.value).toEqual({ t: 'number', prim: '0' });
    expect(frames.some((frame) => frame.kind === 'error')).toBe(false);
  });
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

  it('serializes prototype chains for results and console values', () => {
    const messages: string[] = [];
    const write = (...args: unknown[]): void => {
      messages.push(args.map(String).join(' '));
    };
    const context: Record<string, unknown> = {
      console: { log: write, error: write, warn: write, info: write, debug: write, table: write, dir: write, trace: write },
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      addEventListener: () => undefined
    };
    context.window = context;

    runInNewContext(buildBrowserScript(`
      class Base { baseMethod() {} }
      class Child extends Base { childMethod() {} }
      const value = new Child();
      __rh.report(0, value, 1);
      console.log('value', value);
    `), context);

    const payloads = messages
      .filter((message) => message.startsWith('__RH_BROWSER__'))
      .map((message) => JSON.parse(message.slice('__RH_BROWSER__'.length)) as {
        kind: string;
        value?: import('@rh/protocol').SerializedValue;
        args?: import('@rh/protocol').SerializedValue[];
      });
    const report = payloads.find((payload) => payload.kind === 'result')?.value;
    const consoleValue = payloads.find((payload) => payload.kind === 'console')?.args?.[1];

    for (const value of [report, consoleValue]) {
      const childProto = value?.children?.find((child) => child.k === '[[Prototype]]')?.node;
      const baseProto = childProto?.children?.find((child) => child.k === '[[Prototype]]')?.node;
      const objectProto = baseProto?.children?.find((child) => child.k === '[[Prototype]]')?.node;
      const nullProto = objectProto?.children?.find((child) => child.k === '[[Prototype]]')?.node;
      expect(childProto?.label).toBe('Child');
      expect(childProto?.children?.some((child) => child.k === 'childMethod')).toBe(true);
      expect(baseProto?.label).toBe('Base');
      expect(baseProto?.children?.some((child) => child.k === 'baseMethod')).toBe(true);
      expect(objectProto?.label).toBe('Object');
      expect(nullProto).toEqual({ t: 'null' });
    }
  });

  it('serializes prototypes for built-in browser value kinds', () => {
    const messages: string[] = [];
    const write = (...args: unknown[]): void => {
      messages.push(args.map(String).join(' '));
    };
    const context: Record<string, unknown> = {
      console: { log: write, error: write, warn: write, info: write, debug: write, table: write, dir: write, trace: write },
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      addEventListener: () => undefined
    };
    context.window = context;

    runInNewContext(buildBrowserScript(`
      const array = [new Map([['nested', { value: 1 }]])];
      array.extra = { value: 2 };
      const values = [array, new Map([['key', { nested: 1 }]]), new Set([{ nested: 2 }]), new Date('2026-01-02T03:04:05.000Z'), /rh/g, new Uint8Array([1, 2]), Promise.resolve(1), function sample() {}];
      values.forEach((value, index) => __rh.report(index, value, index + 1));
    `), context);

    const payloads = messages
      .filter((message) => message.startsWith('__RH_BROWSER__'))
      .map((message) => JSON.parse(message.slice('__RH_BROWSER__'.length)) as {
        kind: string;
        index?: number;
        value?: import('@rh/protocol').SerializedValue;
      });

    for (let index = 0; index < 8; index++) {
      const value = payloads.find((payload) => payload.kind === 'result' && payload.index === index)?.value;
      expect(value?.children?.some((child) => child.k === '[[Prototype]]'), `prototype for result ${index}`).toBe(true);
    }

    const array = payloads.find((payload) => payload.kind === 'result' && payload.index === 0)?.value;
    expect(array?.children?.some((child) => child.k === 'extra')).toBe(true);
    expect(array?.children?.some((child) => child.k === '[[Prototype]]')).toBe(true);

    const map = payloads.find((payload) => payload.kind === 'result' && payload.index === 1)?.value;
    expect(map?.t).toBe('map');
    expect(map?.children?.some((child) => child.k === '[0] key')).toBe(true);
    expect(map?.children?.some((child) => child.k === '[0] value')).toBe(true);

    const set = payloads.find((payload) => payload.kind === 'result' && payload.index === 2)?.value;
    expect(set?.t).toBe('set');
    expect(set?.children?.some((child) => child.k === '0')).toBe(true);

    const typedArray = payloads.find((payload) => payload.kind === 'result' && payload.index === 5)?.value;
    expect(typedArray?.t).toBe('typedarray');
    expect(typedArray?.children?.find((child) => child.k === '0')?.node.prim).toBe('1');
  });
});
