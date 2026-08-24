/**
 * ATA web worker (plan todo 14/22): runs @typescript/ata + the real
 * TypeScript compiler OFF the main renderer chunk (the combined chunk with
 * Monaco otherwise exceeds Rolldown's WASM parse budget at build time).
 *
 * Protocol:
 *   in:  { code: string }
 *   out: { type:'file'; code:string; path:string }
 *        { type:'error'; message:string }
 *        { type:'done'; count:number }
 */
import { setupTypeAcquisition } from '@typescript/ata';
import * as ts from 'typescript';

const acquire = setupTypeAcquisition({
  projectName: 'runtimehell',
  typescript: ts,
  delegate: {
    receivedFile: (code, path) => {
      (self as unknown as Worker).postMessage({ type: 'file', code, path });
    },
    errorMessage: (message) => {
      (self as unknown as Worker).postMessage({ type: 'error', message });
    },
    finished: (files) => {
      (self as unknown as Worker).postMessage({ type: 'done', count: files.size });
    }
  }
});

self.onmessage = (event: MessageEvent<{ code: string }>): void => {
  void acquire(event.data.code)?.catch((err: unknown) => {
    (self as unknown as Worker).postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : String(err)
    });
  });
};
