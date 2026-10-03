import type { AppSettings, SettingsPatch } from '@rh/protocol';

export const WORKSPACE_PRESETS = [
  { id: 'code', label: 'Code', description: 'A clear desk for writing. Tools are one click away.' },
  { id: 'run', label: 'Run', description: 'Code above, console below. Quick feedback as you work.' },
  { id: 'analyze', label: 'Analyze', description: 'Source and engine analysis side by side.' }
] as const;

export type WorkspacePreset = (typeof WORKSPACE_PRESETS)[number]['id'];

export function workspacePreset(id: WorkspacePreset): SettingsPatch {
  const layout = { focusMode: false, showStatusBar: true };
  switch (id) {
    case 'code': return { layout: { ...layout, toolPosition: 'bottom', drawerOpen: false }, editor: { inlineInspector: false } };
    case 'run': return { layout: { ...layout, toolPosition: 'bottom', drawerOpen: true, drawerRatio: 0.3, drawerTab: 'console' }, editor: { inlineInspector: false } };
    case 'analyze': return { layout: { ...layout, toolPosition: 'right', drawerOpen: true, sideRatio: 0.45, drawerTab: 'analysis' }, editor: { inlineInspector: false } };
  }
}

/** A narrow viewport temporarily docks below without rewriting the preference. */
export function effectiveToolPosition(position: AppSettings['layout']['toolPosition'], width: number): 'bottom' | 'right' {
  return position === 'right' && width >= 1000 ? 'right' : 'bottom';
}

export function resizeToolRatio(position: 'bottom' | 'right', ratio: number): number {
  return position === 'right' ? Math.min(0.65, Math.max(0.25, ratio)) : Math.min(0.85, Math.max(0.08, ratio));
}
