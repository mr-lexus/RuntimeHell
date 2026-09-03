import * as monaco from 'monaco-editor';

export type VimMode = 'normal' | 'insert' | 'visual' | 'visual-line' | 'replace';

/** A single keybinding hint shown in the which-key style popup. */
export interface PendingHint {
  /** The key the user can press next (display label). */
  key: string;
  /** Short description of what this key does. */
  description: string;
}

interface VimModeOptions {
  editor: monaco.editor.IStandaloneCodeEditor;
  onModeChange?: (mode: VimMode) => void;
  /** Fired when the user completes the `:help` command. */
  onHelp?: () => void;
  /** Fired whenever the `:` command-line buffer changes ('' when idle). */
  onCommandChange?: (command: string) => void;
  /** Fired when the `:` command line becomes active or inactive. */
  onCommandActive?: (active: boolean) => void;
  /** Fired when a pending multi-key sequence starts or resolves. null = cleared. */
  onPendingChange?: (pending: string | null, hints: PendingHint[]) => void;
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
  private readonly keySubscription: monaco.IDisposable;
  private readonly onModeChange?: (mode: VimMode) => void;
  private readonly onHelp?: () => void;
  private readonly onCommandChange?: (command: string) => void;
  private readonly onCommandActive?: (active: boolean) => void;
  private readonly onPendingChange?: (pending: string | null, hints: PendingHint[]) => void;
  private mode: VimMode = 'normal';
  private pending = '';
  private countBuffer = '';
  /** Non-null while the `:` command line is active. */
  private commandLine: string | null = null;
  private anchor: Position | null = null;
  private yankBuffer = '';
  private disposed = false;
  /** Last f/F/t/T target so `;`/`,` can repeat it. */
  private lastFind: { char: string; forward: boolean; till: boolean } | null = null;
  /** Word search term from `*`/`#`, reused by `n`/`N`. */
  private searchTerm = '';
  private searchForward = true;
  /** Last visual selection so `gv` can reselect it. */
  private lastVisual: { anchor: Position; active: Position; mode: 'visual' | 'visual-line' } | null = null;
  /** Last insert position so `gi` can return to it. */
  private lastInsertPosition: Position | null = null;
  /** Last operator+motion so `.` can repeat it. */
  private lastChange: { operator: string; motion: string; count: number } | null = null;

  constructor({ editor, onModeChange, onHelp, onCommandChange, onCommandActive, onPendingChange }: VimModeOptions) {
    this.editor = editor;
    this.onModeChange = onModeChange;
    this.onHelp = onHelp;
    this.onCommandChange = onCommandChange;
    this.onCommandActive = onCommandActive;
    this.onPendingChange = onPendingChange;
    this.keySubscription = editor.onKeyDown((event) => this.handleKeyDown(event));
    this.applyModeVisuals();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.keySubscription.dispose();
    this.onCommandActive?.(false);
    try { this.editor.updateOptions({ cursorStyle: 'line', cursorBlinking: 'blink' }); } catch { /* editor may already be disposed */ }
  }

  /** Updates the `:` command-line buffer (used by the statusline input). */
  setCommandLine(command: string): void {
    if (this.commandLine === null) return;
    this.commandLine = command;
    this.onCommandChange?.(command);
  }

  /** Completes the `:` command line (Enter in the statusline input). */
  submitCommand(command: string): void {
    this.commandLine = null;
    this.onCommandChange?.('');
    this.onCommandActive?.(false);
    if (command === 'help') this.onHelp?.();
    this.editor.focus();
  }

  /** Cancels the `:` command line (Escape in the statusline input). */
  cancelCommand(): void {
    this.commandLine = null;
    this.onCommandChange?.('');
    this.onCommandActive?.(false);
    this.editor.focus();
  }

  private setMode(mode: VimMode): void {
    const previous = this.mode;
    this.mode = mode;
    this.pending = '';
    this.countBuffer = '';
    this.notifyPending();
    if ((previous === 'visual' || previous === 'visual-line') && mode !== 'visual' && mode !== 'visual-line') {
      const active = this.editor.getPosition();
      if (this.anchor && active) this.lastVisual = { anchor: this.anchor, active, mode: previous };
    }
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
    if (mode === 'insert' || mode === 'replace') {
      const pos = this.editor.getPosition();
      if (pos) this.lastInsertPosition = pos;
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

  private static readonly CODE_TO_KEY: Record<string, string> = {
    Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']',
    Backquote: '`', Comma: ',', Period: '.', Slash: '/', Backslash: '\\',
    Minus: '-', Equal: '=', Space: ' '
  };

  private static readonly CODE_TO_SHIFTED_KEY: Record<string, string> = {
    Semicolon: ':', Quote: '"', BracketLeft: '{', BracketRight: '}',
    Backquote: '~', Comma: '<', Period: '>', Slash: '?', Backslash: '|',
    Minus: '_', Equal: '+', Space: ' '
  };

  private static readonly SHIFTED_DIGITS: Record<string, string> = {
    '1': '!', '2': '@', '3': '#', '4': '$', '5': '%', '6': '^', '7': '&', '8': '*', '9': '(', '0': ')'
  };

  /**
   * Which-key style hints for a pending multi-key sequence. Returns the list of
   * keys the user can press next and what each does, or an empty array when the
   * pending prefix has no known continuations.
   */
  static getPendingHints(pending: string): PendingHint[] {
    switch (pending) {
      case 'g':
        return [
          { key: 'g', description: 'Go to first line' },
          { key: 'J', description: 'Join lines without space' },
          { key: 'v', description: 'Reselect last visual' },
          { key: 'd', description: 'Go to definition' },
          { key: 'D', description: 'Go to declaration' },
          { key: 'i', description: 'Return to last insert' },
          { key: 'c', description: 'Toggle comment' }
        ];
      case 'z':
        return [
          { key: 't', description: 'Scroll cursor to top' },
          { key: 'z', description: 'Scroll cursor to center' },
          { key: 'b', description: 'Scroll cursor to bottom' },
          { key: 'R', description: 'Fold all' },
          { key: 'M', description: 'Unfold all' },
          { key: 'a', description: 'Toggle fold' }
        ];
      case '>':
        return [
          { key: '>', description: 'Indent line' },
          { key: 'motion', description: 'Indent to motion' }
        ];
      case '<':
        return [
          { key: '<', description: 'Outdent line' },
          { key: 'motion', description: 'Outdent to motion' }
        ];
      case '=':
        return [
          { key: '=', description: 'Format line' },
          { key: 'motion', description: 'Format to motion' }
        ];
      case 'd':
        return [
          { key: 'd', description: 'Delete line' },
          { key: 'i', description: 'Delete inside' },
          { key: 'motion', description: 'Delete to motion' }
        ];
      case 'y':
        return [
          { key: 'y', description: 'Yank line' },
          { key: 'i', description: 'Yank inside' },
          { key: 'motion', description: 'Yank to motion' }
        ];
      case 'c':
        return [
          { key: 'c', description: 'Change line' },
          { key: 'i', description: 'Change inside' },
          { key: 'motion', description: 'Change to motion' }
        ];
      case 'r':
        return [{ key: 'char', description: 'Replace character' }];
      case 'f':
        return [{ key: 'char', description: 'Find forward' }];
      case 'F':
        return [{ key: 'char', description: 'Find backward' }];
      case 't':
        return [{ key: 'char', description: 'Till forward' }];
      case 'T':
        return [{ key: 'char', description: 'Till backward' }];
      case 'di':
        return [{ key: 'w', description: 'Delete inside word' }];
      case 'yi':
        return [{ key: 'w', description: 'Yank inside word' }];
      case 'ci':
        return [{ key: 'w', description: 'Change inside word' }];
      default:
        return [];
    }
  }

  /** Fires onPendingChange with the current pending prefix and its hints. */
  private notifyPending(): void {
    this.onPendingChange?.(this.pending === '' ? null : this.pending, VimModeController.getPendingHints(this.pending));
  }

  /**
   * Derives the command key from the PHYSICAL key position (event.code) so
   * Vim motions work under any keyboard layout — on a Russian ЙЦУКЕН layout
   * event.key returns Cyrillic characters (physical H → 'р'), which would
   * never match 'h'/'j'/'k'/'l' etc. Falls back to event.key when event.code
   * is unavailable or not a printable US-layout key (Escape, Enter, arrows).
   */
  private normalizeKey(event: monaco.IKeyboardEvent): string {
    const code = event.browserEvent.code;
    const shifted = event.browserEvent.shiftKey;
    if (code && code.startsWith('Key') && code.length === 4) {
      const letter = code[3] ?? '';
      return shifted ? letter.toUpperCase() : letter.toLowerCase();
    }
    if (code && code.startsWith('Digit') && code.length === 6) {
      const digit = code[5] ?? '';
      return shifted ? (VimModeController.SHIFTED_DIGITS[digit] ?? digit) : digit;
    }
    if (code) {
      const mapped = shifted ? VimModeController.CODE_TO_SHIFTED_KEY[code] : VimModeController.CODE_TO_KEY[code];
      if (mapped !== undefined) return mapped;
    }
    return event.browserEvent.key;
  }

  private handleKeyDown(event: monaco.IKeyboardEvent): void {
    if (this.disposed) return;
    const rawKey = event.browserEvent.key;
    if (this.mode === 'insert') {
      if (rawKey === 'Escape' || (event.ctrlKey && (rawKey === '[' || event.browserEvent.code === 'BracketLeft'))) {
        event.preventDefault();
        event.stopPropagation();
        const pos = this.editor.getPosition();
        this.setMode('normal');
        if (pos && pos.column > 1) this.editor.setPosition({ lineNumber: pos.lineNumber, column: pos.column - 1 });
      }
      return;
    }
    if (this.mode === 'replace') {
      if (rawKey === 'Escape' || (event.ctrlKey && (rawKey === '[' || event.browserEvent.code === 'BracketLeft'))) {
        event.preventDefault();
        event.stopPropagation();
        const pos = this.editor.getPosition();
        this.setMode('normal');
        if (pos && pos.column > 1) this.editor.setPosition({ lineNumber: pos.lineNumber, column: pos.column - 1 });
      } else if (rawKey.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        event.stopPropagation();
        this.replaceCharacter(rawKey);
        this.moveHorizontal(1);
      }
      return;
    }

    // Preserve browser/Monaco shortcuts such as Ctrl+S, Ctrl+Enter and the
    // command palette while Vim is in normal or visual mode.
    if (event.ctrlKey || event.metaKey || event.altKey) {
      if (event.ctrlKey && (rawKey.toLowerCase() === 'r' || event.browserEvent.code === 'KeyR')) {
        event.preventDefault();
        event.stopPropagation();
        this.editor.trigger('vim', 'redo', null);
        return;
      }
      if (event.ctrlKey && !event.metaKey && !event.altKey) {
        const ctrl = rawKey.toLowerCase();
        if (ctrl === 'a') { event.preventDefault(); event.stopPropagation(); this.incrementNumber(1); return; }
        if (ctrl === 'x') { event.preventDefault(); event.stopPropagation(); this.incrementNumber(-1); return; }
        if (ctrl === 'd') { event.preventDefault(); event.stopPropagation(); this.scrollHalfPage(1); return; }
        if (ctrl === 'u') { event.preventDefault(); event.stopPropagation(); this.scrollHalfPage(-1); return; }
        if (ctrl === 'f') { event.preventDefault(); event.stopPropagation(); this.scrollPage(1); return; }
        if (ctrl === 'b') { event.preventDefault(); event.stopPropagation(); this.scrollPage(-1); return; }
        if (ctrl === 'e') { event.preventDefault(); event.stopPropagation(); this.scrollLines(1); return; }
        if (ctrl === 'y') { event.preventDefault(); event.stopPropagation(); this.scrollLines(-1); return; }
      }
      return;
    }

    const key = this.normalizeKey(event);

    event.preventDefault();
    event.stopPropagation();
    if (this.commandLine !== null) {
      this.handleCommandKey(key);
      return;
    }
    if (key === 'Escape') {
      this.setMode('normal');
      return;
    }

    if (this.pending !== '') {
      this.handlePending(key);
      return;
    }

    this.handleNormalKey(key);
  }

  /** Handles keys while the `:` command line is active. */
  private handleCommandKey(key: string): void {
    if (key === 'Escape') {
      this.commandLine = null;
      this.onCommandChange?.('');
      this.onCommandActive?.(false);
      return;
    }
    if (key === 'Enter') {
      const command = this.commandLine ?? '';
      this.commandLine = null;
      this.onCommandChange?.('');
      this.onCommandActive?.(false);
      if (command === 'help') this.onHelp?.();
      return;
    }
    if (key === 'Backspace') {
      this.commandLine = (this.commandLine ?? '').slice(0, -1);
      this.onCommandChange?.(this.commandLine);
      return;
    }
    if (key.length === 1) {
      this.commandLine = (this.commandLine ?? '') + key;
      this.onCommandChange?.(this.commandLine);
    }
  }

  private handleNormalKey(key: string): void {
    if (/^[1-9]$/.test(key) || (this.countBuffer !== '' && key === '0')) {
      this.countBuffer += key;
      return;
    }
    const count = this.takeCount();

    if (key === ':') {
      this.pending = '';
      this.countBuffer = '';
      this.notifyPending();
      this.commandLine = '';
      this.onCommandChange?.('');
      this.onCommandActive?.(true);
      return;
    }

    if (key === 'i') return this.setMode('insert');
    if (key === 'a') { this.moveHorizontal(1); return this.setMode('insert'); }
    if (key === 'I') { this.setPosition(this.currentLine(), this.firstNonBlankColumn()); return this.setMode('insert'); }
    if (key === 'A') { this.setPosition(this.currentLine(), this.lineEndColumn()); return this.setMode('insert'); }
    if (key === 'o') return this.openLine(false, count);
    if (key === 'O') return this.openLine(true, count);
    if (key === 'v') return this.setMode('visual');
    if (key === 'V') return this.setMode('visual-line');
    if (key === 'R') return this.setMode('replace');
    if (key === 'u') { this.editor.trigger('vim', 'undo', null); return; }
    if (key === 'x') { this.deleteCharacters(count); return; }
    if (key === 'X') {
      const pos = this.editor.getPosition();
      if (pos) this.applyOperator('d', this.clampPosition(pos.lineNumber, pos.column - count), pos);
      return;
    }
    if (key === 's') { this.deleteCharacters(count); return this.setMode('insert'); }
    if (key === 'S') { this.applyLineOperator('c', count); return; }
    if (key === 'D') { this.deleteToEnd(false); return; }
    if (key === 'C') { this.deleteToEnd(true); return; }
    if (key === 'G') { this.setPosition(count > 1 ? count : this.lineCount(), 1); return; }
    if (key === 'g') { this.pending = 'g'; this.notifyPending(); return; }
    if (key === 'd' || key === 'y' || key === 'c' || key === 'r' || key === 'f' || key === 'F' || key === 't' || key === 'T') {
      this.pending = key;
      this.notifyPending();
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
    if (key === '{') return this.moveParagraph(-1, count);
    if (key === '}') return this.moveParagraph(1, count);
    if (key === '(') return this.moveSentence(-1, count);
    if (key === ')') return this.moveSentence(1, count);
    if (key === '%') return this.matchBracket();
    if (key === '*') return this.searchWord(true);
    if (key === '#') return this.searchWord(false);
    if (key === 'n') return this.searchNext(this.searchForward);
    if (key === 'N') return this.searchNext(!this.searchForward);
    if (key === '/') { this.editor.trigger('vim', 'actions.find', null); return; }
    if (key === 'H') return this.moveScreenTop();
    if (key === 'M') return this.moveScreenMiddle();
    if (key === 'L') return this.moveScreenBottom();
    if (key === 'z') { this.pending = 'z'; this.notifyPending(); return; }
    if (key === 'J') {
      if (this.mode === 'visual' || this.mode === 'visual-line') return this.joinSelection();
      return this.joinLines(count + 1, false);
    }
    if (key === '>') {
      if (this.mode === 'visual' || this.mode === 'visual-line') return this.indentSelection(true, false);
      this.pending = '>';
      this.notifyPending();
      return;
    }
    if (key === '<') {
      if (this.mode === 'visual' || this.mode === 'visual-line') return this.indentSelection(false, false);
      this.pending = '<';
      this.notifyPending();
      return;
    }
    if (key === '=') {
      if (this.mode === 'visual' || this.mode === 'visual-line') return this.indentSelection(false, true);
      this.pending = '=';
      this.notifyPending();
      return;
    }
    if (key === '~') {
      if (this.mode === 'visual' || this.mode === 'visual-line') return this.toggleCaseSelection();
      return this.toggleCase(count);
    }
    if (key === ';') return this.repeatFind(true);
    if (key === ',') return this.repeatFind(false);
    if (key === 'K') { this.editor.trigger('vim', 'editor.action.showHover', null); return; }
    if (key === '.') return this.repeatLastChange();
  }

  private handlePending(key: string): void {
    const pending = this.pending;
    this.pending = '';
    this.notifyPending();
    const count = this.takeCount();
    if (pending === 'g') {
      if (key === 'g') this.setPosition(count > 1 ? count : 1, 1);
      else if (key === 'J') this.joinLines(count, true);
      else if (key === 'v') this.reselectVisual();
      else if (key === 'd') this.editor.trigger('vim', 'editor.action.revealDefinition', null);
      else if (key === 'D') this.editor.trigger('vim', 'editor.action.revealDeclaration', null);
      else if (key === 'i') this.gotoLastInsert();
      else if (key === 'c') {
        if (this.mode === 'visual' || this.mode === 'visual-line') this.toggleCommentSelection();
        else this.toggleCommentLines(count);
      } else this.handleNormalKey(key);
      return;
    }
    if (pending === 'z') {
      if (key === 't') return this.scrollCursorTo('top');
      if (key === 'z') return this.scrollCursorTo('center');
      if (key === 'b') return this.scrollCursorTo('bottom');
      if (key === 'R') { this.editor.trigger('vim', 'editor.foldAll', null); return; }
      if (key === 'M') { this.editor.trigger('vim', 'editor.unfoldAll', null); return; }
      if (key === 'a') { this.editor.trigger('vim', 'editor.toggleFold', null); return; }
      this.handleNormalKey(key);
      return;
    }
    if (pending === '>') {
      if (key === '>') { this.indentLines(count, true); return; }
      const motion = this.motionRange(key, count);
      if (motion) this.indentRange(motion.start, motion.end, true);
      return;
    }
    if (pending === '<') {
      if (key === '<') { this.indentLines(count, false); return; }
      const motion = this.motionRange(key, count);
      if (motion) this.indentRange(motion.start, motion.end, false);
      return;
    }
    if (pending === '=') {
      if (key === '=') { this.formatLines(count); return; }
      const motion = this.motionRange(key, count);
      if (motion) this.formatRange(motion.start, motion.end);
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
    if (pending === 't' || pending === 'T') {
      if (key.length === 1) this.findCharacter(key, pending === 't', count, true);
      return;
    }
    if (pending === 'd' || pending === 'y' || pending === 'c') {
      if (key === 'i') {
        this.pending = `${pending}i`;
        this.notifyPending();
        return;
      }
      if (key === pending) {
        this.lastChange = { operator: pending, motion: pending, count };
        if (this.mode === 'visual' || this.mode === 'visual-line') this.applyVisualOperator(pending);
        else this.applyLineOperator(pending, count);
        return;
      }
      const motion = this.motionRange(key, count);
      if (motion) {
        this.lastChange = { operator: pending, motion: key, count };
        this.applyOperator(pending, motion.start, motion.end);
      }
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
    if (key === 'G') return { start, end: this.clampPosition(count > 1 ? count : this.lineCount(), 1) };
    if (key === 'j' || key === 'ArrowDown') return { start, end: this.clampPosition(pos.lineNumber + count, pos.column) };
    if (key === 'k' || key === 'ArrowUp') return { start, end: this.clampPosition(pos.lineNumber - count, pos.column) };
    if (key === 'h' || key === 'ArrowLeft') return { start, end: this.clampPosition(pos.lineNumber, pos.column - count) };
    if (key === 'l' || key === 'ArrowRight') return { start, end: this.clampPosition(pos.lineNumber, pos.column + count) };
    if (key === '{' || key === '}') {
      const before = this.editor.getPosition() ?? pos;
      this.moveParagraph(key === '}' ? 1 : -1, count);
      const end = this.editor.getPosition() ?? pos;
      this.setPosition(before.lineNumber, before.column);
      return { start, end };
    }
    if (key === '(' || key === ')') {
      const before = this.editor.getPosition() ?? pos;
      this.moveSentence(key === ')' ? 1 : -1, count);
      const end = this.editor.getPosition() ?? pos;
      this.setPosition(before.lineNumber, before.column);
      return { start, end };
    }
    if (key === '%') {
      const before = this.editor.getPosition() ?? pos;
      this.matchBracket();
      const end = this.editor.getPosition() ?? pos;
      this.setPosition(before.lineNumber, before.column);
      return { start, end };
    }
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

  private findCharacter(char: string, forward: boolean, count: number, till = false): void {
    const model = this.model();
    const pos = this.editor.getPosition();
    if (!model || !pos) return;
    this.lastFind = { char, forward, till };
    const line = model.getLineContent(pos.lineNumber);
    let index = pos.column - 1;
    for (let i = 0; i < count; i += 1) index = forward ? line.indexOf(char, index + 1) : line.lastIndexOf(char, index - 1);
    if (index >= 0) {
      const column = till ? (forward ? index : index + 2) : index + 1;
      this.setPosition(pos.lineNumber, column, this.mode === 'visual' || this.mode === 'visual-line');
    }
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

  // ── LazyVim keybinding implementations ──────────────────────────────

  /** `{`/`}` — jump to the previous/next paragraph boundary (blank line). */
  private moveParagraph(direction: 1 | -1, count: number): void {
    const model = this.model();
    const pos = this.editor.getPosition();
    if (!model || !pos) return;
    let line = pos.lineNumber;
    for (let i = 0; i < count; i += 1) {
      if (direction > 0) {
        while (line < model.getLineCount() && model.getLineContent(line).trim() !== '') line += 1;
        while (line < model.getLineCount() && model.getLineContent(line).trim() === '') line += 1;
      } else {
        while (line > 1 && model.getLineContent(line).trim() === '') line -= 1;
        while (line > 1 && model.getLineContent(line - 1).trim() !== '') line -= 1;
        if (line > 1) {
          line -= 1;
          while (line > 1 && model.getLineContent(line).trim() === '') line -= 1;
          while (line > 1 && model.getLineContent(line - 1).trim() !== '') line -= 1;
        }
      }
    }
    this.setPosition(line, this.firstNonBlankColumn(line), this.mode === 'visual' || this.mode === 'visual-line');
  }

  /** `(`/`)` — jump to the previous/next sentence boundary. */
  private moveSentence(direction: 1 | -1, count: number): void {
    const model = this.model();
    const pos = this.editor.getPosition();
    if (!model || !pos) return;
    let offset = model.getOffsetAt(pos);
    const text = model.getValue();
    for (let i = 0; i < count; i += 1) {
      if (direction > 0) {
        while (offset < text.length && !/[.!?]/.test(text[offset] ?? '')) offset += 1;
        while (offset < text.length && /[\s.!?]/.test(text[offset] ?? '')) offset += 1;
      } else {
        offset = Math.max(0, offset - 1);
        while (offset > 0 && !/[.!?]/.test(text[offset] ?? '')) offset -= 1;
        while (offset > 0 && /[\s.!?]/.test(text[offset - 1] ?? '')) offset -= 1;
      }
    }
    this.setPositionFromOffset(offset);
  }

  /** `%` — jump to the matching bracket (or nearest bracket on the line). */
  private matchBracket(): void {
    const model = this.model();
    const pos = this.editor.getPosition();
    if (!model || !pos) return;
    const line = model.getLineContent(pos.lineNumber);
    const brackets = '()[]{}';
    const at = line[pos.column - 1] ?? '';
    if (brackets.includes(at)) {
      this.editor.trigger('vim', 'editor.action.jumpToBracket', null);
      return;
    }
    const before = line.slice(0, pos.column - 1);
    const after = line.slice(pos.column - 1);
    let beforeIndex = -1;
    for (const b of brackets) beforeIndex = Math.max(beforeIndex, before.lastIndexOf(b));
    let afterIndex = -1;
    for (const b of brackets) {
      const i = after.indexOf(b);
      if (i >= 0 && (afterIndex < 0 || i < afterIndex)) afterIndex = i;
    }
    if (beforeIndex >= 0 && (afterIndex < 0 || pos.column - 1 - beforeIndex <= afterIndex)) {
      this.setPosition(pos.lineNumber, beforeIndex + 1);
    } else if (afterIndex >= 0) {
      this.setPosition(pos.lineNumber, pos.column + afterIndex);
    }
  }

  /** `*`/`#` — search for the word under the cursor. */
  private searchWord(forward: boolean): void {
    const model = this.model();
    const pos = this.editor.getPosition();
    if (!model || !pos) return;
    const line = model.getLineContent(pos.lineNumber);
    const after = line.slice(pos.column - 1).match(/[A-Za-z0-9_]+/)?.[0] ?? '';
    const before = line.slice(0, pos.column - 1).match(/[A-Za-z0-9_]+$/)?.[0] ?? '';
    const word = after || before;
    if (word === '') return;
    this.searchTerm = word;
    this.searchForward = forward;
    this.searchNext(true);
  }

  /** `n`/`N` — repeat the last word search. */
  private searchNext(forward: boolean): void {
    const model = this.model();
    const pos = this.editor.getPosition();
    if (!model || !pos || this.searchTerm === '') return;
    const text = model.getValue();
    const offset = model.getOffsetAt(pos);
    const term = this.searchTerm;
    let found = forward ? text.indexOf(term, offset + 1) : text.lastIndexOf(term, offset - 1);
    if (found < 0) found = forward ? text.indexOf(term, 0) : text.lastIndexOf(term, text.length);
    if (found >= 0) {
      const start = model.getPositionAt(found);
      const end = model.getPositionAt(found + term.length);
      this.editor.setSelection(new monaco.Selection(start.lineNumber, start.column, end.lineNumber, end.column));
      this.editor.setPosition(start);
      this.editor.revealPositionInCenterIfOutsideViewport(start);
    }
  }

  /** `H` — move to the first visible line. */
  private moveScreenTop(): void {
    const ranges = this.editor.getVisibleRanges();
    const line = ranges.length > 0 ? (ranges[0]?.startLineNumber ?? 1) : 1;
    this.setPosition(line, this.firstNonBlankColumn(line));
  }

  /** `M` — move to the middle visible line. */
  private moveScreenMiddle(): void {
    const ranges = this.editor.getVisibleRanges();
    if (ranges.length === 0) return;
    const first = ranges[0]?.startLineNumber ?? 1;
    const last = ranges[ranges.length - 1]?.endLineNumber ?? first;
    const line = Math.floor((first + last) / 2);
    this.setPosition(line, this.firstNonBlankColumn(line));
  }

  /** `L` — move to the last visible line. */
  private moveScreenBottom(): void {
    const ranges = this.editor.getVisibleRanges();
    const line = ranges.length > 0 ? (ranges[ranges.length - 1]?.endLineNumber ?? 1) : 1;
    this.setPosition(line, this.firstNonBlankColumn(line));
  }

  /** `zt`/`zz`/`zb` — scroll the cursor line to top/center/bottom. */
  private scrollCursorTo(where: 'top' | 'center' | 'bottom'): void {
    const pos = this.editor.getPosition();
    if (!pos) return;
    if (where === 'top') this.editor.revealLineNearTop(pos.lineNumber);
    else if (where === 'center') this.editor.revealPositionInCenter(pos);
    else {
      const ranges = this.editor.getVisibleRanges();
      const lastLine = ranges.length > 0 ? (ranges[ranges.length - 1]?.endLineNumber ?? pos.lineNumber) : pos.lineNumber;
      const visibleLines = ranges.length > 0 ? lastLine - (ranges[0]?.startLineNumber ?? 1) + 1 : 10;
      this.editor.setScrollTop(Math.max(0, this.editor.getScrollTop() + (pos.lineNumber - lastLine) * 18));
    }
  }

  /** Ctrl+d / Ctrl+u — scroll half a page. */
  private scrollHalfPage(direction: 1 | -1): void {
    const ranges = this.editor.getVisibleRanges();
    if (ranges.length === 0) return;
    const first = ranges[0]?.startLineNumber ?? 1;
    const last = ranges[ranges.length - 1]?.endLineNumber ?? first;
    const delta = Math.floor(Math.max(1, last - first + 1) / 2) * direction;
    this.scrollByLines(delta);
  }

  /** Ctrl+f / Ctrl+b — scroll a full page. */
  private scrollPage(direction: 1 | -1): void {
    const ranges = this.editor.getVisibleRanges();
    if (ranges.length === 0) return;
    const first = ranges[0]?.startLineNumber ?? 1;
    const last = ranges[ranges.length - 1]?.endLineNumber ?? first;
    const delta = Math.max(1, last - first + 1) * direction;
    this.scrollByLines(delta);
  }

  /** Ctrl+e / Ctrl+y — scroll one line. */
  private scrollLines(direction: 1 | -1): void {
    this.scrollByLines(direction);
  }

  private scrollByLines(delta: number): void {
    const pos = this.editor.getPosition();
    if (!pos) return;
    const target = this.clampPosition(pos.lineNumber + delta, pos.column);
    try { this.editor.setScrollTop(this.editor.getScrollTop() + delta * 18); } catch { /* mock */ }
    this.setPosition(target.lineNumber, target.column);
  }

  /** `J`/`gJ` — join count lines. gJ keeps whitespace. */
  private joinLines(count: number, keepWhitespace: boolean): void {
    const model = this.model();
    const pos = this.editor.getPosition();
    if (!model || !pos) return;
    const lastLine = Math.min(model.getLineCount(), pos.lineNumber + count - 1);
    if (lastLine <= pos.lineNumber) return;
    const start = new monaco.Position(pos.lineNumber, 1);
    const end = new monaco.Position(lastLine, model.getLineMaxColumn(lastLine));
    const lines: string[] = [];
    for (let line = pos.lineNumber; line <= lastLine; line += 1) lines.push(model.getLineContent(line));
    const joined = lines.reduce((acc, line, i) => {
      if (i === 0) return line;
      const trimmed = keepWhitespace ? line : line.trimStart();
      return acc + (keepWhitespace ? '' : ' ') + trimmed;
    }, '');
    this.editor.executeEdits('vim', [{ range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column), text: joined }]);
    this.setPosition(pos.lineNumber, Math.min(this.lineEndColumn(pos.lineNumber), pos.column));
  }

  /** `J` in visual mode — join selected lines. */
  private joinSelection(): void {
    if (!this.anchor) return;
    const active = this.editor.getPosition() ?? this.anchor;
    const first = Math.min(this.anchor.lineNumber, active.lineNumber);
    const last = Math.max(this.anchor.lineNumber, active.lineNumber);
    this.setPosition(first, 1);
    this.joinLines(last - first + 1, false);
    this.setMode('normal');
  }

  /** `~` — toggle case of count characters. */
  private toggleCase(count: number): void {
    const model = this.model();
    const pos = this.editor.getPosition();
    if (!model || !pos) return;
    const line = model.getLineContent(pos.lineNumber);
    const start = pos.column - 1;
    const end = Math.min(line.length, start + count);
    let text = '';
    for (let i = start; i < end; i += 1) {
      const ch = line[i] ?? '';
      text += ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase();
    }
    this.editor.executeEdits('vim', [{ range: new monaco.Range(pos.lineNumber, start + 1, pos.lineNumber, end + 1), text }]);
    this.setPosition(pos.lineNumber, Math.min(this.lineEndColumn(pos.lineNumber), start + count + 1));
  }

  /** `~` in visual mode — toggle case of the selection. */
  private toggleCaseSelection(): void {
    if (!this.anchor) return;
    const active = this.editor.getPosition() ?? this.anchor;
    const range = this.toRange(this.normalizeRange(this.anchor, active));
    const text = this.model()?.getValueInRange(range) ?? '';
    let toggled = '';
    for (const ch of text) toggled += ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase();
    this.editor.executeEdits('vim', [{ range, text: toggled }]);
    this.setMode('normal');
  }

  /** Ctrl+a / Ctrl+x — increment/decrement the number under the cursor. */
  private incrementNumber(direction: 1 | -1): void {
    const model = this.model();
    const pos = this.editor.getPosition();
    if (!model || !pos) return;
    const line = model.getLineContent(pos.lineNumber);
    const cursor = pos.column - 1;
    let start = cursor;
    while (start > 0 && /\d/.test(line[start - 1] ?? '')) start -= 1;
    let end = cursor;
    while (end < line.length && /\d/.test(line[end] ?? '')) end += 1;
    if (start === end && !/\d/.test(line[cursor] ?? '')) return;
    if (start === end) end = start + 1;
    const num = Number(line.slice(start, end));
    if (!Number.isFinite(num)) return;
    const next = String(num + direction);
    this.editor.executeEdits('vim', [{ range: new monaco.Range(pos.lineNumber, start + 1, pos.lineNumber, end + 1), text: next }]);
    this.setPosition(pos.lineNumber, start + next.length + 1);
  }

  /** `gcc` — toggle line comments on count lines. */
  private toggleCommentLines(count: number): void {
    const model = this.model();
    const pos = this.editor.getPosition();
    if (!model || !pos) return;
    const lastLine = Math.min(model.getLineCount(), pos.lineNumber + count - 1);
    const start = new monaco.Position(pos.lineNumber, 1);
    const end = new monaco.Position(lastLine, model.getLineMaxColumn(lastLine));
    this.editor.setSelection(new monaco.Selection(start.lineNumber, start.column, end.lineNumber, end.column));
    this.editor.trigger('vim', 'editor.action.commentLine', null);
    this.setPosition(pos.lineNumber, 1);
  }

  /** `gc` in visual mode — toggle comments on selection. */
  private toggleCommentSelection(): void {
    if (!this.anchor) return;
    const active = this.editor.getPosition() ?? this.anchor;
    const start = new monaco.Position(Math.min(this.anchor.lineNumber, active.lineNumber), 1);
    const end = new monaco.Position(Math.max(this.anchor.lineNumber, active.lineNumber), this.lineEndColumn(Math.max(this.anchor.lineNumber, active.lineNumber)));
    this.editor.setSelection(new monaco.Selection(start.lineNumber, start.column, end.lineNumber, end.column));
    this.editor.trigger('vim', 'editor.action.commentLine', null);
    this.setMode('normal');
  }

  /** `>>`/`<<` — indent/outdent count lines. */
  private indentLines(count: number, indent: boolean): void {
    const model = this.model();
    const pos = this.editor.getPosition();
    if (!model || !pos) return;
    const lastLine = Math.min(model.getLineCount(), pos.lineNumber + count - 1);
    const start = new monaco.Position(pos.lineNumber, 1);
    const end = new monaco.Position(lastLine, model.getLineMaxColumn(lastLine));
    this.editor.setSelection(new monaco.Selection(start.lineNumber, start.column, end.lineNumber, end.column));
    this.editor.trigger('vim', indent ? 'editor.action.indentLines' : 'editor.action.outdentLines', null);
    this.setPosition(pos.lineNumber, 1);
  }

  /** `>motion`/`<motion` — indent/outdent the motion range. */
  private indentRange(start: Position, end: Position, indent: boolean): void {
    this.editor.setSelection(new monaco.Selection(start.lineNumber, start.column, end.lineNumber, end.column));
    this.editor.trigger('vim', indent ? 'editor.action.indentLines' : 'editor.action.outdentLines', null);
    this.setPosition(start.lineNumber, start.column);
  }

  /** `==` — format count lines. */
  private formatLines(count: number): void {
    const model = this.model();
    const pos = this.editor.getPosition();
    if (!model || !pos) return;
    const lastLine = Math.min(model.getLineCount(), pos.lineNumber + count - 1);
    const start = new monaco.Position(pos.lineNumber, 1);
    const end = new monaco.Position(lastLine, model.getLineMaxColumn(lastLine));
    this.editor.setSelection(new monaco.Selection(start.lineNumber, start.column, end.lineNumber, end.column));
    this.editor.trigger('vim', 'editor.action.formatSelection', null);
    this.setPosition(pos.lineNumber, 1);
  }

  /** `=motion` — format the motion range. */
  private formatRange(start: Position, end: Position): void {
    this.editor.setSelection(new monaco.Selection(start.lineNumber, start.column, end.lineNumber, end.column));
    this.editor.trigger('vim', 'editor.action.formatSelection', null);
    this.setPosition(start.lineNumber, start.column);
  }

  /** `>`/`<`/`=` in visual mode — indent/outdent/format the selection. */
  private indentSelection(indent: boolean, format: boolean): void {
    if (!this.anchor) return;
    const active = this.editor.getPosition() ?? this.anchor;
    const start = new monaco.Position(Math.min(this.anchor.lineNumber, active.lineNumber), 1);
    const end = new monaco.Position(Math.max(this.anchor.lineNumber, active.lineNumber), this.lineEndColumn(Math.max(this.anchor.lineNumber, active.lineNumber)));
    this.editor.setSelection(new monaco.Selection(start.lineNumber, start.column, end.lineNumber, end.column));
    this.editor.trigger('vim', format ? 'editor.action.formatSelection' : (indent ? 'editor.action.indentLines' : 'editor.action.outdentLines'), null);
    this.setMode('normal');
  }

  /** `;`/`,` — repeat the last f/F/t/T in the same/opposite direction. */
  private repeatFind(forward: boolean): void {
    if (!this.lastFind) return;
    this.findCharacter(this.lastFind.char, forward ? this.lastFind.forward : !this.lastFind.forward, 1, this.lastFind.till);
  }

  /** `gv` — reselect the last visual selection. */
  private reselectVisual(): void {
    if (!this.lastVisual) return;
    this.setMode(this.lastVisual.mode);
    this.anchor = this.lastVisual.anchor;
    this.editor.setSelection(new monaco.Selection(this.lastVisual.anchor.lineNumber, this.lastVisual.anchor.column, this.lastVisual.active.lineNumber, this.lastVisual.active.column));
  }

  /** `gi` — return to the last insert position. */
  private gotoLastInsert(): void {
    if (!this.lastInsertPosition) return;
    this.setPosition(this.lastInsertPosition.lineNumber, this.lastInsertPosition.column);
    this.setMode('insert');
  }

  /** `.` — repeat the last change (operator + motion). */
  private repeatLastChange(): void {
    if (!this.lastChange) return;
    const { operator, motion, count } = this.lastChange;
    if (operator === 'd' || operator === 'y' || operator === 'c') {
      if (motion === 'd' || motion === 'y' || motion === 'c') {
        this.applyLineOperator(operator, count);
        return;
      }
      const range = this.motionRange(motion, count);
      if (range) this.applyOperator(operator, range.start, range.end);
    }
  }
}
