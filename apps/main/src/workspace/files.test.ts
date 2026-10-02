import { access, mkdtemp, mkdir, readFile as readNativeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listFiles, readFile, saveFile, workspaceRoot } from './files.js';

let sandbox = '';
let userProfileBackup: string | undefined;
let posixHomeBackup: string | undefined;

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'rh-workspace-files-'));
  userProfileBackup = process.env['USERPROFILE'];
  posixHomeBackup = process.env['HOME'];
  process.env['USERPROFILE'] = sandbox;
  if (process.platform !== 'win32') process.env['HOME'] = sandbox;
});

afterEach(async () => {
  if (userProfileBackup === undefined) delete process.env['USERPROFILE'];
  else process.env['USERPROFILE'] = userProfileBackup;
  if (posixHomeBackup === undefined) delete process.env['HOME'];
  else process.env['HOME'] = posixHomeBackup;
  await rm(sandbox, { recursive: true, force: true });
});

describe('workspace file containment', () => {
  it('writes, reads, and lists regular nested files', async () => {
    await saveFile({ workspaceId: 'default', relPath: 'src/index.ts', content: 'export {};' });
    await expect(readFile({ workspaceId: 'default', relPath: 'src/index.ts' })).resolves.toEqual({ ok: true, content: 'export {};' });
    await expect(listFiles({ workspaceId: 'default' })).resolves.toMatchObject({
      ok: true,
      files: [{ relPath: 'src/index.ts' }]
    });
  });

  it('refuses to follow a directory link outside the workspace', async () => {
    const outside = join(sandbox, 'outside');
    const root = workspaceRoot('default');
    await mkdir(outside, { recursive: true });
    await mkdir(root, { recursive: true });
    await symlink(outside, join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');

    await expect(saveFile({ workspaceId: 'default', relPath: 'linked/escape.txt', content: 'nope' })).rejects.toThrow(/symbolic links/i);
    await expect(access(join(outside, 'escape.txt'))).rejects.toThrow();
    await expect(readFile({ workspaceId: 'default', relPath: 'linked/secret.txt' })).resolves.toMatchObject({ ok: false });
    await expect(readNativeFile(join(outside, 'escape.txt'), 'utf8')).rejects.toThrow();
  });
});
