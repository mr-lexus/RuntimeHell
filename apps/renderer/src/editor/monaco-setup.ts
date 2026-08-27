/**
 * Monaco bootstrap: ESM workers via Vite `?worker` imports (plan evidence:
 * slidevjs/slidev pattern) + TypeScript defaults per plan todo 4.
 *
 * monaco-editor >= 0.56 moved the TS language service out of the deprecated
 * `monaco.languages.typescript` namespace into its register module.
 */
import * as monaco from 'monaco-editor';
// Direct relative import: monaco's exports map does not expose this subpath
// for TS resolution (verified against monaco-editor@0.56.0).
import {
  javascriptDefaults,
  JsxEmit,
  ModuleKind,
  ModuleResolutionKind,
  ScriptTarget,
  typescriptDefaults
} from '../../node_modules/monaco-editor/esm/vs/languages/features/typescript/register.js';
import editorWorker from '../../node_modules/monaco-editor/esm/vs/editor/editor.worker?worker';
import tsWorker from '../../node_modules/monaco-editor/esm/vs/language/typescript/ts.worker?worker';

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string): Worker {
    if (label === 'typescript' || label === 'javascript') return new tsWorker();
    return new editorWorker();
  }
};

typescriptDefaults.setCompilerOptions({
  target: ScriptTarget.ESNext,
  jsx: JsxEmit.Preserve,
  allowNonTsExtensions: true,
  allowJs: true,
  moduleResolution: ModuleResolutionKind.NodeJs,
  module: ModuleKind.ESNext,
  lib: ['esnext', 'dom']
});

typescriptDefaults.setDiagnosticsOptions({
  noSemanticValidation: false,
  noSyntaxValidation: false
});

// JS files get the same service (mixed TS+JS workspaces are first-class).
javascriptDefaults.setCompilerOptions({
  target: ScriptTarget.ESNext,
  allowNonTsExtensions: true,
  allowJs: true
});

/** Test/E2E hook: marker inspection without reaching into module scope. */
export function exposeMonacoForTests(): void {
  (window as unknown as Record<string, unknown>)['__rh_monaco'] = monaco;
}

// --- Themes (Wave 3): custom dark/light tuned for inline results ----------
monaco.editor.defineTheme('rh-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '6a9955', fontStyle: 'italic' },
    { token: 'keyword', foreground: '569cd6' },
    { token: 'string', foreground: 'ce9178' }
  ],
  colors: {
    'editor.background': '#1e1e1e',
    'editorGutter.background': '#1a1a1a',
    'editorLineNumber.foreground': '#555',
    'editorLineNumber.activeForeground': '#aaa'
  }
});
monaco.editor.defineTheme('rh-light', {
  base: 'vs',
  inherit: true,
  rules: [{ token: 'comment', foreground: '2d7d46', fontStyle: 'italic' }],
  colors: { 'editor.background': '#ffffff' }
});

export type RhTheme = 'rh-dark' | 'rh-light';
export function setRhTheme(theme: RhTheme): void {
  monaco.editor.setTheme(theme);
}

export { monaco, typescriptDefaults };
