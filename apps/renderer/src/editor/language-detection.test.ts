import { describe, expect, it } from 'vitest';
import { detectSourceLanguage } from './language-detection';

describe('detectSourceLanguage', () => {
  it('uses TypeScript extensions as a strong signal', () => {
    expect(detectSourceLanguage('', 'entry.ts')).toBe('ts');
    expect(detectSourceLanguage('', 'component.tsx')).toBe('ts');
  });

  it('detects TypeScript syntax inside a JavaScript-named file', () => {
    expect(detectSourceLanguage("interface User { name: string }\nconst user: User = { name: 'ok' };", 'entry.js')).toBe('ts');
    expect(detectSourceLanguage('const value = 1 as number;', 'entry.js')).toBe('ts');
    expect(detectSourceLanguage('import type { User } from "./user";', 'entry.js')).toBe('ts');
  });

  it('detects incomplete TypeScript while the user is typing', () => {
    expect(detectSourceLanguage('interface User {', 'entry.js')).toBe('ts');
    expect(detectSourceLanguage('const user: User =', 'entry.js')).toBe('ts');
  });

  it('keeps ordinary JavaScript as JavaScript', () => {
    expect(detectSourceLanguage("const user = { name: 'ok' };\nconsole.log(user);", 'entry.js')).toBe('js');
  });
});
