import { useState } from 'react';
import type { AppSettings, SettingsPatch } from '@rh/protocol';
import { Button, InstrumentFrame, SegmentedControl, TechnicalToggle, TextInput } from './primitives';

interface SettingsViewProps {
  settings: AppSettings;
  onPatch: (patch: SettingsPatch) => void;
  onResetAppearance: () => void;
  onResetEditor: () => void;
  onResetAll: () => void;
  onClose: () => void;
}

const CATEGORIES = [
  { id: 'appearance', index: '01', label: 'Appearance', detail: 'surface / atmosphere' },
  { id: 'editor', index: '02', label: 'Editor', detail: 'source / display' },
  { id: 'execution', index: '03', label: 'Execution', detail: 'runtime / limits' }
] as const;

const ACCENT_PRESETS = [
  { value: 'cyan', label: 'CYAN', color: '#08788d' },
  { value: 'amber', label: 'AMBER', color: '#d7aa58' },
  { value: 'silver', label: 'SILVER', color: '#a8bbc4' },
  { value: 'violet', label: 'VIOLET', color: '#8b7cff' },
  { value: 'magenta', label: 'MAGENTA', color: '#d65db1' },
  { value: 'green', label: 'GREEN', color: '#54b37a' },
  { value: 'orange', label: 'ORANGE', color: '#e0793f' },
  { value: 'ruby', label: 'RUBY', color: '#d95767' }
] as const;

function Choice({ label, selected, onChange }: { label: string; selected: boolean; onChange: () => void }): React.JSX.Element {
  return <button type="button" className={`rh-choice ${selected ? 'is-selected' : ''}`} aria-pressed={selected} onClick={onChange}>{label}</button>;
}

function ChoiceRow({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return <div className="rh-setting-row"><span className="rh-setting-label">{label}</span><div className="rh-setting-control">{children}</div></div>;
}

export function SettingsView({ settings, onPatch, onResetAppearance, onResetEditor, onResetAll, onClose }: SettingsViewProps): React.JSX.Element {
  const { appearance, editor, prefs } = settings;
  const [activeCategory, setActiveCategory] = useState<(typeof CATEGORIES)[number]['id']>('appearance');
  const setAppearance = (patch: Partial<AppSettings['appearance']>): void => onPatch({ appearance: patch });
  const setEditor = (patch: Partial<AppSettings['editor']>): void => onPatch({ editor: patch });
  const setPrefs = (patch: Partial<AppSettings['prefs']>): void => onPatch({ prefs: patch });
  const selectCategory = (id: (typeof CATEGORIES)[number]['id']): void => {
    setActiveCategory(id);
  };

  return (
    <div className="rh-settings-view">
      <header className="rh-settings-heading">
        <div><div className="rh-eyebrow">WORKSPACE / CONFIGURATION</div><h1>Settings</h1><p>Calibrate the instrument without leaving the workbench.</p></div>
        <div className="rh-settings-heading-actions"><Button variant="primary" onClick={onClose}>← workspace</Button><Button onClick={onResetAll}>reset all</Button></div>
      </header>
      <div className="rh-settings-layout">
        <nav className="rh-settings-nav" aria-label="Settings categories">
          <div className="rh-settings-nav-label">CATEGORIES</div>
          {CATEGORIES.map((category) => <button key={category.id} type="button" className={`rh-settings-category ${activeCategory === category.id ? 'is-active' : ''}`} aria-current={activeCategory === category.id ? 'page' : undefined} onClick={() => selectCategory(category.id)}><span className="rh-settings-category-index">{category.index}</span><span><strong>{category.label}</strong><small>{category.detail}</small></span></button>)}
        </nav>
        <div className="rh-settings-instrument">
          {activeCategory === 'appearance' && <InstrumentFrame key="appearance" index="01" title="APPEARANCE" metadata="SURFACE / ATMOSPHERE" state="active" actions={<Button onClick={onResetAppearance}>reset section</Button>}>
            <div className="rh-settings-body rh-settings-appearance">
              <ChoiceRow label="theme"><SegmentedControl aria-label="Theme">{(['dark', 'light', 'system'] as const).map((value) => <Choice key={value} label={value.toUpperCase()} selected={appearance.theme === value} onChange={() => setAppearance({ theme: value })} />)}</SegmentedControl></ChoiceRow>
              <ChoiceRow label="accent">
                <div className="rh-accent-options" role="group" aria-label="Accent">
                  {ACCENT_PRESETS.map((preset) => (
                    <button
                      key={preset.value}
                      type="button"
                      className={`rh-choice rh-accent-choice ${appearance.accent === preset.value ? 'is-selected' : ''}`}
                      aria-pressed={appearance.accent === preset.value}
                      onClick={() => setAppearance({ accent: preset.value })}
                    >
                      <span className="rh-accent-swatch" style={{ backgroundColor: preset.color }} aria-hidden="true" />
                      {preset.label}
                    </button>
                  ))}
                  <label className={`rh-custom-accent ${appearance.accent.startsWith('#') ? 'is-selected' : ''}`}>
                    <span className="rh-accent-swatch" style={{ backgroundColor: appearance.accent.startsWith('#') ? appearance.accent : '#08788d' }} aria-hidden="true" />
                    <span>CUSTOM</span>
                    <input
                      type="color"
                      value={appearance.accent.startsWith('#') ? appearance.accent : '#08788d'}
                      aria-label="Custom accent color"
                      onChange={(event) => setAppearance({ accent: event.target.value })}
                    />
                  </label>
                </div>
              </ChoiceRow>
              <ChoiceRow label="intensity"><SegmentedControl aria-label="Intensity">{(['low', 'standard', 'high'] as const).map((value) => <Choice key={value} label={value.toUpperCase()} selected={appearance.intensity === value} onChange={() => setAppearance({ intensity: value })} />)}</SegmentedControl></ChoiceRow>
              <ChoiceRow label="motion"><SegmentedControl aria-label="Motion">{(['system', 'reduced', 'full'] as const).map((value) => <Choice key={value} label={value.toUpperCase()} selected={appearance.motion === value} onChange={() => setAppearance({ motion: value })} />)}</SegmentedControl></ChoiceRow>
              <ChoiceRow label="density"><SegmentedControl aria-label="Density">{(['compact', 'comfortable'] as const).map((value) => <Choice key={value} label={value.toUpperCase()} selected={appearance.density === value} onChange={() => setAppearance({ density: value })} />)}</SegmentedControl></ChoiceRow>
              <ChoiceRow label="ui scale"><SegmentedControl aria-label="UI scale">{([90, 100, 110] as const).map((value) => <Choice key={value} label={`${value}%`} selected={appearance.uiScale === value} onChange={() => setAppearance({ uiScale: value })} />)}</SegmentedControl></ChoiceRow>
              <div className="rh-settings-disabled-note">ambient background disabled for performance</div>
            </div>
          </InstrumentFrame>}
          {activeCategory === 'editor' && <InstrumentFrame key="editor" index="02" title="EDITOR" metadata="SOURCE / DISPLAY / INPUT" state="active" actions={<Button onClick={onResetEditor}>reset section</Button>}>
            <div className="rh-settings-body rh-editor-settings-body">
              <div className="rh-settings-subheading">TYPOGRAPHY & INDENTATION</div>
              <ChoiceRow label="font size"><TextInput aria-label="Editor font size" type="number" min={10} max={32} value={editor.fontSize} onChange={(event) => setEditor({ fontSize: Math.min(32, Math.max(10, Number(event.target.value) || 13)) })} /></ChoiceRow>
              <TechnicalToggle label="font ligatures" detail="use the bundled JetBrains Mono glyphs" checked={editor.fontLigatures} onChange={(checked) => setEditor({ fontLigatures: checked })} />
              <ChoiceRow label="tab size"><select className="rh-input" aria-label="Tab size" value={editor.tabSize} onChange={(event) => setEditor({ tabSize: Math.min(8, Math.max(1, Number(event.target.value) || 2)) })}><option value={1}>1 space</option><option value={2}>2 spaces</option><option value={4}>4 spaces</option><option value={8}>8 spaces</option></select></ChoiceRow>
              <ChoiceRow label="indent with"><SegmentedControl aria-label="Indent with">{([{ value: true, label: 'SPACES' }, { value: false, label: 'TABS' }] as const).map((item) => <Choice key={item.label} label={item.label} selected={editor.insertSpaces === item.value} onChange={() => setEditor({ insertSpaces: item.value })} />)}</SegmentedControl></ChoiceRow>

              <div className="rh-settings-subheading">LAYOUT & NAVIGATION</div>
              <ChoiceRow label="word wrap"><select className="rh-input" aria-label="Word wrap" value={editor.wordWrap} onChange={(event) => setEditor({ wordWrap: event.target.value as AppSettings['editor']['wordWrap'] })}><option value="off">OFF</option><option value="on">ON</option><option value="wordWrapColumn">AT COLUMN</option><option value="bounded">BOUNDED</option></select></ChoiceRow>
              <ChoiceRow label="line numbers"><SegmentedControl aria-label="Line numbers">{(['on', 'off', 'relative'] as const).map((value) => <Choice key={value} label={value.toUpperCase()} selected={editor.lineNumbers === value} onChange={() => setEditor({ lineNumbers: value })} />)}</SegmentedControl></ChoiceRow>
              <TechnicalToggle label="minimap" detail="overview of the current file" checked={editor.minimap} onChange={(checked) => setEditor({ minimap: checked })} />
              <TechnicalToggle label="code folding" checked={editor.folding} onChange={(checked) => setEditor({ folding: checked })} />
              <TechnicalToggle label="smooth scrolling" checked={editor.smoothScrolling} onChange={(checked) => setEditor({ smoothScrolling: checked })} />
              <TechnicalToggle label="sticky scroll" detail="keep the current scope visible" checked={editor.stickyScroll} onChange={(checked) => setEditor({ stickyScroll: checked })} />

              <div className="rh-settings-subheading">SYNTAX & INPUT</div>
              <ChoiceRow label="whitespace"><select className="rh-input" aria-label="Render whitespace" value={editor.renderWhitespace} onChange={(event) => setEditor({ renderWhitespace: event.target.value as AppSettings['editor']['renderWhitespace'] })}><option value="none">HIDDEN</option><option value="boundary">BOUNDARY</option><option value="selection">SELECTION</option><option value="all">ALL</option></select></ChoiceRow>
              <ChoiceRow label="cursor style"><select className="rh-input" aria-label="Cursor style" value={editor.cursorStyle} onChange={(event) => setEditor({ cursorStyle: event.target.value as AppSettings['editor']['cursorStyle'] })}><option value="line">LINE</option><option value="line-thin">THIN LINE</option><option value="block">BLOCK</option><option value="block-outline">BLOCK OUTLINE</option><option value="underline">UNDERLINE</option><option value="underline-thin">THIN UNDERLINE</option></select></ChoiceRow>
              <TechnicalToggle label="bracket pair colors" checked={editor.bracketPairColorization} onChange={(checked) => setEditor({ bracketPairColorization: checked })} />
              <TechnicalToggle label="line output panel" detail="show or hide the results column beside the editor" checked={editor.inlineInspector} onChange={(checked) => setEditor({ inlineInspector: checked })} />
              <TechnicalToggle label="Vim / Neovim mode" detail="Esc normal · i insert · hjkl move" checked={editor.vimMode} onChange={(checked) => setEditor({ vimMode: checked })} />
              <div className="rh-settings-editor-note">Vim mode is an optional modal layer. Monaco language services, run/save shortcuts, and the existing source model remain available.</div>
            </div>
          </InstrumentFrame>}
          {activeCategory === 'execution' && <InstrumentFrame key="execution" index="03" title="EXECUTION" metadata="RUNTIME / V8" state="active">
            <div className="rh-settings-body">
              <ChoiceRow label="default runtime"><select className="rh-input" aria-label="Default runtime" value={prefs.defaultRuntime} onChange={(event) => setPrefs({ defaultRuntime: event.target.value as AppSettings['prefs']['defaultRuntime'] })}><option value="node">NODE.JS</option><option value="deno">DENO</option><option value="bun">BUN</option><option value="browser">BROWSER V8</option></select></ChoiceRow>
              <ChoiceRow label="timeout ms"><TextInput aria-label="Timeout (ms)" type="number" min={100} step={100} value={prefs.timeoutMs} onChange={(event) => setPrefs({ timeoutMs: Math.max(100, Number(event.target.value) || 5000) })} /></ChoiceRow>
              <TechnicalToggle label="auto-run after edits" checked={prefs.autorun} onChange={(checked) => setPrefs({ autorun: checked })} />
              <TechnicalToggle label="ignore install scripts" checked={prefs.ignoreScripts} onChange={(checked) => setPrefs({ ignoreScripts: checked })} />
            </div>
          </InstrumentFrame>}
        <div className="rh-settings-readout"><span className="rh-readout-mark">◇</span><span>CONFIGURATION SAVED LOCALLY</span><span className="rh-readout-rule" /><span>changes take effect immediately</span></div>
        </div>
      </div>
    </div>
  );
}
