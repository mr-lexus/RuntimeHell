import { createHash } from 'node:crypto';
import { createWriteStream, promises as fs } from 'node:fs';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fromRandomAccessReaderPromise, RandomAccessReader, type ZipFile } from 'yauzl';

// WebKit publishes its shell in a full build alongside several GB of debug symbols.
const PAGE_BYTES = 512 * 1024;
const MAX_REMOTE_BYTES = 4 * 1024 ** 3;
const MAX_REQUESTS = 256;
const MAX_PAYLOAD_BYTES = 128 * 1024 ** 2;
const SHELL_FILE = /^(?:Release\/)?bin(?:64)?\/(jsc\.exe|JavaScriptCore\.dll|icu(?:dt|in|uc)\d+\.dll|(?:msvcp|vcruntime)\d+(?:_\d+)?\.dll)$/i;

export class WebKitArchiveUnavailable extends Error {}

class WebKitReader extends RandomAccessReader {
  private readonly pages = new Map<number, Promise<Buffer>>();
  private readonly lifetime = new AbortController();
  private requests = 0;
  private received = 0;

  constructor(private readonly url: string, private readonly size: number, private readonly etag: string, private readonly progress?: (received: number) => void) {
    super();
  }

  override _readStreamForRange(start: number, end: number): Readable {
    return Readable.from(this.readPages(start, end));
  }

  dispose(): void {
    this.lifetime.abort();
    this.pages.clear();
  }

  private async *readPages(start: number, end: number): AsyncGenerator<Buffer> {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end > this.size || end <= start) throw new Error('Invalid WebKit ZIP range');
    const first = Math.floor(start / PAGE_BYTES);
    const last = Math.floor((end - 1) / PAGE_BYTES);
    for (let index = first; index <= last; index += 4) {
      const pages = await Promise.all(Array.from({ length: Math.min(4, last - index + 1) }, (_, i) => this.getPage(index + i)));
      for (const [i, page] of pages.entries()) {
        const offset = (index + i) * PAGE_BYTES;
        yield page.subarray(Math.max(0, start - offset), Math.min(page.length, end - offset));
      }
    }
  }

  private getPage(index: number): Promise<Buffer> {
    const cached = this.pages.get(index);
    if (cached) return cached;
    if (++this.requests > MAX_REQUESTS) return Promise.reject(new Error('WebKit archive exceeds the transfer limit'));
    const page = this.fetchPage(index * PAGE_BYTES);
    this.pages.set(index, page);
    if (this.pages.size > 8) this.pages.delete(this.pages.keys().next().value!);
    return page;
  }

  private async fetchPage(start: number): Promise<Buffer> {
    const end = Math.min(start + PAGE_BYTES, this.size);
    const signal = AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(60_000)]);
    const response = await fetch(this.url, {
      headers: { Range: `bytes=${start}-${end - 1}`, 'If-Match': this.etag }, signal
    });
    if (response.status !== 206 || response.headers.get('etag') !== this.etag ||
        response.headers.get('content-range') !== `bytes ${start}-${end - 1}/${this.size}` || !response.body) {
      await response.body?.cancel();
      throw new Error(`WebKit archive changed or the server rejected the requested range (HTTP ${response.status})`);
    }
    const page = Buffer.allocUnsafe(end - start);
    let used = 0;
    for await (const chunk of response.body) {
      signal.throwIfAborted();
      if (used + chunk.length > page.length) throw new Error('Oversized WebKit archive range');
      page.set(chunk, used);
      used += chunk.length;
      this.received += chunk.length;
      this.progress?.(this.received);
    }
    if (used !== page.length) throw new Error('Incomplete WebKit archive range');
    return page;
  }
}

/** Return a deterministic SHA-256 pin of the filenames and contents actually installed. */
export async function extractWebKitShell(url: string, stage: string, progress?: (received: number) => void): Promise<string> {
  const head = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(30_000) });
  if (head.status === 403 || head.status === 404) throw new WebKitArchiveUnavailable(`WebKit archive unavailable: ${url}`);
  if (!head.ok) throw new Error(`WebKit archive lookup failed: ${head.status}`);
  const size = Number(head.headers.get('content-length'));
  const etag = head.headers.get('etag');
  if (!etag || !/^"[^"]+"$/.test(etag) || !Number.isSafeInteger(size) || size < 22 || size > MAX_REMOTE_BYTES) throw new Error('Invalid WebKit archive size or ETag');
  const reader = new WebKitReader(url, size, etag, progress);
  let archive: ZipFile | undefined;
  const pins: string[] = [];
  let extracted = 0;
  try {
    archive = await fromRandomAccessReaderPromise(reader, size, { strictFileNames: true, validateEntrySizes: true });
    if (archive.entryCount > 10_000) throw new Error('Too many entries in WebKit archive');
    await fs.mkdir(stage, { recursive: true });
    for await (const entry of archive.eachEntry()) {
      const name = SHELL_FILE.exec(entry.fileName)?.[1];
      if (!name) continue;
      const type = (entry.externalFileAttributes >>> 16) & 0o170000;
      if (type !== 0 && type !== 0o100000) throw new Error(`Unexpected WebKit archive entry type: ${name}`);
      extracted += entry.uncompressedSize;
      if (extracted > MAX_PAYLOAD_BYTES) throw new Error('WebKit shell exceeds the extraction limit');
      const hash = createHash('sha256');
      const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) { hash.update(chunk); callback(null, chunk); } });
      await pipeline(await archive.openReadStreamPromise(entry), meter, createWriteStream(join(stage, name), { flags: 'wx' }));
      pins.push(`${name.toLowerCase()}:\u0000${hash.digest('hex')}`);
    }
    for (const required of ['jsc.exe', 'JavaScriptCore.dll']) await fs.access(join(stage, required));
    return createHash('sha256').update(pins.sort().join('\n')).digest('hex');
  } finally {
    reader.dispose();
    archive?.close();
  }
}
