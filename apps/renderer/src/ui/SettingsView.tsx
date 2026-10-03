import { useState, type ReactNode } from 'react';
import type { AppSettings, SettingsPatch, ThemeMode } from '@rh/protocol';
import { Button, TextInput } from './primitives';
import { Icon, type IconName } from './Icon';
import { WorkspaceLayoutControls } from './WorkspaceLayoutControls';
import { primaryShortcut } from '../platform-ui';
import { useSettings } from '../state/settings';

interface SettingsViewProps {
  settings: AppSettings;
  onPatch: (patch: SettingsPatch) => void;
  onResetAppearance: () => void;
  onResetEditor: () => void;
  onResetAll: () => void;
  onClose: () => void;
}

const CATEGORIES = [
  { id: 'workspace', label: 'Workspace', icon: 'layout', detail: 'Layout, panels and focus' },
  { id: 'appearance', label: 'Appearance', icon: 'eye', detail: 'Colors, density and motion' },
  { id: 'editor', label: 'Editor', icon: 'code', detail: 'Text, navigation and Vim' },
  { id: 'execution', label: 'Execution', icon: 'play', detail: 'Runtimes and package safety' },
  { id: 'shortcuts', label: 'Keyboard', icon: 'console', detail: 'Get around without the mouse' }
] as const satisfies readonly { id: string; label: string; icon: IconName; detail: string }[];
type Category = (typeof CATEGORIES)[number]['id'];

const THEMES: readonly { value: ThemeMode; label: string; color: string }[] = [
  { value: 'system', label: 'System', color: 'linear-gradient(135deg, #15171c 50%, #f5f6f8 50%)' },
  { value: 'dark', label: 'Obsidian', color: '#202228' }, { value: 'light', label: 'Cloud', color: '#f5f6f8' },
  { value: 'midnight', label: 'Midnight', color: '#101a31' }, { value: 'forest', label: 'Forest', color: '#193126' },
  { value: 'amethyst', label: 'Amethyst', color: '#29203d' }, { value: 'cinder', label: 'Cinder', color: '#38251d' },
  { value: 'paper', label: 'Paper', color: '#fbf7ed' }, { value: 'arctic', label: 'Arctic', color: '#d9edf9' },
  { value: 'sage', label: 'Sage', color: '#dcebdc' }, { value: 'rose', label: 'Rose', color: '#f4e1e7' },
  { value: 'solarized', label: 'Solarized', color: '#fdf6e3' }
];
const ACCENTS = [ ['cyan', '#7ec8e3'], ['amber', '#d7aa58'], ['silver', '#a8bbc4'], ['violet', '#8b7cff'], ['magenta', '#d65db1'], ['green', '#54b37a'], ['orange', '#e0793f'], ['ruby', '#d95767'] ] as const;
interface SettingItem { label: string; description?: string; keywords?: string; wide?: boolean; control: ReactNode; }

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }): React.JSX.Element {
  return <button type="button" role="switch" aria-label={label} aria-checked={checked} className={`rh-switch${checked ? ' is-on' : ''}`} onClick={() => onChange(!checked)}><span /></button>;
}

export function SettingsView({ settings, onPatch, onResetAppearance, onResetEditor, onResetAll, onClose }: SettingsViewProps): React.JSX.Element {
  const [category, setCategory] = useState<Category>('workspace');
  const [query, setQuery] = useState('');
  const [resetPending, setResetPending] = useState(false);
  const saveStatus = useSettings((state) => state.saveStatus);
  const saveError = useSettings((state) => state.saveError);
  const { appearance, editor, prefs } = settings;
  const setEditor = (patch: Partial<AppSettings['editor']>): void => onPatch({ editor: patch });
  const select = <T extends string | number,>(label: string, value: T, values: readonly (readonly [T, string])[], onChange: (value: T) => void): ReactNode =>
    <select className="rh-input" aria-label={label} value={value} onChange={(event) => onChange((typeof value === 'number' ? Number(event.target.value) : event.target.value) as T)}>{values.map(([key, title]) => <option key={key} value={key}>{title}</option>)}</select>;
  const editorToggle = (label: string, key: 'fontLigatures' | 'minimap' | 'folding' | 'smoothScrolling' | 'stickyScroll' | 'bracketPairColorization' | 'inlineInspector' | 'vimMode', description?: string): SettingItem =>
    ({ label, description, control: <Toggle label={label} checked={editor[key]} onChange={(value) => setEditor({ [key]: value })} /> });
  const sections: Record<Category, SettingItem[]> = {
    workspace: [
      { label: 'Your workspace', description: 'Presets never change your code or runtime settings.', keywords: 'layout panels bottom right console focus status line results code run analyze', wide: true, control: <WorkspaceLayoutControls settings={settings} onPatch={onPatch} /> }
    ],
    appearance: [
      { label: 'Theme', description: 'Choose a surface or follow your system.', wide: true, control: <div className="rh-theme-grid">{THEMES.map((theme) => <button type="button" key={theme.value} aria-pressed={appearance.theme === theme.value} onClick={() => onPatch({ appearance: { theme: theme.value } })}><i style={{ background: theme.color }} /><span>{theme.label}</span>{appearance.theme === theme.value && <Icon name="check" size={13} />}</button>)}</div> },
      { label: 'Accent color', control: <div className="rh-accent-swatches">{ACCENTS.map(([accent, color]) => <button key={accent} type="button" aria-label={`${accent} accent`} title={accent} aria-pressed={appearance.accent === accent} style={{ background: color }} onClick={() => onPatch({ appearance: { accent } })} />)}<input type="color" title="Custom accent color" aria-label="Custom accent color" value={appearance.accent.startsWith('#') ? appearance.accent : '#7ec8e3'} onChange={(event) => onPatch({ appearance: { accent: event.target.value } })} /></div> },
      { label: 'Interface density', description: 'Compact saves space; comfortable adds larger targets.', control: select('Interface density', appearance.density, [['compact', 'Compact'], ['comfortable', 'Comfortable']], (density) => onPatch({ appearance: { density } })) },
      { label: 'Interface scale', control: select('Interface scale', appearance.uiScale, [[90, '90%'], [100, '100%'], [110, '110%']], (uiScale) => onPatch({ appearance: { uiScale } })) },
      { label: 'Motion', control: select('Motion', appearance.motion, [['system', 'Follow system'], ['reduced', 'Reduced'], ['full', 'Full']], (motion) => onPatch({ appearance: { motion } })) },
      { label: 'Contrast intensity', control: select('Contrast intensity', appearance.intensity, [['low', 'Low'], ['standard', 'Standard'], ['high', 'High']], (intensity) => onPatch({ appearance: { intensity } })) }
    ],
    editor: [
      { label: 'Font size', description: 'Code font size in pixels.', control: <TextInput aria-label="Editor font size" type="number" min={10} max={32} value={editor.fontSize} onChange={(event) => setEditor({ fontSize: Math.min(32, Math.max(10, Number(event.target.value) || 13)) })} /> },
      editorToggle('Font ligatures', 'fontLigatures', 'Join common operators in JetBrains Mono.'),
      { label: 'Tab size', control: select('Tab size', editor.tabSize, Array.from({ length: 8 }, (_, index) => [index + 1, `${index + 1}`] as const), (tabSize) => setEditor({ tabSize })) },
      { label: 'Insert spaces', control: <Toggle label="Insert spaces" checked={editor.insertSpaces} onChange={(insertSpaces) => setEditor({ insertSpaces })} /> },
      { label: 'Word wrap', control: select('Word wrap', editor.wordWrap, [['off', 'Off'], ['on', 'On'], ['wordWrapColumn', 'At column'], ['bounded', 'Bounded']], (wordWrap) => setEditor({ wordWrap })) },
      { label: 'Line numbers', control: select('Line numbers', editor.lineNumbers, [['on', 'On'], ['off', 'Off'], ['relative', 'Relative']], (lineNumbers) => setEditor({ lineNumbers })) },
      editorToggle('Minimap', 'minimap', 'An overview of the file beside the scrollbar.'),
      editorToggle('Code folding', 'folding'), editorToggle('Smooth scrolling', 'smoothScrolling'), editorToggle('Sticky scroll', 'stickyScroll', 'Keep the current scope visible.'),
      { label: 'Whitespace', control: select('Render whitespace', editor.renderWhitespace, [['none', 'Hidden'], ['boundary', 'Boundary'], ['selection', 'Selection'], ['all', 'All']], (renderWhitespace) => setEditor({ renderWhitespace })) },
      { label: 'Cursor style', control: select('Cursor style', editor.cursorStyle, [['line', 'Line'], ['line-thin', 'Thin line'], ['block', 'Block'], ['block-outline', 'Block outline'], ['underline', 'Underline'], ['underline-thin', 'Thin underline']], (cursorStyle) => setEditor({ cursorStyle })) },
      editorToggle('Bracket pair colors', 'bracketPairColorization'), editorToggle('Line output panel', 'inlineInspector', 'Inspect results beside their source lines.'),
      editorToggle('Vim / LazyVim mode', 'vimMode', 'Modal editing. Space ? opens the keymap reference.')
    ],
    execution: [
      { label: 'Default runtime', control: select('Default runtime', prefs.defaultRuntime, [['node', 'Node.js'], ['deno', 'Deno'], ['bun', 'Bun'], ['browser', 'Chromium']], (defaultRuntime) => onPatch({ prefs: { defaultRuntime } })) },
      { label: 'Run timeout', description: 'Milliseconds before a running program is stopped.', control: <TextInput aria-label="Timeout (ms)" type="number" min={100} step={100} value={prefs.timeoutMs} onChange={(event) => onPatch({ prefs: { timeoutMs: Math.max(100, Number(event.target.value) || 5000) } })} /> },
      { label: 'Auto-run after edits', description: 'Runs your code automatically after a short pause.', control: <Toggle label="Auto-run after edits" checked={prefs.autorun} onChange={(autorun) => onPatch({ prefs: { autorun } })} /> },
      { label: 'Ignore package install scripts', description: 'Recommended. Prevent dependencies from running installation scripts.', control: <Toggle label="Ignore package install scripts" checked={prefs.ignoreScripts} onChange={(ignoreScripts) => onPatch({ prefs: { ignoreScripts } })} /> }
    ],
    shortcuts: [
      ...[['Search files and commands', primaryShortcut('Shift+P')], ['Run current file', primaryShortcut('Enter')], ['Save file', primaryShortcut('S')], ['New file', primaryShortcut('N')], ['Settings', primaryShortcut(',')], ['Toggle tool panel', primaryShortcut('J')], ['Focus mode', 'Shift+F11'], ['Switch file', 'Ctrl+Tab'], ['Format code', 'Shift+Alt+F'], ['LazyVim keymap reference', 'Space ?']].map(([label, key]) => ({ label: label!, control: <kbd>{key}</kbd> })),
      { label: 'Vim keyboard ownership', description: 'Ctrl+J, Ctrl+N and Ctrl+W remain available to Vim while modal editing is enabled. Use Space f n for a new file.', control: null }
    ]
  };
  const needle = query.trim().toLowerCase();
  const visible = CATEGORIES.filter((item) => needle || item.id === category).map((item) => ({ ...item, rows: sections[item.id].filter((row) => !needle || `${row.label} ${row.description ?? ''} ${row.keywords ?? ''} ${item.label}`.toLowerCase().includes(needle)) })).filter((item) => item.rows.length > 0);
  return <div className="rh-preferences">
    <header className="rh-dialog-heading"><div><h1>Settings</h1><p>Your workspace, your way. Changes save automatically.</p></div><Button onClick={onClose} aria-label="Close settings" title="Close (Esc)"><Icon name="close" /></Button></header>
    <div className="rh-preferences-search"><Icon name="search" /><TextInput autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search settings…" aria-label="Search settings" />{query && <Button onClick={() => setQuery('')} aria-label="Clear settings search"><Icon name="close" size={14} /></Button>}</div>
    <div className="rh-preferences-body">
      <nav className="rh-preferences-nav" aria-label="Settings categories">{CATEGORIES.map((item) => <button type="button" key={item.id} aria-label={item.label} aria-current={!needle && category === item.id ? 'page' : undefined} onClick={() => { setCategory(item.id); setQuery(''); }}><Icon name={item.icon} /><span>{item.label}</span></button>)}</nav>
      <div className="rh-preferences-content" key={needle ? 'search' : category}>
        {visible.length === 0 && <div className="rh-empty-state"><strong>No settings found</strong><span>Try “wrap”, “theme” or “layout”.</span></div>}
        {visible.map((section) => <section key={section.id} aria-label={section.label}><header className="rh-preferences-section-heading"><div><h2>{section.label}</h2><p>{section.detail}</p></div>{section.id === 'appearance' && <Button onClick={onResetAppearance}>Reset appearance</Button>}{section.id === 'editor' && <Button onClick={onResetEditor}>Reset editor</Button>}</header>{section.rows.map((row) => <div className={`rh-preference-row${row.wide ? ' is-wide' : ''}`} key={row.label}><div><strong>{row.label}</strong>{row.description && <p>{row.description}</p>}</div><div className="rh-preference-control">{row.control}</div></div>)}</section>)}
      </div>
    </div>
    <footer className="rh-preferences-footer">
      <span role={saveStatus === 'error' ? 'alert' : 'status'} title={saveError ?? undefined} className={saveStatus === 'error' ? 'rh-save-error' : ''}>
        {saveStatus === 'saved' && <Icon name="check" size={13} />}
        {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'error' ? 'Changes could not be saved.' : saveStatus === 'saved' ? 'Saved on this device' : 'Preferences are stored locally'}
        {saveStatus === 'error' && <Button onClick={() => onPatch({ prefs: settings.prefs, appearance: settings.appearance, editor: settings.editor, layout: settings.layout, session: settings.session })}>Retry save</Button>}
      </span>
      {resetPending ? <span>Reset preferences? <Button variant="danger" onClick={() => { onResetAll(); setResetPending(false); }}>Reset</Button><Button onClick={() => setResetPending(false)}>Cancel</Button></span> : <Button onClick={() => setResetPending(true)}>Reset preferences…</Button>}
    </footer>
  </div>;
}
