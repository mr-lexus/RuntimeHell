import { describe, expect, it } from 'vitest';
import { SettingsPatchSchema } from './settings.js';

describe('SettingsPatchSchema', () => {
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
