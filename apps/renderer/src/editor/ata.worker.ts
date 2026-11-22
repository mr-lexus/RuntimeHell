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

let fileCount = 0;
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
      fileCount = files.size;
    }
  }
});

// ATA shares a module cache and counters between calls. While it fetches
// declarations, retain only the most recent editor snapshot.
let nextCode: string | undefined;
let acquiring = false;
self.onmessage = async (event: MessageEvent<{ code: string }>): Promise<void> => {
  nextCode = event.data.code;
  if (acquiring) return;
  acquiring = true;
  try {
    while (nextCode !== undefined) {
      const code = nextCode;
      nextCode = undefined;
      try {
        await acquire(code);
      } catch (error) {
        self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
      }
    }
    self.postMessage({ type: 'done', count: fileCount });
  } finally {
    acquiring = false;
  }
};
