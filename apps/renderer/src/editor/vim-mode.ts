import * as monaco from 'monaco-editor';
import { initVimMode, VimMode as MonacoVimMode, type VimAdapterInstance } from 'monaco-vim';
import { getLazyVimHints, LAZYVIM_BINDINGS, type LazyVimAction, type VimContext } from './lazyvim-keymaps';

export type VimMode = 'normal' | 'insert' | 'visual' | 'visual-line' | 'visual-block' | 'replace';

export interface PendingHint {
  readonly key: string;
  readonly description: string;
}

interface VimModeOptions {
  readonly editor: monaco.editor.IStandaloneCodeEditor;
  readonly statusbarNode?: HTMLElement | null;
  readonly onModeChange?: (mode: VimMode) => void;
  readonly onHelp?: () => void;
  readonly onAction?: (action: LazyVimAction) => void;
  readonly onPendingChange?: (pending: string | null, hints: PendingHint[]) => void;
}

interface AdapterWithEditor extends VimAdapterInstance {
  readonly editor: monaco.editor.IStandaloneCodeEditor;
}

interface VimApi {
  defineAction(name: string, handler: (adapter: AdapterWithEditor) => void): void;
  defineEx(name: string, prefix: string, handler: (adapter: AdapterWithEditor) => void): void;
  map(lhs: string, rhs: string, context?: VimContext): void;
  unmap(lhs: string, context?: VimContext): boolean;
  handleKey(adapter: VimAdapterInstance, key: string, origin?: string): void;
  mapCommand(keys: string, type: 'action', name: string, args: Record<string, never>, extra: { context: VimContext }): void;
}

interface ControllerContext {
  readonly onAction?: (action: LazyVimAction) => void;
  readonly onHelp?: () => void;
}

const controllerByEditor = new WeakMap<monaco.editor.IStandaloneCodeEditor, ControllerContext>();
let profileRegistered = false;

const EDITOR_ACTIONS: Partial<Record<LazyVimAction, string>> = {
  'editor.moveLineDown': 'editor.action.moveLinesDownAction',
  'editor.moveLineUp': 'editor.action.moveLinesUpAction',
  'editor.hover': 'editor.action.showHover',
  'editor.definition': 'editor.action.revealDefinition',
  'editor.declaration': 'editor.action.revealDeclaration',
  'editor.implementation': 'editor.action.goToImplementation',
  'editor.typeDefinition': 'editor.action.goToTypeDefinition',
  'editor.references': 'editor.action.referenceSearch.trigger',
  'editor.signatureHelp': 'editor.action.triggerParameterHints',
  'editor.codeAction': 'editor.action.quickFix',
  'editor.rename': 'editor.action.rename',
  'diagnostic.open': 'editor.action.showHover',
  'ui.clearSearch': 'closeFindWidget'
};

function vimApi(): VimApi {
  return (MonacoVimMode as unknown as { Vim: VimApi }).Vim;
}

function navigateDiagnostic(
  editor: monaco.editor.IStandaloneCodeEditor,
  direction: -1 | 1,
  severity?: number
): void {
  const model = editor.getModel();
  const position = editor.getPosition();
  if (!model || !position) return;
  const currentOffset = model.getOffsetAt(position);
  const markers = monaco.editor.getModelMarkers({ resource: model.uri })
    .filter((marker) => severity === undefined || marker.severity === severity)
    .sort((a, b) => a.startLineNumber - b.startLineNumber || a.startColumn - b.startColumn);
  if (markers.length === 0) return;
  const target = direction > 0
    ? markers.find((marker) => model.getOffsetAt({ lineNumber: marker.startLineNumber, column: marker.startColumn }) > currentOffset) ?? markers[0]
    : [...markers].reverse().find((marker) => model.getOffsetAt({ lineNumber: marker.startLineNumber, column: marker.startColumn }) < currentOffset) ?? markers.at(-1);
  if (!target) return;
  const next = { lineNumber: target.startLineNumber, column: target.startColumn };
  editor.setPosition(next);
  editor.revealPositionInCenterIfOutsideViewport(next);
  editor.trigger('lazyvim', 'editor.action.showHover', null);
}

function dispatch(adapter: AdapterWithEditor, action: LazyVimAction): void {
  if (action === 'ui.clearSearch') {
    adapter.removeOverlay();
    return;
  }
  if (action === 'editor.commentBelow' || action === 'editor.commentAbove') {
    adapter.editor.trigger('lazyvim', action === 'editor.commentBelow' ? 'editor.action.insertLineAfter' : 'editor.action.insertLineBefore', null);
    adapter.editor.trigger('lazyvim', 'editor.action.commentLine', null);
    return;
  }
  const diagnostic = /^diagnostic\.(next|previous)(Error|Warning)?$/.exec(action);
  if (diagnostic) {
    const severity = diagnostic[2] === 'Error' ? monaco.MarkerSeverity.Error : diagnostic[2] === 'Warning' ? monaco.MarkerSeverity.Warning : undefined;
    navigateDiagnostic(adapter.editor, diagnostic[1] === 'next' ? 1 : -1, severity);
    return;
  }
  const editorAction = EDITOR_ACTIONS[action];
  if (editorAction !== undefined) {
    adapter.editor.trigger('lazyvim', editorAction, null);
    return;
  }
  const context = controllerByEditor.get(adapter.editor);
  if (action === 'app.help') context?.onHelp?.();
  else context?.onAction?.(action);
}

function registerLazyVimProfile(): void {
  if (profileRegistered) return;
  profileRegistered = true;
  const api = vimApi();
  // Vim maps Space to `l` by default. LazyVim promotes it to <leader>, so the
  // single-key mapping must be removed or it wins over every leader prefix.
  api.unmap('<Space>');

  for (const action of new Set(LAZYVIM_BINDINGS.flatMap((binding) => binding.action ?? []))) {
    const name = `runtimehell.${action}`;
    api.defineAction(name, (adapter) => {
      dispatch(adapter, action);
      if (action === 'file.save') api.handleKey(adapter, '<Esc>', 'mapping');
    });
  }

  for (const binding of LAZYVIM_BINDINGS) {
    if (binding.unavailableReason) continue;
    for (const mode of binding.modes) {
      if (binding.action !== undefined) {
        api.mapCommand(binding.keys, 'action', `runtimehell.${binding.action}`, {}, { context: mode });
      } else if (binding.toKeys !== undefined) {
        api.map(binding.keys, binding.toKeys, mode);
      }
    }
  }

  api.map('<', '<gv', 'visual');
  api.map('>', '>gv', 'visual');
  api.defineEx('help', 'h', (adapter) => controllerByEditor.get(adapter.editor)?.onHelp?.());
  api.defineEx('write', 'w', (adapter) => dispatch(adapter, 'file.save'));
  api.defineEx('bdelete', 'bd', (adapter) => dispatch(adapter, 'buffer.delete'));
  api.defineEx('quit', 'q', (adapter) => dispatch(adapter, 'buffer.delete'));
  api.defineEx('qall', 'qa', (adapter) => dispatch(adapter, 'app.quit'));
}

function toMode(event: { mode: string; subMode?: string }): VimMode {
  if (event.mode === 'visual') {
    if (event.subMode === 'linewise') return 'visual-line';
    if (event.subMode === 'blockwise') return 'visual-block';
    return 'visual';
  }
  if (event.mode === 'insert' || event.mode === 'replace') return event.mode;
  return 'normal';
}

/** Monaco lifecycle wrapper around the maintained CodeMirror Vim engine. */
export class VimModeController {
  private readonly adapter: VimAdapterInstance;
  private readonly editor: monaco.editor.IStandaloneCodeEditor;
  private readonly normalizerSubscription: monaco.IDisposable;
  private readonly onPendingChange?: VimModeOptions['onPendingChange'];
  private keyBuffer = '';
  private mode: VimMode = 'normal';
  private disposed = false;

  constructor({ editor, statusbarNode = null, onModeChange, onHelp, onAction, onPendingChange }: VimModeOptions) {
    registerLazyVimProfile();
    this.editor = editor;
    this.onPendingChange = onPendingChange;
    controllerByEditor.set(editor, { onAction, onHelp });
    // monaco-vim already uses physical key codes for letters, but falls back
    // to localized browser characters for punctuation. Normalize those keys
    // in non-insert modes so `:`, `/`, `[`, `]`, and leader sequences remain
    // usable on Cyrillic and other non-US keyboard layouts.
    this.normalizerSubscription = editor.onKeyDown((event) => this.normalizePunctuation(event));
    this.adapter = initVimMode(editor, statusbarNode);
    this.adapter.on('vim-mode-change', (event: { mode: string; subMode?: string }) => {
      this.mode = toMode(event);
      onModeChange?.(this.mode);
    });
    this.adapter.on('vim-keypress', (key: string) => this.handleKeypress(key));
    this.adapter.on('vim-command-done', () => this.clearPending());
    onModeChange?.('normal');
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    controllerByEditor.delete(this.editor);
    this.clearPending();
    this.normalizerSubscription.dispose();
    this.adapter.dispose();
  }

  private handleKeypress(key: string): void {
    if (key === '<Esc>') {
      this.clearPending();
      return;
    }
    this.keyBuffer += key;
    const hints = getLazyVimHints(this.keyBuffer);
    if (hints.length > 0) this.onPendingChange?.(this.keyBuffer.replaceAll('<Space>', 'Space '), hints);
  }

  private clearPending(): void {
    this.keyBuffer = '';
    this.onPendingChange?.(null, []);
  }

  private normalizePunctuation(event: monaco.IKeyboardEvent): void {
    if (event.browserEvent.code === 'Escape' && this.mode === 'normal') this.adapter.removeOverlay();
    if (this.mode === 'insert' || this.mode === 'replace' || event.ctrlKey || event.metaKey || event.altKey) return;
    const code = event.browserEvent.code;
    const plain: Record<string, string> = {
      Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Backquote: '`',
      Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Minus: '-', Equal: '='
    };
    const shifted: Record<string, string> = {
      Semicolon: ':', Quote: '"', BracketLeft: '{', BracketRight: '}', Backquote: '~',
      Comma: '<', Period: '>', Slash: '?', Backslash: '|', Minus: '_', Equal: '+'
    };
    const normalized = (event.shiftKey ? shifted : plain)[code];
    if (normalized === undefined || event.browserEvent.key === normalized) return;
    event.preventDefault();
    event.stopPropagation();
    vimApi().handleKey(this.adapter, normalized, 'keyboard');
  }
}

export type { LazyVimAction } from './lazyvim-keymaps';
