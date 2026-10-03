import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Monaco from 'monaco-editor';

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const actions = new Map<string, (adapter: { editor: unknown }) => void>();
  const adapter = {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => handlers.set(event, handler)),
    dispose: vi.fn()
  };
  return {
    handlers,
    actions,
    adapter,
    initVimMode: vi.fn(() => adapter),
    defineAction: vi.fn((name: string, handler: (adapter: { editor: unknown }) => void) => actions.set(name, handler)),
    defineEx: vi.fn(),
    map: vi.fn(),
    noremap: vi.fn(),
    unmap: vi.fn(() => true),
    mapCommand: vi.fn(),
    handleKey: vi.fn()
  };
});

vi.mock('monaco-vim', () => ({
  initVimMode: mocks.initVimMode,
  VimMode: {
    Vim: {
      defineAction: mocks.defineAction,
      defineEx: mocks.defineEx,
      map: mocks.map,
      noremap: mocks.noremap,
      unmap: mocks.unmap,
      mapCommand: mocks.mapCommand,
      handleKey: mocks.handleKey
    }
  }
}));

vi.mock('monaco-editor', () => ({
  MarkerSeverity: { Error: 8, Warning: 4 },
  editor: { getModelMarkers: vi.fn(() => []) }
}));

import { VimModeController } from './vim-mode';
import { getLazyVimHelpGroups, getLazyVimHints, LAZYVIM_BINDINGS } from './lazyvim-keymaps';

function createEditor(): Monaco.editor.IStandaloneCodeEditor {
  return { trigger: vi.fn(), onKeyDown: vi.fn(() => ({ dispose: vi.fn() })) } as unknown as Monaco.editor.IStandaloneCodeEditor;
}

describe('LazyVim keymap catalog', () => {
  it('contains the canonical buffer, file, code, diagnostics, UI and tab mappings', () => {
    const keys = new Set(LAZYVIM_BINDINGS.map((binding) => binding.keys));
    for (const key of ['H', 'L', '[b', ']b', '<Space>bd', '<C-s>', '<Space>fn', '<Space>cf', ']d', '[d', '<Space>uw', '<Space><Tab>d']) {
      expect(keys.has(key), `missing ${key}`).toBe(true);
    }
  });

  it('keeps unsupported Neovim-only surfaces explicit instead of registering no-ops', () => {
    const unavailable = LAZYVIM_BINDINGS.filter((binding) => binding.unavailableReason);
    expect(unavailable.map((binding) => binding.keys)).toEqual(expect.arrayContaining([
      '<C-h/j/k/l>', '<Space>-/|/wd/wm', '<Space>fT/ft · <C-/>', '<Space>gg/gG/gL/gb/gf/gl'
    ]));
    expect(getLazyVimHelpGroups().find((group) => group.title === 'Unavailable')?.items.length).toBeGreaterThan(0);
  });

  it('builds which-key hints from the same source of truth', () => {
    expect(getLazyVimHints('<Space>')).toEqual(expect.arrayContaining([
      { key: 'b', description: 'b…' },
      { key: 'f', description: 'f…' },
      { key: 'c', description: 'c…' },
      { key: 'u', description: 'u…' }
    ]));
    expect(getLazyVimHints('<Space>b')).toEqual(expect.arrayContaining([
      { key: 'd', description: 'Delete buffer' },
      { key: 'o', description: 'Delete other buffers' }
    ]));
  });
});

describe('VimModeController', () => {
  beforeEach(() => {
    mocks.handlers.clear();
    mocks.adapter.dispose.mockClear();
    mocks.initVimMode.mockClear();
  });

  it('initializes the mature Vim engine with the provided status bar and disposes it', () => {
    const editor = createEditor();
    const statusbar = {} as HTMLElement;
    const onModeChange = vi.fn();
    const controller = new VimModeController({ editor, statusbarNode: statusbar, onModeChange });

    expect(mocks.initVimMode).toHaveBeenCalledWith(editor, statusbar);
    expect(mocks.unmap).toHaveBeenCalledWith('<Space>');
    expect(onModeChange).toHaveBeenCalledWith('normal');

    mocks.handlers.get('vim-mode-change')?.({ mode: 'visual', subMode: 'linewise' });
    expect(onModeChange).toHaveBeenLastCalledWith('visual-line');
    mocks.handlers.get('vim-mode-change')?.({ mode: 'visual', subMode: 'blockwise' });
    expect(onModeChange).toHaveBeenLastCalledWith('visual-block');

    controller.dispose();
    controller.dispose();
    expect(mocks.adapter.dispose).toHaveBeenCalledOnce();
  });

  it('routes LazyVim actions to either Monaco or the workbench callback', () => {
    const editor = createEditor();
    const onAction = vi.fn();
    const controller = new VimModeController({ editor, onAction });
    const definitions = mocks.actions as Map<string, (adapter: { editor: typeof editor }) => void>;

    expect([...definitions.keys()]).toContain('runtimehell.editor.definition');
    definitions.get('runtimehell.editor.definition')?.({ editor });
    expect(editor.trigger).toHaveBeenCalledWith('lazyvim', 'editor.action.revealDefinition', null);

    definitions.get('runtimehell.buffer.next')?.({ editor });
    expect(onAction).toHaveBeenCalledWith('buffer.next');
    controller.dispose();
  });

  it('reports leader prefixes and clears them when a Vim command completes', () => {
    const onPendingChange = vi.fn();
    const controller = new VimModeController({ editor: createEditor(), onPendingChange });

    mocks.handlers.get('vim-keypress')?.('<Space>');
    expect(onPendingChange).toHaveBeenLastCalledWith('Space ', expect.arrayContaining([
      { key: 'b', description: 'b…' },
      { key: 'f', description: 'f…' }
    ]));

    mocks.handlers.get('vim-command-done')?.();
    expect(onPendingChange).toHaveBeenLastCalledWith(null, []);
    controller.dispose();
  });

  it('normalizes physical punctuation on a non-US keyboard layout', () => {
    let onKeyDown: ((event: Monaco.IKeyboardEvent) => void) | undefined;
    const editor = {
      trigger: vi.fn(),
      onKeyDown: vi.fn((handler: (event: Monaco.IKeyboardEvent) => void) => {
        onKeyDown = handler;
        return { dispose: vi.fn() };
      })
    } as unknown as Monaco.editor.IStandaloneCodeEditor;
    const controller = new VimModeController({ editor });
    const event = {
      browserEvent: { code: 'Semicolon', key: 'Ж' },
      shiftKey: true,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn()
    } as unknown as Monaco.IKeyboardEvent;

    onKeyDown?.(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(mocks.handleKey).toHaveBeenCalledWith(mocks.adapter, ':', 'keyboard');
    controller.dispose();
  });
});
