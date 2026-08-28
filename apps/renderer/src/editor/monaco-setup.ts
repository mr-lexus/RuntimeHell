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
// Inline workers keep Electron's dev renderer from failing a cross-origin
// worker bootstrap and falling back to a blocking main-thread language service.
import editorWorker from '../../node_modules/monaco-editor/esm/vs/editor/editor.worker?worker&inline';
import tsWorker from '../../node_modules/monaco-editor/esm/vs/language/typescript/ts.worker?worker&inline';

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
    // Keep syntax emphasis in the same restrained cyan family as the
    // renderer accent instead of the unrelated VS Code blue fallback.
    { token: 'keyword', foreground: '7ec8e3' },
    { token: 'string', foreground: 'ce9178' }
  ],
  colors: {
    'editor.background': '#0a0a0a',
    'editor.foreground': '#dddddd',
    'editorGutter.background': '#0f0f0f',
    'editorLineNumber.foreground': '#888888',
    'editorLineNumber.activeForeground': '#dddddd',
    'editor.selectionBackground': '#242424',
    'editor.inactiveSelectionBackground': '#24242499',
    'editorWidget.background': '#111111',
    'editorWidget.border': '#333333',
    'editorSuggestWidget.background': '#181818',
    'editorSuggestWidget.border': '#333333',
    'editorSuggestWidget.selectedBackground': '#242424'
  }
});
monaco.editor.defineTheme('rh-light', {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '2d7d46', fontStyle: 'italic' },
    { token: 'keyword', foreground: '0e639c' }
  ],
  colors: {
    'editor.background': '#ffffff',
    'editor.foreground': '#1f1f1f',
    'editorGutter.background': '#f3f3f3',
    'editorLineNumber.foreground': '#8a8a8a',
    'editorLineNumber.activeForeground': '#1f1f1f',
    'editor.selectionBackground': '#d4d4d4',
    'editor.inactiveSelectionBackground': '#d4d4d499',
    'editorWidget.background': '#ffffff',
    'editorWidget.border': '#b8b8b8',
    'editorSuggestWidget.background': '#ffffff',
    'editorSuggestWidget.border': '#b8b8b8',
    'editorSuggestWidget.selectedBackground': '#d4d4d4'
  }
});

export type RhTheme = 'rh-dark' | 'rh-light';

function cssToken(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function monacoTokenColor(color: string, fallback: string): string {
  return /^#[0-9a-f]{6,8}$/i.test(color) ? color.slice(1) : fallback.replace('#', '');
}

/** Rebuild the Monaco palette from the active renderer tokens. Monaco's
 * canvas cannot consume CSS variables directly, so resolve them before the
 * theme is registered. */
function defineResolvedRhTheme(theme: RhTheme): void {
  const dark = theme === 'rh-dark';
  const fallback = dark
    ? { app: '#0a0a0a', shell: '#0f0f0f', panel: '#111111', raised: '#181818', selected: '#242424', text: '#dddddd', dim: '#888888', frame: '#333333', accent: '#7ec8e3' }
    : { app: '#ffffff', shell: '#f3f3f3', panel: '#ececec', raised: '#ffffff', selected: '#d4d4d4', text: '#1f1f1f', dim: '#616161', frame: '#b8b8b8', accent: '#0e639c' };
  const app = cssToken('--bg-app', fallback.app);
  const shell = cssToken('--bg-shell', fallback.shell);
  const panel = cssToken('--bg-panel', fallback.panel);
  const raised = cssToken('--bg-raised', fallback.raised);
  const selected = cssToken('--bg-selected', fallback.selected);
  const text = cssToken('--text', fallback.text);
  const dim = cssToken('--text-dim', fallback.dim);
  const frame = cssToken('--frame-normal', fallback.frame);
  const accent = cssToken('--accent', fallback.accent);
  monaco.editor.defineTheme(theme, {
    base: dark ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: dark ? '6a9955' : '2d7d46', fontStyle: 'italic' },
      { token: 'keyword', foreground: monacoTokenColor(accent, fallback.accent) },
      { token: 'string', foreground: dark ? 'ce9178' : 'a31515' }
    ],
    colors: {
      'editor.background': app,
      'editor.foreground': text,
      'editorGutter.background': shell,
      'editorLineNumber.foreground': dim,
      'editorLineNumber.activeForeground': text,
      'editor.selectionBackground': selected,
      'editor.inactiveSelectionBackground': `${selected}99`,
      'editorWidget.background': panel,
      'editorWidget.border': frame,
      'editorSuggestWidget.background': raised,
      'editorSuggestWidget.border': frame,
      'editorSuggestWidget.selectedBackground': selected
    }
  });
}

export function setRhTheme(theme: RhTheme): void {
  defineResolvedRhTheme(theme);
  monaco.editor.setTheme(theme);
}

export { monaco, typescriptDefaults };
