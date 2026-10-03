import { describe, expect, it } from 'vitest';
import { PkgImportRequestSchema, PkgImportResponseSchema } from './packages.js';

describe('package import boundary', () => {
  it.each(['../private', '/tmp/file', 'name/subpath', '@scope/../file'])('rejects unsafe names: %s', (name) => {
    expect(PkgImportRequestSchema.safeParse({ workspaceId: 'default', name }).success).toBe(false);
  });
  it('is a narrow request, not a filesystem or arbitrary-code bridge', () => {
    expect(PkgImportRequestSchema.safeParse({ workspaceId: 'default', name: 'demo', path: '/tmp/readme' }).success).toBe(false);
    expect(PkgImportResponseSchema.safeParse({ ok: true, info: { name: 'demo', version: '1', source: 'readme', example: null, supportsImport: true, supportsRequire: true, bindings: [{ kind: 'named', imported: 'x;evil()', local: 'x' }] } }).success).toBe(false);
  });
});
