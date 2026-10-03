import { describe, expect, it } from 'vitest';
import { SettingsPatchSchema } from '@rh/protocol';
import { effectiveToolPosition, resizeToolRatio, WORKSPACE_PRESETS, workspacePreset } from './workspace-layout';

describe('workspace layout', () => {
  it.each(WORKSPACE_PRESETS)('$id is a valid, focused settings patch', ({ id }) => {
    const patch = workspacePreset(id);
    expect(SettingsPatchSchema.parse(patch)).toEqual(patch);
    expect(patch.layout?.focusMode).toBe(false);
    expect(patch.editor).toEqual({ inlineInspector: false });
    expect(patch.prefs).toBeUndefined();
  });

  it('preserves code space until tools are requested', () => {
    expect(workspacePreset('code').layout?.drawerOpen).toBe(false);
    expect(workspacePreset('run').layout).toMatchObject({ drawerOpen: true, drawerTab: 'console', toolPosition: 'bottom' });
    expect(workspacePreset('analyze').layout).toMatchObject({ drawerOpen: true, drawerTab: 'analysis', toolPosition: 'right' });
  });

  it('adapts right docking to narrow windows without changing the preference', () => {
    expect(effectiveToolPosition('right', 999)).toBe('bottom');
    expect(effectiveToolPosition('right', 1000)).toBe('right');
    expect(effectiveToolPosition('bottom', 1440)).toBe('bottom');
  });

  it('keeps resizing within persisted schema bounds', () => {
    expect(resizeToolRatio('right', .01)).toBe(.25);
    expect(resizeToolRatio('right', .99)).toBe(.65);
    expect(resizeToolRatio('bottom', .01)).toBe(.08);
    expect(resizeToolRatio('bottom', .99)).toBe(.85);
    expect(resizeToolRatio('bottom', .42)).toBe(.42);
  });
});
