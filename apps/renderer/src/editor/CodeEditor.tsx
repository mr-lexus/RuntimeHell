import { useEffect, useRef, useState } from 'react';
import * as monaco from 'monaco-editor';
import type { AppSettings } from '@rh/protocol';
import { getSelectionInfo, type SelectionInfo } from './selection-service';
import { VimModeController, type VimMode, type PendingHint } from './vim-mode';

export type AnalyzeType = 'ast' | 'bytecode' | 'optcode' | 'ir-graph' | 'deopts' | 'gc';

export interface AnalyzeActionState {
  readonly type: AnalyzeType;
  readonly label: string;
  /** Capability probe verdict from the selected engine (todo 16/19). */
  readonly supported: boolean;
  readonly reason?: string;
}

export interface CodeEditorProps {
  path: string;
  value: string;
  language: string;
  onChange?: (value: string) => void;
  onSave?: (value: string) => void;
  onRun?: () => void;
  onFormatError?: (message: string) => void;
  onSelectionChanged?: (info: SelectionInfo | null) => void;
  /** Fires when editor scrolls; value is scrollTop in px. */
  onScrollTop?: (scrollTop: number) => void;
  /** Total line count of the current model (for the output column). */
  onLineCount?: (lineCount: number) => void;
  /** Context-menu Analyze actions; disabled entries render with tooltips. */
  onAnalyze?: (type: AnalyzeType, code: string, info: SelectionInfo | null) => void;
  analyzeActions?: readonly AnalyzeActionState[];
  inlineOutputs?: Record<number, { text: string; level: string }[]>;
  inlineResults?: Record<number, import('@rh/protocol').SerializedValue>;
  theme?: 'rh-dark' | 'rh-light';
  fontSize?: number;
  /** Monaco preferences controlled by the Settings > Editor tab. */
  editorSettings?: AppSettings['editor'];
  /** Opt-in modal Vim/Neovim-style keybindings. */
  vimMode?: boolean;
  /** Fired when the Vim mode changes (normal/insert/visual/visual-line). */
  onVimModeChange?: (mode: VimMode) => void;
  /** Fired when the user completes the `:help` command. */
  onVimHelp?: () => void;
  /** Fired when the `:` command-line buffer changes ('' when idle). */
  onVimCommandChange?: (command: string) => void;
  /** Fired when the `:` command line becomes active or inactive. */
  onVimCommandActive?: (active: boolean) => void;
}

let prettierWorker: Worker | null = null;
let formatSeq = 0;

function getPrettierWorker(): Worker {
  if (!prettierWorker) prettierWorker = new Worker(new URL('./prettier.worker.ts', import.meta.url), { type: 'module' });
  return prettierWorker;
}

function parserFor(language: string): 'babel' | 'typescript' | 'tsx' {
  if (language === 'typescript') return 'typescript';
  if (language === 'javascript' || language === 'jsx') return 'babel';
  return 'tsx';
}

const DEFAULT_EDITOR_SETTINGS: AppSettings['editor'] = {
  fontSize: 13,
  fontLigatures: true,
  tabSize: 2,
  insertSpaces: true,
  wordWrap: 'off',
  lineNumbers: 'on',
  minimap: false,
  folding: true,
  renderWhitespace: 'selection',
  bracketPairColorization: true,
  smoothScrolling: true,
  stickyScroll: false,
  cursorStyle: 'line',
  inlineInspector: true,
  vimMode: false
};

const VIM_MODE_LABELS: Record<VimMode, string> = {
  normal: 'NORMAL',
  insert: 'INSERT',
  visual: 'VISUAL',
  'visual-line': 'VISUAL LINE',
  replace: 'REPLACE'
};

export function CodeEditor(props: CodeEditorProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const capKeysRef = useRef<Map<AnalyzeType, monaco.editor.IContextKey<boolean>>>(new Map());
  const modelsRef = useRef<Map<string, monaco.editor.ITextModel>>(new Map());
  const propsRef = useRef(props);
  propsRef.current = props;
  const vimRef = useRef<VimModeController | null>(null);
  const commandInputRef = useRef<HTMLInputElement | null>(null);
  const [vimMode, setVimMode] = useState<VimMode>('normal');
  const [vimCommandActive, setVimCommandActive] = useState(false);
  const [vimCommandLine, setVimCommandLine] = useState('');
  const [vimPending, setVimPending] = useState<string | null>(null);
  const [vimPendingHints, setVimPendingHints] = useState<PendingHint[]>([]);

  useEffect(() => {
    if (!containerRef.current) return;
    const editorSettings = propsRef.current.editorSettings ?? DEFAULT_EDITOR_SETTINGS;
    const fontSize = propsRef.current.fontSize ?? editorSettings.fontSize;
    const editor = monaco.editor.create(containerRef.current, {
      value: propsRef.current.value,
      language: propsRef.current.language,
      theme: propsRef.current.theme ?? 'rh-dark',
      automaticLayout: true,
      minimap: { enabled: editorSettings.minimap },
      fontSize,
      lineHeight: Math.max(18, Math.round(fontSize * 1.5)),
      tabSize: editorSettings.tabSize,
      insertSpaces: editorSettings.insertSpaces,
      detectIndentation: false,
      wordWrap: editorSettings.wordWrap,
      lineNumbers: editorSettings.lineNumbers,
      folding: editorSettings.folding,
      renderWhitespace: editorSettings.renderWhitespace,
      fontFamily: "'JetBrainsMono Nerd Font Mono', 'Cascadia Mono', Consolas, monospace",
      fontLigatures: editorSettings.fontLigatures,
      bracketPairColorization: { enabled: editorSettings.bracketPairColorization },
      smoothScrolling: editorSettings.smoothScrolling,
      stickyScroll: { enabled: editorSettings.stickyScroll },
      cursorStyle: editorSettings.cursorStyle
    });
    editorRef.current = editor;

    // E2E/test hook.
    (window as unknown as Record<string, unknown>)['__rh_editor'] = {
      getValue: (): string => editor.getValue(),
      setValue: (v: string): void => editor.setValue(v),
      setLanguage: (l: string): void => monaco.editor.setModelLanguage(editor.getModel()!, l),
      setSelection: (startLine: number, startCol: number, endLine: number, endCol: number): void => {
        editor.setSelection({ startLineNumber: startLine, startColumn: startCol, endLineNumber: endLine, endColumn: endCol });
        editor.focus();
      },
      getSelectionInfo: (): SelectionInfo | null => {
        const sel = editor.getSelection();
        const model = editor.getModel();
        if (!sel || !model) return null;
        const text = model.getValueInRange(sel);
        if (!text) return null;
        return getSelectionInfo(model.getValue(), text, {
          startLine: sel.startLineNumber,
          startCol: sel.startColumn,
          endLine: sel.endLineNumber,
          endCol: sel.endColumn
        });
      },
      /** Drives the same path as the context-menu Analyze items (todo 19/22). */
      runAnalyze: (type: AnalyzeType): void => {
        const model = editor.getModel();
        const sel = editor.getSelection();
        let code = editor.getValue();
        let info: SelectionInfo | null = null;
        if (sel !== null && model !== null && !sel.isEmpty()) {
          code = model.getValueInRange(sel);
          info = getSelectionInfo(model.getValue(), code, {
            startLine: sel.startLineNumber,
            startCol: sel.startColumn,
            endLine: sel.endLineNumber,
            endCol: sel.endColumn
          });
        }
        propsRef.current.onAnalyze?.(type, code, info);
      }
    };

    editor.onDidChangeModelContent(() => {
      propsRef.current.onChange?.(editor.getValue());
    });

    // Expose scroll position for the line-aligned output column.
    editor.onDidScrollChange((e) => {
      // Monaco also emits this event for horizontal/layout changes. Only
      // publish vertical movement so the inline inspector follows the same
      // scroll surface without needless render churn.
      if (e.scrollTopChanged) propsRef.current.onScrollTop?.(e.scrollTop);
    });

    // Notify parent of line count whenever the model changes.
    const notifyLineCount = (): void => {
      const model = editor.getModel();
      if (model) propsRef.current.onLineCount?.(model.getLineCount());
    };
    editor.onDidChangeModelContent(() => notifyLineCount());
    // Initial notification after first model set.
    notifyLineCount();
    propsRef.current.onScrollTop?.(editor.getScrollTop());

    editor.onDidChangeCursorSelection(() => {
      const sel = editor.getSelection();
      const model = editor.getModel();
      if (!sel || !model) return;
      const text = model.getValueInRange(sel);
      propsRef.current.onSelectionChanged?.(
        text ? getSelectionInfo(model.getValue(), text, {
          startLine: sel.startLineNumber,
          startCol: sel.startColumn,
          endLine: sel.endLineNumber,
          endCol: sel.endColumn
        }) : null
      );
    });

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      propsRef.current.onSave?.(editor.getValue());
    });
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      propsRef.current.onRun?.();
    });
    editor.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.Enter, () => {
      propsRef.current.onRun?.();
    });

    // Analyze ▸ context-menu actions (todo 19). Capability gating uses
    // Monaco context keys so items render disabled with reason tooltips.
    const ANALYZE_TYPES: AnalyzeType[] = ['ast', 'bytecode', 'optcode', 'ir-graph', 'deopts', 'gc'];
    for (const type of ANALYZE_TYPES) {
      capKeysRef.current.set(type, editor.createContextKey(`rh.cap.${type}`, true));
      editor.addAction({
        id: `rh.analyze.${type}`,
        label: `Analyze ▸ ${type}`,
        contextMenuGroupId: '9_analyze',
        precondition: `rh.cap.${type}`,
        run: (ed) => {
          const model = ed.getModel();
          const sel = ed.getSelection();
          let code = ed.getValue() ?? '';
          let info: SelectionInfo | null = null;
          if (sel !== null && model !== null && !sel.isEmpty()) {
            code = model.getValueInRange(sel);
            info = getSelectionInfo(model.getValue(), code, {
              startLine: sel.startLineNumber,
              startCol: sel.startColumn,
              endLine: sel.endLineNumber,
              endCol: sel.endColumn
            });
          }
          propsRef.current.onAnalyze?.(type, code, info);
        }
      });
    }
    editor.addCommand(monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF, () => {
      const id = ++formatSeq;
      const req = { id, code: editor.getValue(), parser: parserFor(propsRef.current.language) };
      const worker = getPrettierWorker();
      const onMessage = (event: MessageEvent<{ id: number; ok: boolean; code?: string; error?: string }>): void => {
        if (event.data.id !== id) return;
        worker.removeEventListener('message', onMessage);
        if (event.data.ok && typeof event.data.code === 'string') {
          if (event.data.code !== editor.getValue()) {
            editor.executeEdits('prettier', [
              { range: editor.getModel()!.getFullModelRange(), text: event.data.code }
            ]);
          }
        } else {
          propsRef.current.onFormatError?.(event.data.error ?? 'format failed');
        }
      };
      worker.addEventListener('message', onMessage);
      worker.postMessage(req);
    });

    return () => {
      editor.dispose();
      editorRef.current = null;
      for (const m of modelsRef.current.values()) m.dispose();
      modelsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (props.theme) monaco.editor.setTheme(props.theme);
    const settings = props.editorSettings ?? DEFAULT_EDITOR_SETTINGS;
    const fontSize = props.fontSize ?? settings.fontSize;
    editor.updateOptions({
      fontSize,
      lineHeight: Math.max(18, Math.round(fontSize * 1.5)),
      fontLigatures: settings.fontLigatures,
      tabSize: settings.tabSize,
      insertSpaces: settings.insertSpaces,
      detectIndentation: false,
      wordWrap: settings.wordWrap,
      lineNumbers: settings.lineNumbers,
      minimap: { enabled: settings.minimap },
      folding: settings.folding,
      renderWhitespace: settings.renderWhitespace,
      bracketPairColorization: { enabled: settings.bracketPairColorization },
      smoothScrolling: settings.smoothScrolling,
      stickyScroll: { enabled: settings.stickyScroll },
      ...(props.vimMode ? {} : { cursorStyle: settings.cursorStyle })
    });
  }, [props.theme, props.fontSize, props.editorSettings, props.vimMode]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !props.vimMode) return;
    const vim = new VimModeController({
      editor,
      onModeChange: (mode) => {
        setVimMode(mode);
        propsRef.current.onVimModeChange?.(mode);
      },
      onHelp: propsRef.current.onVimHelp,
      onCommandChange: (command) => {
        setVimCommandLine(command);
        propsRef.current.onVimCommandChange?.(command);
      },
      onCommandActive: (active) => {
        setVimCommandActive(active);
        propsRef.current.onVimCommandActive?.(active);
      },
      onPendingChange: (pending, hints) => {
        setVimPending(pending);
        setVimPendingHints(hints);
      }
    });
    vimRef.current = vim;
    return () => {
      vim.dispose();
      vimRef.current = null;
      setVimMode('normal');
      setVimCommandActive(false);
      setVimCommandLine('');
      setVimPending(null);
      setVimPendingHints([]);
      propsRef.current.onVimModeChange?.('normal');
      propsRef.current.onVimCommandChange?.('');
    };
  }, [props.vimMode]);

  // Focus the `:` command-line input as soon as it appears.
  useEffect(() => {
    if (vimCommandActive) commandInputRef.current?.focus();
  }, [vimCommandActive]);

  // Tab switching: one Monaco model per file path; external content updates
  // (history restore, initial open) are pushed into the existing model.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    let model = modelsRef.current.get(props.path);
    if (!model || model.isDisposed()) {
      model = monaco.editor.createModel(props.value, props.language);
      modelsRef.current.set(props.path, model);
    }
    if (editor.getModel() !== model) {
      editor.setModel(model);
    } else if (model.getValue() !== props.value) {
      model.pushEditOperations([], [{ range: model.getFullModelRange(), text: props.value }], () => null);
    }
    if (model.getLanguageId() !== props.language) {
      monaco.editor.setModelLanguage(model, props.language);
    }
  }, [props.path, props.value, props.language]);

  // Reflect capability probe verdicts into the context-menu keys (todo 19).
  useEffect(() => {
    for (const action of props.analyzeActions ?? []) {
      capKeysRef.current.get(action.type)?.set(action.supported);
    }
  }, [props.analyzeActions]);

  // Inline glyph markers — lightweight overview-ruler + glyph margin indicators.
  // The actual text output lives in the LineOutputColumn; these are just
  // visual breadcrumbs on the editor scrollbar and gutter.
  const inlineDecorationsRef = useRef<string[]>([]);
  function formatSerialized(v: import('@rh/protocol').SerializedValue): string {
    if (v.t === 'string') return JSON.stringify(v.prim ?? '');
    if (v.t === 'number' || v.t === 'boolean' || v.t === 'null' || v.t === 'undefined' || v.t === 'bigint') return v.prim ?? v.t;
    if (v.label) return v.label + (v.prim ? ` ${v.prim}` : '');
    if (v.prim) return v.prim;
    return v.t;
  }
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    // Monaco's overview ruler consumes a concrete color value (it does not
    // resolve CSS custom properties). Read the active design token so the
    // source/result marker follows the selected theme and accent.
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#7ec8e3';
    const outputs = props.inlineOutputs ?? {};
    const results = props.inlineResults ?? {};
    const allLines = new Set<number>([...Object.keys(outputs).map(Number), ...Object.keys(results).map(Number)]);
    const newDecorations: monaco.editor.IModelDeltaDecoration[] = [];
    for (const line of allLines) {
      if (!Number.isFinite(line) || line < 1) continue;
      const consoleItems = outputs[line] ?? [];
      const resultVal = (results as Record<number, import('@rh/protocol').SerializedValue>)[line];
      const isError = consoleItems.some((it) => it.level === 'error');
      const isWarn = consoleItems.some((it) => it.level === 'warn');
      newDecorations.push({
        range: new monaco.Range(line, 1, line, 1),
        options: {
          overviewRuler: {
            color: isError ? '#f48771' : isWarn ? '#dcdcaa' : resultVal ? accent : '#6a9955',
            position: monaco.editor.OverviewRulerLane.Right
          },
          glyphMarginClassName: isError ? 'rh-glyph-error' : isWarn ? 'rh-glyph-warn' : resultVal ? 'rh-glyph-result' : 'rh-glyph-log'
        }
      });
    }
    inlineDecorationsRef.current = editor.deltaDecorations(inlineDecorationsRef.current, newDecorations);
    // Inject glyph styles once
    if (!document.getElementById('rh-inline-styles')) {
      const style = document.createElement('style');
      style.id = 'rh-inline-styles';
      style.textContent = `
        .rh-glyph-log { background: #6a9955; width: 4px !important; }
        .rh-glyph-warn { background: #dcdcaa; width: 4px !important; }
        .rh-glyph-error { background: #f48771; width: 4px !important; }
        .rh-glyph-result { background: var(--accent); width: 4px !important; }
      `;
      document.head.appendChild(style);
    }
  }, [props.inlineOutputs, props.inlineResults]);

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div ref={containerRef} style={{ flex: 1, minHeight: 0 }} />
      {props.vimMode && (
        <div className="rh-vim-statusline">
          <span className="rh-vim-mode">{vimCommandActive ? 'COMMAND' : VIM_MODE_LABELS[vimMode]}</span>
          {vimCommandActive && (
            <input
              ref={commandInputRef}
              className="rh-vim-commandline"
              value={vimCommandLine}
              onChange={(event) => vimRef.current?.setCommandLine(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  vimRef.current?.submitCommand(vimCommandLine);
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  vimRef.current?.cancelCommand();
                }
              }}
              placeholder=":"
              spellCheck={false}
              aria-label="Vim command line"
            />
          )}
          {vimPending !== null && vimPendingHints.length > 0 && (
            <div className="rh-vim-pending-hints" role="tooltip" aria-label={`Vim ${vimPending} key hints`}>
              <span className="rh-vim-pending-prefix">{vimPending}</span>
              <div className="rh-vim-pending-hints-grid">
                {vimPendingHints.map((hint) => (
                  <div key={`${vimPending}-${hint.key}`} className="rh-vim-pending-hint">
                    <kbd>{hint.key}</kbd>
                    <span>{hint.description}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
