import { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor';
import { getSelectionInfo, type SelectionInfo } from './selection-service';

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
  /** Context-menu Analyze actions; disabled entries render with tooltips. */
  onAnalyze?: (type: AnalyzeType, code: string, info: SelectionInfo | null) => void;
  analyzeActions?: readonly AnalyzeActionState[];
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

export function CodeEditor(props: CodeEditorProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const capKeysRef = useRef<Map<AnalyzeType, monaco.editor.IContextKey<boolean>>>(new Map());
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    if (!containerRef.current) return;
    const editor = monaco.editor.create(containerRef.current, {
      value: propsRef.current.value,
      language: propsRef.current.language,
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 13,
      tabSize: 2
    });
    editorRef.current = editor;

    // E2E/test hook.
    (window as unknown as Record<string, unknown>)['__rh_editor'] = {
      getValue: (): string => editor.getValue(),
      setValue: (v: string): void => editor.setValue(v),
      setLanguage: (l: string): void => monaco.editor.setModelLanguage(editor.getModel()!, l),
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
      }
    };

    editor.onDidChangeModelContent(() => {
      propsRef.current.onChange?.(editor.getValue());
    });

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
    };
  }, []);

  // Swap models when the open file changes.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const model = editor.getModel();
    if (model && model.getLanguageId() !== props.language) {
      monaco.editor.setModelLanguage(model, props.language);
    }
  }, [props.language]);

  // Reflect capability probe verdicts into the context-menu keys (todo 19).
  useEffect(() => {
    for (const action of props.analyzeActions ?? []) {
      capKeysRef.current.get(action.type)?.set(action.supported);
    }
  }, [props.analyzeActions]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}
