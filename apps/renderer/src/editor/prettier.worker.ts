/// <reference lib="webworker" />
import * as prettier from 'prettier/standalone';
import babelPlugin from 'prettier/plugins/babel';
import estreePlugin from 'prettier/plugins/estree';
import typescriptPlugin from 'prettier/plugins/typescript';
import type { WorkerRequest, WorkerResponse } from './prettier-protocol';

const PARSERS: Record<WorkerRequest['parser'], string> = {
  babel: 'babel',
  typescript: 'typescript',
  tsx: 'typescript'
};

self.onmessage = async (event: MessageEvent<WorkerRequest>): Promise<void> => {
  const { id, code, parser } = event.data;
  try {
    const formatted = await prettier.format(code, {
      parser: PARSERS[parser],
      plugins: [babelPlugin, estreePlugin, typescriptPlugin],
      semi: true,
      singleQuote: false,
      printWidth: 100,
      tabWidth: 2
    });
    const res: WorkerResponse = { id, ok: true, code: formatted };
    (self as unknown as Worker).postMessage(res);
  } catch (err) {
    const res: WorkerResponse = { id, ok: false, error: err instanceof Error ? err.message : String(err) };
    (self as unknown as Worker).postMessage(res);
  }
};
