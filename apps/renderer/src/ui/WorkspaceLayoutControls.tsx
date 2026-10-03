import type { AppSettings, SettingsPatch } from '@rh/protocol';
import { WORKSPACE_PRESETS, workspacePreset } from './workspace-layout';
import { Icon } from './Icon';
import { TechnicalToggle } from './primitives';

export function WorkspaceLayoutControls({ settings, onPatch }: { settings: AppSettings; onPatch: (patch: SettingsPatch) => void }): React.JSX.Element {
  const { layout } = settings;
  return <div className="rh-layout-controls">
    <div className="rh-layout-presets">{WORKSPACE_PRESETS.map((preset) => <button type="button" key={preset.id} onClick={() => onPatch(workspacePreset(preset.id))} title={preset.description}>
      <Icon name={preset.id === 'code' ? 'code' : preset.id === 'run' ? 'layout' : 'right'} size={25} /><strong>{preset.label}</strong><small>{preset.description}</small>
    </button>)}</div>
    <label className="rh-layout-field"><span>Tool panel position</span><select className="rh-input" value={layout.toolPosition} onChange={(event) => onPatch({ layout: { toolPosition: event.target.value as 'bottom' | 'right' } })}><option value="bottom">Bottom</option><option value="right">Right</option></select></label>
    <p className="rh-layout-note">Right panels move below the editor on smaller windows. Drag the divider to resize.</p>
    <TechnicalToggle label="Show tool panel" checked={layout.drawerOpen} onChange={(drawerOpen) => onPatch({ layout: { drawerOpen, focusMode: false } })} />
    <TechnicalToggle label="Line results" detail="Values beside their source lines" checked={settings.editor.inlineInspector} onChange={(inlineInspector) => onPatch({ editor: { inlineInspector } })} />
    <TechnicalToggle label="Status bar" checked={layout.showStatusBar} onChange={(showStatusBar) => onPatch({ layout: { showStatusBar } })} />
    <TechnicalToggle label="Focus mode" detail="Temporarily hide tools, line results and status" checked={layout.focusMode} onChange={(focusMode) => onPatch({ layout: { focusMode } })} />
  </div>;
}
