import { useState } from 'react';
import type { AppSettings, SettingsPatch } from '@rh/protocol';
import { Button, InstrumentFrame, SegmentedControl, TechnicalToggle, TextInput } from './primitives';

interface SettingsViewProps {
  settings: AppSettings;
  onPatch: (patch: SettingsPatch) => void;
  onResetAppearance: () => void;
  onResetAll: () => void;
  onClose: () => void;
}

const CATEGORIES = [
  { id: 'appearance', index: '01', label: 'Appearance', detail: 'surface / atmosphere' },
  { id: 'editor', index: '02', label: 'Editor & density', detail: 'source / display' },
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

export function SettingsView({ settings, onPatch, onResetAppearance, onResetAll, onClose }: SettingsViewProps): React.JSX.Element {
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
              <div className="rh-settings-disabled-note">ambient background disabled for performance</div>
            </div>
          </InstrumentFrame>}
          {activeCategory === 'editor' && <InstrumentFrame key="editor" index="02" title="EDITOR / DENSITY" metadata="SOURCE / DISPLAY" state="active">
            <div className="rh-settings-body">
              <ChoiceRow label="density"><SegmentedControl aria-label="Density">{(['compact', 'comfortable'] as const).map((value) => <Choice key={value} label={value.toUpperCase()} selected={appearance.density === value} onChange={() => setAppearance({ density: value })} />)}</SegmentedControl></ChoiceRow>
              <ChoiceRow label="ui scale"><SegmentedControl aria-label="UI scale">{([90, 100, 110] as const).map((value) => <Choice key={value} label={`${value}%`} selected={appearance.uiScale === value} onChange={() => setAppearance({ uiScale: value })} />)}</SegmentedControl></ChoiceRow>
              <ChoiceRow label="editor font size"><TextInput aria-label="Editor font size" type="number" min={11} max={18} value={editor.fontSize} onChange={(event) => setEditor({ fontSize: Math.min(18, Math.max(11, Number(event.target.value) || 13)) })} /></ChoiceRow>
              <TechnicalToggle label="inline inspector" checked={editor.inlineInspector} onChange={(checked) => setEditor({ inlineInspector: checked })} />
              <TechnicalToggle label="Vim / Neovim keys" detail="modal editing in source" checked={editor.vimMode} onChange={(checked) => setEditor({ vimMode: checked })} />
            </div>
          </InstrumentFrame>}
          {activeCategory === 'execution' && <InstrumentFrame key="execution" index="03" title="EXECUTION" metadata="RUNTIME / V8" state="active">
            <div className="rh-settings-body">
              <ChoiceRow label="default runtime"><select className="rh-input" aria-label="Default runtime" value={prefs.defaultRuntime} onChange={(event) => setPrefs({ defaultRuntime: event.target.value as AppSettings['prefs']['defaultRuntime'] })}><option value="node">NODE.JS</option><option value="deno">DENO</option><option value="bun">BUN</option></select></ChoiceRow>
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
