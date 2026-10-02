/**
 * Stack-line remapper (plan todo 11): node-style `at fn (FILE:L:C)` frames
 * pointing at the generated .cjs are rewritten to authored positions using
 * the esbuild sourcemap. Lines are emitted strictly in arrival order even
 * though mapping is async (sequential promise chain).
 */
import { mapFrame } from '../transpile/transpile-service.js';
import { sameFilesystemPath } from '../platform.js';
import { formatNodeStackFrame, parseNodeStackFrame } from './node-stack-frame.js';

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
    const frame = parseNodeStackFrame(line);
    if (!frame || !(await sameFilesystemPath(frame.file, this.generatedFile))) return line;
    try {
      const pos = await mapFrame(this.mapPath, frame.line, frame.column);
      if (pos.originalLine === null) return line;
      const origin = pos.originalSource ?? this.generatedFile;
      return formatNodeStackFrame(frame, origin, pos.originalLine, pos.originalColumn);
    } catch {
      return line;
    }
  }

  /** Awaitable for tests. */
  settle(): Promise<void> {
    return this.chain;
  }
}
