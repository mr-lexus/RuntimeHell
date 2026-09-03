import { describe, expect, it, vi } from 'vitest';
import type * as Monaco from 'monaco-editor';

vi.mock('monaco-editor', () => ({
  Position: class Position {
    constructor(public lineNumber: number, public column: number) {}
  },
  Range: class Range {
    constructor(
      public startLineNumber: number,
      public startColumn: number,
      public endLineNumber: number,
      public endColumn: number
    ) {}
  },
  Selection: class Selection {
    constructor(
      public selectionStartLineNumber: number,
      public selectionStartColumn: number,
      public positionLineNumber: number,
      public positionColumn: number
    ) {}
  }
}));

import { VimModeController } from './vim-mode';

interface TestKeyboardEvent {
  browserEvent: { key: string; code?: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean };
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  preventDefault: ReturnType<typeof vi.fn>;
  stopPropagation: ReturnType<typeof vi.fn>;
}

function keyboardEvent(key: string, options: { ctrlKey?: boolean; shiftKey?: boolean; code?: string } = {}): TestKeyboardEvent {
  const ctrlKey = options.ctrlKey ?? false;
  const shiftKey = options.shiftKey ?? false;
  return {
    browserEvent: {
      key,
      ...(options.code !== undefined ? { code: options.code } : {}),
      ctrlKey,
      shiftKey,
      altKey: false,
      metaKey: false
    },
    ctrlKey,
    shiftKey,
    altKey: false,
    metaKey: false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn()
  };
}

/** Editor fake with a real-ish model so motions and clampPosition behave. */
function createEditor(initialPosition = { lineNumber: 2, column: 5 }, content = 'const foo = 1;\nconst bar = 2;\nconst baz = 3;') {
  let position = initialPosition;
  const lines = content.split('\n');
  const dispose = vi.fn();
  const setPosition = vi.fn((next: { lineNumber: number; column: number }) => { position = next; });
  const updateOptions = vi.fn();
  const model = {
    getLineCount: () => lines.length,
    getLineMaxColumn: (line: number) => (lines[line - 1] ?? '').length + 1,
    getLineContent: (line: number) => lines[line - 1] ?? '',
    getValue: () => content,
    getValueLength: () => content.length,
    getOffsetAt: (pos: { lineNumber: number; column: number }) => {
      let offset = 0;
      for (let i = 1; i < pos.lineNumber; i += 1) offset += (lines[i - 1] ?? '').length + 1;
      return offset + pos.column - 1;
    },
    getPositionAt: (offset: number) => {
      let remaining = offset;
      for (let i = 0; i < lines.length; i += 1) {
        const len = (lines[i] ?? '').length + 1;
        if (remaining < len) return { lineNumber: i + 1, column: remaining + 1 };
        remaining -= len;
      }
      return { lineNumber: lines.length, column: (lines[lines.length - 1] ?? '').length + 1 };
    },
    getValueInRange: (range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }) => {
      const start = model.getOffsetAt({ lineNumber: range.startLineNumber, column: range.startColumn });
      const end = model.getOffsetAt({ lineNumber: range.endLineNumber, column: range.endColumn });
      return content.slice(start, end);
    }
  };
  let onKeyDown: ((event: TestKeyboardEvent) => void) | undefined;
  let scrollTop = 0;
  const editor = {
    onKeyDown: vi.fn((listener: (event: TestKeyboardEvent) => void) => {
      onKeyDown = listener;
      return { dispose };
    }),
    updateOptions,
    getPosition: vi.fn(() => position),
    setPosition,
    getModel: vi.fn(() => model),
    setSelection: vi.fn(),
    revealPositionInCenterIfOutsideViewport: vi.fn(),
    revealLineNearTop: vi.fn(),
    revealPositionInCenter: vi.fn(),
    getVisibleRanges: vi.fn(() => [{ startLineNumber: 1, endLineNumber: lines.length }]),
    getScrollTop: vi.fn(() => scrollTop),
    setScrollTop: vi.fn((v: number) => { scrollTop = v; }),
    trigger: vi.fn(),
    executeEdits: vi.fn(),
    focus: vi.fn()
  } as unknown as Monaco.editor.IStandaloneCodeEditor;
  return { editor, fire: (event: TestKeyboardEvent) => onKeyDown?.(event), setPosition, updateOptions, model };
}

describe('VimModeController', () => {
  it('handles keys through Monaco and disposes the Monaco subscription', () => {
    let onKeyDown: ((event: TestKeyboardEvent) => void) | undefined;
    const dispose = vi.fn();
    const updateOptions = vi.fn();
    const setPosition = vi.fn();
    const editor = {
      onKeyDown: vi.fn((listener: (event: TestKeyboardEvent) => void) => {
        onKeyDown = listener;
        return { dispose };
      }),
      updateOptions,
      getPosition: vi.fn(() => ({ lineNumber: 1, column: 2 })),
      setPosition
    } as unknown as Monaco.editor.IStandaloneCodeEditor;

    const controller = new VimModeController({ editor });
    expect(updateOptions).toHaveBeenLastCalledWith({ cursorStyle: 'block', cursorBlinking: 'solid' });

    const insert = keyboardEvent('i');
    onKeyDown?.(insert);
    expect(insert.preventDefault).toHaveBeenCalledOnce();
    expect(insert.stopPropagation).toHaveBeenCalledOnce();
    expect(updateOptions).toHaveBeenLastCalledWith({ cursorStyle: 'line', cursorBlinking: 'blink' });

    const escape = keyboardEvent('Escape');
    onKeyDown?.(escape);
    expect(escape.preventDefault).toHaveBeenCalledOnce();
    expect(setPosition).toHaveBeenCalledWith({ lineNumber: 1, column: 1 });
    expect(updateOptions).toHaveBeenLastCalledWith({ cursorStyle: 'block', cursorBlinking: 'solid' });

    controller.dispose();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('maps physical keys to US layout so hjkl work on a Russian layout', () => {
    const { editor, fire, setPosition } = createEditor({ lineNumber: 2, column: 5 });
    const controller = new VimModeController({ editor });

    const h = keyboardEvent('р', { code: 'KeyH' });
    fire(h);
    expect(h.preventDefault).toHaveBeenCalledOnce();
    expect(setPosition).toHaveBeenLastCalledWith({ lineNumber: 2, column: 4 });

    const j = keyboardEvent('о', { code: 'KeyJ' });
    fire(j);
    expect(setPosition).toHaveBeenLastCalledWith({ lineNumber: 3, column: 4 });

    const k = keyboardEvent('л', { code: 'KeyK' });
    fire(k);
    expect(setPosition).toHaveBeenLastCalledWith({ lineNumber: 2, column: 4 });

    const l = keyboardEvent('д', { code: 'KeyL' });
    fire(l);
    expect(setPosition).toHaveBeenLastCalledWith({ lineNumber: 2, column: 5 });

    controller.dispose();
  });

  it('enters insert mode via the Russian layout i key', () => {
    const { editor, fire, updateOptions } = createEditor();
    const controller = new VimModeController({ editor });

    const i = keyboardEvent('ш', { code: 'KeyI' });
    fire(i);
    expect(i.preventDefault).toHaveBeenCalledOnce();
    expect(updateOptions).toHaveBeenLastCalledWith({ cursorStyle: 'line', cursorBlinking: 'blink' });

    controller.dispose();
  });

  it('performs word motion via the Russian layout w key', () => {
    const { editor, fire, setPosition } = createEditor({ lineNumber: 1, column: 1 });
    const controller = new VimModeController({ editor });

    const w = keyboardEvent('ц', { code: 'KeyW' });
    fire(w);
    expect(w.preventDefault).toHaveBeenCalledOnce();
    // 'const foo = 1;' — w from offset 0 lands at the start of 'foo' (column 7)
    expect(setPosition).toHaveBeenLastCalledWith({ lineNumber: 1, column: 7 });

    controller.dispose();
  });

  it('runs :help via Russian layout Shift+; and fires onHelp', () => {
    const { editor, fire } = createEditor();
    const onHelp = vi.fn();
    const onCommandChange = vi.fn();
    const controller = new VimModeController({ editor, onHelp, onCommandChange });

    fire(keyboardEvent('Ж', { code: 'Semicolon', shiftKey: true }));
    expect(onCommandChange).toHaveBeenLastCalledWith('');

    // 'help' typed on a Russian layout: physical H/E/L/P → р/у/д/з
    fire(keyboardEvent('р', { code: 'KeyH' }));
    fire(keyboardEvent('у', { code: 'KeyE' }));
    fire(keyboardEvent('д', { code: 'KeyL' }));
    fire(keyboardEvent('з', { code: 'KeyP' }));
    expect(onCommandChange).toHaveBeenLastCalledWith('help');

    fire(keyboardEvent('Enter'));
    expect(onHelp).toHaveBeenCalledOnce();
    expect(onCommandChange).toHaveBeenLastCalledWith('');

    controller.dispose();
  });

  it('cancels :help with Escape without firing onHelp', () => {
    const { editor, fire } = createEditor();
    const onHelp = vi.fn();
    const controller = new VimModeController({ editor, onHelp });

    fire(keyboardEvent('Ж', { code: 'Semicolon', shiftKey: true }));
    fire(keyboardEvent('р', { code: 'KeyH' }));
    fire(keyboardEvent('Escape'));
    expect(onHelp).not.toHaveBeenCalled();

    controller.dispose();
  });

  it('lets real characters pass through in insert mode on any layout', () => {
    const { editor, fire } = createEditor();
    const controller = new VimModeController({ editor });

    fire(keyboardEvent('ш', { code: 'KeyI' })); // enter insert mode
    const cyrillic = keyboardEvent('ф', { code: 'KeyA' });
    fire(cyrillic);
    expect(cyrillic.preventDefault).not.toHaveBeenCalled();
    expect(cyrillic.stopPropagation).not.toHaveBeenCalled();

    controller.dispose();
  });

  it('exits insert mode via Ctrl+[ using the physical code', () => {
    const { editor, fire, setPosition, updateOptions } = createEditor({ lineNumber: 1, column: 2 });
    const controller = new VimModeController({ editor });

    fire(keyboardEvent('ш', { code: 'KeyI' })); // enter insert mode
    const ctrlBracket = keyboardEvent('[', { code: 'BracketLeft', ctrlKey: true });
    fire(ctrlBracket);
    expect(ctrlBracket.preventDefault).toHaveBeenCalledOnce();
    expect(setPosition).toHaveBeenLastCalledWith({ lineNumber: 1, column: 1 });
    expect(updateOptions).toHaveBeenLastCalledWith({ cursorStyle: 'block', cursorBlinking: 'solid' });

    controller.dispose();
  });

  it('fires onCommandActive when the : command line opens and closes', () => {
    const { editor, fire } = createEditor();
    const onCommandActive = vi.fn();
    const controller = new VimModeController({ editor, onCommandActive });

    fire(keyboardEvent('Ж', { code: 'Semicolon', shiftKey: true }));
    expect(onCommandActive).toHaveBeenLastCalledWith(true);

    fire(keyboardEvent('Escape'));
    expect(onCommandActive).toHaveBeenLastCalledWith(false);

    controller.dispose();
  });

  it('submits the command line via submitCommand and fires onHelp for help', () => {
    const { editor, fire } = createEditor();
    const onHelp = vi.fn();
    const onCommandChange = vi.fn();
    const onCommandActive = vi.fn();
    const controller = new VimModeController({ editor, onHelp, onCommandChange, onCommandActive });

    fire(keyboardEvent('Ж', { code: 'Semicolon', shiftKey: true }));
    controller.setCommandLine('help');
    expect(onCommandChange).toHaveBeenLastCalledWith('help');

    controller.submitCommand('help');
    expect(onHelp).toHaveBeenCalledOnce();
    expect(onCommandChange).toHaveBeenLastCalledWith('');
    expect(onCommandActive).toHaveBeenLastCalledWith(false);
    expect(editor.focus).toHaveBeenCalledOnce();

    controller.dispose();
  });

  it('cancels the command line via cancelCommand without firing onHelp', () => {
    const { editor, fire } = createEditor();
    const onHelp = vi.fn();
    const onCommandActive = vi.fn();
    const controller = new VimModeController({ editor, onHelp, onCommandActive });

    fire(keyboardEvent('Ж', { code: 'Semicolon', shiftKey: true }));
    controller.cancelCommand();
    expect(onHelp).not.toHaveBeenCalled();
    expect(onCommandActive).toHaveBeenLastCalledWith(false);
    expect(editor.focus).toHaveBeenCalledOnce();

    controller.dispose();
  });

  it('moves between paragraphs with } and {', () => {
    const content = 'line one\nline two\n\nline three\n\nline four';
    const { editor, fire, setPosition } = createEditor({ lineNumber: 1, column: 1 }, content);
    const controller = new VimModeController({ editor });

    fire(keyboardEvent('}', { code: 'BracketRight', shiftKey: true }));
    // From line 1, } skips to the first non-blank line after the blank line (line 4)
    expect(setPosition).toHaveBeenLastCalledWith({ lineNumber: 4, column: 1 });

    fire(keyboardEvent('{', { code: 'BracketLeft', shiftKey: true }));
    // From line 4, { moves back to the previous paragraph start (line 1)
    expect(setPosition).toHaveBeenLastCalledWith({ lineNumber: 1, column: 1 });

    controller.dispose();
  });

  it('toggles folds with za via the editor.toggleFold action', () => {
    const { editor, fire } = createEditor();
    const controller = new VimModeController({ editor });

    fire(keyboardEvent('z'));
    fire(keyboardEvent('a'));
    expect(editor.trigger).toHaveBeenCalledWith('vim', 'editor.toggleFold', null);

    controller.dispose();
  });

  it('folds all with zR and unfolds all with zM', () => {
    const { editor, fire } = createEditor();
    const controller = new VimModeController({ editor });

    fire(keyboardEvent('z'));
    fire(keyboardEvent('R'));
    expect(editor.trigger).toHaveBeenCalledWith('vim', 'editor.foldAll', null);

    fire(keyboardEvent('z'));
    fire(keyboardEvent('M'));
    expect(editor.trigger).toHaveBeenCalledWith('vim', 'editor.unfoldAll', null);

    controller.dispose();
  });

  it('toggles line comments with gcc via the commentLine action', () => {
    const { editor, fire } = createEditor();
    const controller = new VimModeController({ editor });

    fire(keyboardEvent('g'));
    fire(keyboardEvent('c'));
    fire(keyboardEvent('c'));
    expect(editor.trigger).toHaveBeenCalledWith('vim', 'editor.action.commentLine', null);

    controller.dispose();
  });

  it('joins lines with J', () => {
    const content = 'alpha\nbeta\ngamma';
    const { editor, fire, setPosition } = createEditor({ lineNumber: 1, column: 1 }, content);
    const controller = new VimModeController({ editor });

    fire(keyboardEvent('J'));
    expect(editor.executeEdits).toHaveBeenCalledWith('vim', [
      { range: { startLineNumber: 1, startColumn: 1, endLineNumber: 2, endColumn: 5 }, text: 'alpha beta' }
    ]);

    controller.dispose();
  });

  it('toggles case with ~', () => {
    const content = 'abc';
    const { editor, fire, setPosition } = createEditor({ lineNumber: 1, column: 1 }, content);
    const controller = new VimModeController({ editor });

    fire(keyboardEvent('~', { code: 'Backquote', shiftKey: true }));
    expect(editor.executeEdits).toHaveBeenCalledWith('vim', [
      { range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 2 }, text: 'A' }
    ]);

    controller.dispose();
  });

  it('deletes a character with X (backward)', () => {
    const content = 'abc';
    const { editor, fire } = createEditor({ lineNumber: 1, column: 2 }, content);
    const controller = new VimModeController({ editor });

    fire(keyboardEvent('X'));
    expect(editor.executeEdits).toHaveBeenCalledWith('vim', [
      { range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 2 }, text: '' }
    ]);

    controller.dispose();
  });

  it('enters replace mode with R and replaces characters', () => {
    const content = 'abc';
    const { editor, fire, updateOptions } = createEditor({ lineNumber: 1, column: 1 }, content);
    const controller = new VimModeController({ editor });

    fire(keyboardEvent('R'));
    expect(updateOptions).toHaveBeenLastCalledWith({ cursorStyle: 'block', cursorBlinking: 'solid' });

    fire(keyboardEvent('x'));
    expect(editor.executeEdits).toHaveBeenCalledWith('vim', [
      { range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 2 }, text: 'x' }
    ]);

    controller.dispose();
  });

  it('increments a number with Ctrl+a', () => {
    const content = 'value 5';
    const { editor, fire } = createEditor({ lineNumber: 1, column: 7 }, content);
    const controller = new VimModeController({ editor });

    fire(keyboardEvent('a', { ctrlKey: true }));
    expect(editor.executeEdits).toHaveBeenCalledWith('vim', [
      { range: { startLineNumber: 1, startColumn: 7, endLineNumber: 1, endColumn: 8 }, text: '6' }
    ]);

    controller.dispose();
  });

  it('indents lines with >> via the indentLines action', () => {
    const { editor, fire } = createEditor();
    const controller = new VimModeController({ editor });

    fire(keyboardEvent('>', { code: 'Period', shiftKey: true }));
    fire(keyboardEvent('>', { code: 'Period', shiftKey: true }));
    expect(editor.trigger).toHaveBeenCalledWith('vim', 'editor.action.indentLines', null);

    controller.dispose();
  });

  it('formats lines with == via the formatSelection action', () => {
    const { editor, fire } = createEditor();
    const controller = new VimModeController({ editor });

    fire(keyboardEvent('=', { code: 'Equal' }));
    fire(keyboardEvent('=', { code: 'Equal' }));
    expect(editor.trigger).toHaveBeenCalledWith('vim', 'editor.action.formatSelection', null);

    controller.dispose();
  });

  it('searches for the word under the cursor with * and repeats with n', () => {
    const content = 'foo bar foo';
    const { editor, fire, setPosition } = createEditor({ lineNumber: 1, column: 1 }, content);
    const controller = new VimModeController({ editor });

    fire(keyboardEvent('*', { code: 'Digit8', shiftKey: true }));
    expect(editor.setSelection).toHaveBeenCalled();

    controller.dispose();
  });

  it('moves to the top/middle/bottom of the screen with H/M/L', () => {
    const content = 'a\nb\nc\nd\ne';
    const { editor, fire, setPosition } = createEditor({ lineNumber: 3, column: 1 }, content);
    const controller = new VimModeController({ editor });

    fire(keyboardEvent('H'));
    expect(setPosition).toHaveBeenLastCalledWith({ lineNumber: 1, column: 1 });

    fire(keyboardEvent('M'));
    expect(setPosition).toHaveBeenLastCalledWith({ lineNumber: 3, column: 1 });

    fire(keyboardEvent('L'));
    expect(setPosition).toHaveBeenLastCalledWith({ lineNumber: 5, column: 1 });

    controller.dispose();
  });

  it('repeats the last f find with ;', () => {
    const content = 'a b c b d';
    const { editor, fire, setPosition } = createEditor({ lineNumber: 1, column: 1 }, content);
    const controller = new VimModeController({ editor });

    fire(keyboardEvent('f'));
    fire(keyboardEvent('b'));
    expect(setPosition).toHaveBeenLastCalledWith({ lineNumber: 1, column: 3 });

    fire(keyboardEvent(';'));
    expect(setPosition).toHaveBeenLastCalledWith({ lineNumber: 1, column: 7 });

    controller.dispose();
  });

  it('reselects the last visual selection with gv', () => {
    const { editor, fire, setPosition } = createEditor({ lineNumber: 1, column: 1 });
    const controller = new VimModeController({ editor });

    fire(keyboardEvent('v'));
    fire(keyboardEvent('l'));
    fire(keyboardEvent('Escape'));
    fire(keyboardEvent('g'));
    fire(keyboardEvent('v'));
    expect(editor.setSelection).toHaveBeenCalled();

    controller.dispose();
  });

  it('returns to the last insert position with gi', () => {
    const { editor, fire, setPosition, updateOptions } = createEditor({ lineNumber: 1, column: 1 });
    const controller = new VimModeController({ editor });

    fire(keyboardEvent('i'));
    fire(keyboardEvent('Escape'));
    fire(keyboardEvent('g'));
    fire(keyboardEvent('i'));
    expect(updateOptions).toHaveBeenLastCalledWith({ cursorStyle: 'line', cursorBlinking: 'blink' });

    controller.dispose();
  });

  it('fires onPendingChange with hints when a multi-key sequence starts', () => {
    const { editor, fire } = createEditor();
    const onPendingChange = vi.fn();
    const controller = new VimModeController({ editor, onPendingChange });

    // Pressing 'y' starts an operator-pending sequence.
    fire(keyboardEvent('y'));
    expect(onPendingChange).toHaveBeenLastCalledWith('y', [
      { key: 'y', description: 'Yank line' },
      { key: 'i', description: 'Yank inside' },
      { key: 'motion', description: 'Yank to motion' }
    ]);

    // Pressing 'y' again resolves the sequence and clears the hints.
    fire(keyboardEvent('y'));
    expect(onPendingChange).toHaveBeenLastCalledWith(null, []);

    controller.dispose();
  });

  it('fires onPendingChange for the g prefix with its hints', () => {
    const { editor, fire } = createEditor();
    const onPendingChange = vi.fn();
    const controller = new VimModeController({ editor, onPendingChange });

    fire(keyboardEvent('g'));
    expect(onPendingChange).toHaveBeenLastCalledWith('g', expect.arrayContaining([
      { key: 'g', description: 'Go to first line' },
      { key: 'c', description: 'Toggle comment' }
    ]));

    controller.dispose();
  });

  it('clears pending hints when the sequence is cancelled with Escape', () => {
    const { editor, fire } = createEditor();
    const onPendingChange = vi.fn();
    const controller = new VimModeController({ editor, onPendingChange });

    fire(keyboardEvent('y'));
    expect(onPendingChange).toHaveBeenLastCalledWith('y', expect.any(Array));

    fire(keyboardEvent('Escape'));
    expect(onPendingChange).toHaveBeenLastCalledWith(null, []);

    controller.dispose();
  });
});