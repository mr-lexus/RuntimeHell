/**
 * Stack-line remapper (plan todo 11): node-style `at fn (FILE:L:C)` frames
 * pointing at the generated .cjs are rewritten to authored positions using
 * the esbuild sourcemap. Lines are emitted strictly in arrival order even
 * though mapping is async (sequential promise chain).
 */
import { join } from 'node:path';
import { mapFrame } from '../transpile/transpile-service.js';

const FRAME_RE = /\(([^()\s]+\.cjs):(\d+):(\d+)\)/;

function sameFile(a: string, b: string): boolean {
  const norm = (p: string): string => p.replace(/\\/g, '/').replace(/^file:\/\/\//, '').toLowerCase();
  return norm(a) === norm(b);
}

export class StackLineRemapper {
  private pending = '';
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly mapPath: string | null,
    private readonly generatedFile: string,
    private readonly emitLine: (line: string, terminated: boolean) => void
  ) {}

  push(chunk: string): void {
    this.pending += chunk;
    let nl = this.pending.indexOf('\n');
    while (nl !== -1) {
      const line = this.pending.slice(0, nl);
      this.pending = this.pending.slice(nl + 1);
      this.enqueue(line, true);
      nl = this.pending.indexOf('\n');
    }
  }

  flush(): void {
    if (this.pending === '') return;
    const line = this.pending;
    this.pending = '';
    this.enqueue(line, false);
  }

  /** Sequential dispatch keeps output order stable under async mapping. */
  private enqueue(line: string, terminated: boolean): void {
    this.chain = this.chain.then(() => this.route(line, terminated));
  }

  private async route(line: string, terminated: boolean): Promise<void> {
    const mapped = await this.tryMap(line);
    this.emitLine(mapped, terminated);
  }

  private async tryMap(line: string): Promise<string> {
    if (!this.mapPath || !line.includes('.cjs')) return line;
    const match = FRAME_RE.exec(line);
    if (!match) return line;
    const [, file, lineStr, colStr] = match;
    if (!file || !lineStr || !colStr || !sameFile(file, this.generatedFile)) return line;

    // Frame paths may be file URLs or plain paths; normalize for the lookup.
    let abs = file.replace(/^file:\/\/\//, '');
    if (!abs.includes(':\\') && !abs.startsWith('/')) abs = join(process.cwd(), abs);
    try {
      const pos = await mapFrame(this.mapPath, Number(lineStr), Number(colStr));
      if (pos.originalLine === null) return line;
      const origin = pos.originalSource ?? this.generatedFile;
      return line.replace(FRAME_RE, `(${origin}:${pos.originalLine}:${pos.originalColumn})`);
    } catch {
      return line;
    }
  }

  /** Awaitable for tests. */
  settle(): Promise<void> {
    return this.chain;
  }
}
