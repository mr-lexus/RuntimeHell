import * as monaco from 'monaco-editor';

export type VimMode = 'normal' | 'insert' | 'visual' | 'visual-line';

interface VimModeOptions {
  editor: monaco.editor.IStandaloneCodeEditor;
  onModeChange?: (mode: VimMode) => void;
}

type Position = monaco.Position;

/**
 * Small, dependency-free Vim layer for Monaco.
 *
 * The default editor remains normal Monaco. When enabled this controller
 * provides the modal editing primitives users expect from Vim/Neovim:
 * insert/normal/visual modes, motions, counts, operators, yanks, paste,
 * undo/redo, line operations, and the usual insert shortcuts. Keeping the
 * layer local means Monaco's model, language services, formatting, and IPC
 * contracts remain untouched.
 */
export class VimModeController {
  private readonly editor: monaco.editor.IStandaloneCodeEditor;
  private readonly domNode: HTMLElement | null;
  private readonly onModeChange?: (mode: VimMode) => void;
  private mode: VimMode = 'normal';
  private pending = '';
  private countBuffer = '';
  private anchor: Position | null = null;
  private yankBuffer = '';
  private disposed = false;

  private readonly onKeyDown = (event: KeyboardEvent): void => this.handleKeyDown(event);

  constructor({ editor, onModeChange }: VimModeOptions) {
    this.editor = editor;
    this.domNode = editor.getDomNode();
    this.onModeChange = onModeChange;
    this.domNode?.addEventListener('keydown', this.onKeyDown, true);
    this.applyModeVisuals();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.domNode?.removeEventListener('keydown', this.onKeyDown, true);
    try { this.editor.updateOptions({ cursorStyle: 'line', cursorBlinking: 'blink' }); } catch { /* editor may already be disposed */ }
  }

  private setMode(mode: VimMode): void {
    this.mode = mode;
    this.pending = '';
    this.countBuffer = '';
    if (mode === 'visual' || mode === 'visual-line') {
      const position = this.editor.getPosition();
      const anchor = position && mode === 'visual-line' ? new monaco.Position(position.lineNumber, 1) : position;
      this.anchor = anchor;
      if (position) {
        const end = mode === 'visual'
          ? this.clampPosition(position.lineNumber, position.column + 1)
          : new monaco.Position(position.lineNumber, this.lineEndColumn(position.lineNumber));
        this.editor.setSelection(new monaco.Selection(anchor?.lineNumber ?? position.lineNumber, anchor?.column ?? position.column, end.lineNumber, end.column));
      }
    } else {
      this.anchor = null;
    }
    this.applyModeVisuals();
    this.onModeChange?.(mode);
  }

  private applyModeVisuals(): void {
    this.editor.updateOptions({
      cursorStyle: this.mode === 'insert' ? 'line' : 'block',
      cursorBlinking: this.mode === 'insert' ? 'blink' : 'solid'
    });
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (this.disposed) return;
    if (this.mode === 'insert') {
      if (event.key === 'Escape' || (event.ctrlKey && event.key === '[')) {
        event.preventDefault();
        event.stopPropagation();
        const pos = this.editor.getPosition();
        this.setMode('normal');
        if (pos && pos.column > 1) this.editor.setPosition({ lineNumber: pos.lineNumber, column: pos.column - 1 });
      }
      return;
    }

    // Preserve browser/Monaco shortcuts such as Ctrl+S, Ctrl+Enter and the
    // command palette while Vim is in normal or visual mode.
    if (event.ctrlKey || event.metaKey || event.altKey) {
      if (event.ctrlKey && event.key.toLowerCase() === 'r') {
        event.preventDefault();
        event.stopPropagation();
        this.editor.trigger('vim', 'redo', null);
      }
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const key = event.key;
    if (key === 'Escape') {
      this.setMode('normal');
      return;
    }

    if (this.pending !== '') {
      this.handlePending(key);
      return;
    }

    if (/^[1-9]$/.test(key) || (this.countBuffer !== '' && key === '0')) {
      this.countBuffer += key;
      return;
    }
    const count = this.takeCount();

    if (key === 'i') return this.setMode('insert');
    if (key === 'a') { this.moveHorizontal(1); return this.setMode('insert'); }
    if (key === 'I') { this.setPosition(this.currentLine(), this.firstNonBlankColumn()); return this.setMode('insert'); }
    if (key === 'A') { this.setPosition(this.currentLine(), this.lineEndColumn()); return this.setMode('insert'); }
    if (key === 'o') return this.openLine(false, count);
    if (key === 'O') return this.openLine(true, count);
    if (key === 'v') return this.setMode('visual');
    if (key === 'V') return this.setMode('visual-line');
    if (key === 'u') { this.editor.trigger('vim', 'undo', null); return; }
    if (key === 'x') { this.deleteCharacters(count); return; }
    if (key === 'D') { this.deleteToEnd(false); return; }
    if (key === 'C') { this.deleteToEnd(true); return; }
    if (key === 'G') { this.setPosition(count > 1 ? count : this.lineCount(), 1); return; }
    if (key === 'g') { this.pending = 'g'; return; }
    if (key === 'd' || key === 'y' || key === 'c' || key === 'r' || key === 'f' || key === 'F') {
      this.pending = key;
      return;
    }
    if (key === 'p' || key === 'P') { this.paste(key === 'p', count); return; }
    if (key === 'h' || key === 'ArrowLeft') return this.moveHorizontal(-count);
    if (key === 'l' || key === 'ArrowRight') return this.moveHorizontal(count);
    if (key === 'j' || key === 'ArrowDown') return this.moveVertical(count);
    if (key === 'k' || key === 'ArrowUp') return this.moveVertical(-count);
    if (key === 'w') return this.moveWord(1, count);
    if (key === 'b') return this.moveWord(-1, count);
    if (key === 'e') return this.moveWord(1, count, true);
    if (key === '0') return this.setPosition(this.currentLine(), 1);
    if (key === '^') return this.setPosition(this.currentLine(), this.firstNonBlankColumn());
    if (key === '$') return this.setPosition(this.currentLine(), this.lineEndColumn());
    if (key === 'Enter') return this.moveVertical(count);
  }

  private handlePending(key: string): void {
    const pending = this.pending;
    this.pending = '';
    const count = this.takeCount();
    if (pending === 'g') {
      if (key === 'g') this.setPosition(count > 1 ? count : 1, 1);
      else this.handleKeyDown(new KeyboardEvent('keydown', { key }));
      return;
    }
    if (pending === 'r') {
      if (key.length === 1) this.replaceCharacter(key);
      return;
    }
    if (pending === 'f' || pending === 'F') {
      if (key.length === 1) this.findCharacter(key, pending === 'f', count);
      return;
    }
    if (pending === 'd' || pending === 'y' || pending === 'c') {
      if (key === 'i') {
        this.pending = `${pending}i`;
        return;
      }
      if (key === pending) {
        if (this.mode === 'visual' || this.mode === 'visual-line') this.applyVisualOperator(pending);
        else this.applyLineOperator(pending, count);
        return;
      }
      const motion = this.motionRange(key, count);
      if (motion) this.applyOperator(pending, motion.start, motion.end);
      return;
    }
    if (pending === 'di' || pending === 'yi' || pending === 'ci') {
      if (key === 'w') {
        const range = this.wordRange();
        if (range) this.applyOperator(pending[0] ?? 'd', range.start, range.end);
      }
      return;
    }
  }

  private takeCount(): number {
    const count = this.countBuffer === '' ? 1 : Number(this.countBuffer);
    this.countBuffer = '';
    return Math.max(1, Number.isFinite(count) ? count : 1);
  }

  private model(): monaco.editor.ITextModel | null { return this.editor.getModel(); }
  private currentLine(): number { return this.editor.getPosition()?.lineNumber ?? 1; }
  private lineCount(): number { return this.model()?.getLineCount() ?? 1; }
  private lineEndColumn(line = this.currentLine()): number { return this.model()?.getLineMaxColumn(line) ?? 1; }
  private firstNonBlankColumn(line = this.currentLine()): number {
    const text = this.model()?.getLineContent(line) ?? '';
    const index = text.search(/\S/);
    return index < 0 ? 1 : index + 1;
  }
  private clampPosition(line: number, column: number): Position {
    const lineNumber = Math.min(this.lineCount(), Math.max(1, line));
    return new monaco.Position(lineNumber, Math.min(this.lineEndColumn(lineNumber), Math.max(1, column)));
  }
  private setPosition(line: number, column: number, extend = false): void {
    const next = this.clampPosition(line, column);
    if (extend && this.anchor) {
      const anchor = this.anchor;
      this.editor.setSelection(new monaco.Selection(anchor.lineNumber, anchor.column, next.lineNumber, next.column));
    } else {
      this.editor.setPosition(next);
    }
    this.editor.revealPositionInCenterIfOutsideViewport(next);
  }

  private moveHorizontal(delta: number): void {
    const pos = this.editor.getPosition();
    if (!pos) return;
    this.setPosition(pos.lineNumber, pos.column + delta, this.mode === 'visual' || this.mode === 'visual-line');
  }
  private moveVertical(delta: number): void {
    const pos = this.editor.getPosition();
    if (!pos) return;
    this.setPosition(pos.lineNumber + delta, pos.column, this.mode === 'visual' || this.mode === 'visual-line');
  }
  private moveWord(direction: 1 | -1, count: number, toEnd = false): void {
    const model = this.model();
    const pos = this.editor.getPosition();
    if (!model || !pos) return;
    let offset = model.getOffsetAt(pos);
    const text = model.getValue();
    for (let i = 0; i < count; i += 1) {
      if (direction > 0) {
        if (toEnd) {
          while (offset < text.length && /\s/.test(text[offset] ?? '')) offset += 1;
          while (offset < text.length && !/\s/.test(text[offset] ?? '')) offset += 1;
          if (offset > 0) offset -= 1;
        } else {
          while (offset < text.length && !/\s/.test(text[offset] ?? '')) offset += 1;
          while (offset < text.length && /\s/.test(text[offset] ?? '')) offset += 1;
        }
      } else {
        offset = Math.max(0, offset - 1);
        while (offset > 0 && /\s/.test(text[offset] ?? '')) offset -= 1;
        while (offset > 0 && !/\s/.test(text[offset - 1] ?? '')) offset -= 1;
      }
    }
    this.setPositionFromOffset(offset);
  }

  private setPositionFromOffset(offset: number, extend = this.mode === 'visual' || this.mode === 'visual-line'): void {
    const model = this.model();
    if (!model) return;
    this.setPositionFromMonaco(model.getPositionAt(Math.max(0, Math.min(model.getValueLength(), offset))), extend);
  }
  private setPositionFromMonaco(pos: Position, extend: boolean): void { this.setPosition(pos.lineNumber, pos.column, extend); }

  private motionRange(key: string, count: number): { start: Position; end: Position } | null {
    const pos = this.editor.getPosition();
    const model = this.model();
    if (!pos || !model) return null;
    const start = pos;
    if (key === 'w' || key === 'e' || key === 'b') {
      const before = model.getOffsetAt(pos);
      this.moveWord(key === 'b' ? -1 : 1, count, key === 'e');
      const end = this.editor.getPosition() ?? pos;
      this.setPositionFromOffset(before);
      return { start, end };
    }
    if (key === '$') return { start, end: this.clampPosition(pos.lineNumber, this.lineEndColumn(pos.lineNumber)) };
    if (key === '0' || key === '^') return { start, end: this.clampPosition(pos.lineNumber, key === '^' ? this.firstNonBlankColumn(pos.lineNumber) : 1) };
    if (key === 'j' || key === 'ArrowDown') return { start, end: this.clampPosition(pos.lineNumber + count, pos.column) };
    if (key === 'k' || key === 'ArrowUp') return { start, end: this.clampPosition(pos.lineNumber - count, pos.column) };
    if (key === 'h' || key === 'ArrowLeft') return { start, end: this.clampPosition(pos.lineNumber, pos.column - count) };
    if (key === 'l' || key === 'ArrowRight') return { start, end: this.clampPosition(pos.lineNumber, pos.column + count) };
    return null;
  }

  private applyLineOperator(operator: string, count: number): void {
    const pos = this.editor.getPosition();
    const model = this.model();
    if (!pos || !model) return;
    const lastLine = Math.min(model.getLineCount(), pos.lineNumber + count - 1);
    const start = new monaco.Position(pos.lineNumber, 1);
    const end = lastLine < model.getLineCount()
      ? new monaco.Position(lastLine + 1, 1)
      : new monaco.Position(lastLine, model.getLineMaxColumn(lastLine));
    if (operator === 'y') this.yankRange(start, end);
    else this.applyOperator(operator, start, end);
  }

  private applyOperator(operator: string, start: Position, end: Position): void {
    const positions = this.normalizeRange(start, end);
    const range = this.toRange(positions);
    if (operator === 'y') { this.yankRange(positions.start, positions.end); return; }
    const text = this.model()?.getValueInRange(range) ?? '';
    if (operator === 'c') this.yankBuffer = text;
    this.editor.executeEdits('vim', [{ range, text: '' }]);
    this.setPosition(positions.start.lineNumber, positions.start.column);
    if (operator === 'c') this.setMode('insert');
  }

  private applyVisualOperator(operator: string): void {
    if (!this.anchor) return;
    const active = this.editor.getPosition() ?? this.anchor;
    const range = this.mode === 'visual-line'
      ? this.normalizeRange(new monaco.Position(Math.min(this.anchor.lineNumber, active.lineNumber), 1), new monaco.Position(Math.max(this.anchor.lineNumber, active.lineNumber), this.lineEndColumn(Math.max(this.anchor.lineNumber, active.lineNumber))))
      : this.normalizeRange(this.anchor, active);
    if (operator === 'y') this.yankRange(range.start, range.end);
    else this.applyOperator(operator, range.start, range.end);
    if (operator !== 'y') this.setMode(operator === 'c' ? 'insert' : 'normal');
  }

  private normalizeRange(a: Position, b: Position): { start: Position; end: Position } {
    return a.lineNumber < b.lineNumber || (a.lineNumber === b.lineNumber && a.column <= b.column)
      ? { start: a, end: b } : { start: b, end: a };
  }

  private toRange(range: { start: Position; end: Position }): monaco.Range {
    return new monaco.Range(range.start.lineNumber, range.start.column, range.end.lineNumber, range.end.column);
  }

  private wordRange(): { start: Position; end: Position } | null {
    const model = this.model();
    const pos = this.editor.getPosition();
    if (!model || !pos) return null;
    const line = model.getLineContent(pos.lineNumber);
    let start = Math.max(0, Math.min(line.length, pos.column - 1));
    while (start > 0 && !/\s/.test(line[start - 1] ?? '')) start -= 1;
    let end = start;
    while (end < line.length && !/\s/.test(line[end] ?? '')) end += 1;
    return { start: new monaco.Position(pos.lineNumber, start + 1), end: new monaco.Position(pos.lineNumber, end + 1) };
  }

  private yankRange(start: Position, end: Position): void {
    this.yankBuffer = this.model()?.getValueInRange(this.toRange(this.normalizeRange(start, end))) ?? '';
    const clipboardWrite = navigator.clipboard?.writeText(this.yankBuffer);
    if (clipboardWrite) void clipboardWrite.catch(() => undefined);
    this.setPosition(start.lineNumber, start.column);
    this.setMode('normal');
  }

  private paste(after: boolean, count: number): void {
    if (this.yankBuffer === '') return;
    const pos = this.editor.getPosition();
    if (!pos) return;
    const model = this.model();
    if (!model) return;
    let text = this.yankBuffer;
    for (let i = 1; i < count; i += 1) text += this.yankBuffer;
    const linewise = text.endsWith('\n');
    const target = linewise
      ? new monaco.Position(Math.min(model.getLineCount(), pos.lineNumber + (after ? 1 : 0)), 1)
      : new monaco.Position(pos.lineNumber, after ? Math.min(model.getLineMaxColumn(pos.lineNumber), pos.column + 1) : pos.column);
    this.editor.executeEdits('vim', [{ range: new monaco.Range(target.lineNumber, target.column, target.lineNumber, target.column), text }]);
    this.setPosition(target.lineNumber, target.column);
  }

  private deleteCharacters(count: number): void {
    const pos = this.editor.getPosition();
    if (!pos || !this.model()) return;
    const end = this.clampPosition(pos.lineNumber, pos.column + count);
    this.applyOperator('d', pos, end);
  }

  private deleteToEnd(change: boolean): void {
    const pos = this.editor.getPosition();
    if (!pos) return;
    this.applyOperator('d', pos, this.clampPosition(pos.lineNumber, this.lineEndColumn(pos.lineNumber)));
    if (change) this.setMode('insert');
  }

  private replaceCharacter(char: string): void {
    const pos = this.editor.getPosition();
    if (!pos || !this.model()) return;
    const end = this.clampPosition(pos.lineNumber, pos.column + 1);
    this.editor.executeEdits('vim', [{ range: new monaco.Range(pos.lineNumber, pos.column, end.lineNumber, end.column), text: char }]);
  }

  private findCharacter(char: string, forward: boolean, count: number): void {
    const model = this.model();
    const pos = this.editor.getPosition();
    if (!model || !pos) return;
    const line = model.getLineContent(pos.lineNumber);
    let index = pos.column - 1;
    for (let i = 0; i < count; i += 1) index = forward ? line.indexOf(char, index + 1) : line.lastIndexOf(char, index - 1);
    if (index >= 0) this.setPosition(pos.lineNumber, index + 1, this.mode === 'visual' || this.mode === 'visual-line');
  }

  private openLine(above: boolean, count: number): void {
    const pos = this.editor.getPosition();
    const model = this.model();
    if (!pos || !model) return;
    const line = pos.lineNumber;
    const at = above ? new monaco.Position(line, 1) : new monaco.Position(line, model.getLineMaxColumn(line));
    const text = above ? '\n'.repeat(count) : '\n'.repeat(count);
    this.editor.executeEdits('vim', [{ range: new monaco.Range(at.lineNumber, at.column, at.lineNumber, at.column), text }]);
    this.setPosition(above ? line : line + 1, 1);
    this.setMode('insert');
  }
}
