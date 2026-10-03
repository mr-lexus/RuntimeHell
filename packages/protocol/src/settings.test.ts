import { describe, expect, it } from 'vitest';
import { SettingsPatchSchema } from './settings.js';

describe('SettingsPatchSchema', () => {
  it('does not inject layout defaults into a partial update', () => {
    expect(SettingsPatchSchema.parse({ layout: { drawerOpen: true } })).toEqual({ layout: { drawerOpen: true } });
  });

  it('accepts the performance tab and rejects invalid layout bounds', () => {
    expect(SettingsPatchSchema.parse({ layout: { drawerTab: 'performance' } }).layout?.drawerTab).toBe('performance');
    expect(SettingsPatchSchema.safeParse({ layout: { sideRatio: .9 } }).success).toBe(false);
    expect(SettingsPatchSchema.safeParse({ layout: { toolPosition: 'floating' } }).success).toBe(false);
  });
  it('does not inject editor defaults into a partial update', () => {
    expect(SettingsPatchSchema.parse({ editor: { fontSize: 16 } })).toEqual({
      editor: { fontSize: 16 }
    });
  });

  it('preserves an explicitly enabled Vim mode', () => {
    expect(SettingsPatchSchema.parse({ editor: { lineNumbers: 'relative', vimMode: true } })).toEqual({
      editor: { lineNumbers: 'relative', vimMode: true }
    });
  });
});
