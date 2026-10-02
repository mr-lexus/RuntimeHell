/**
 * Workspace file operations (early minimal surface; WorkspaceStore in todo 21
 * builds metadata/history on top of the same root layout).
 *
 * Root: native home directory/RuntimeHell/workspaces/{workspaceId}/
 * Path safety: relPath is validated by RelPathSchema AND re-verified here
 * (defense in depth) after normalization.
 */
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, normalize, sep } from 'node:path';
import { homedir } from 'node:os';
import {
  ListFilesResponseSchema,
  ReadFileResponseSchema,
  SaveFileResponseSchema,
  type ListFilesRequest,
  type ReadFileRequest,
  type SaveFileRequest
} from '@rh/protocol';

export function workspacesDir(): string {
  return join(homedir(), 'RuntimeHell', 'workspaces');
}

export function workspaceRoot(workspaceId: string): string {
  const id = workspaceId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!id || id !== workspaceId) throw new Error(`invalid workspaceId: ${workspaceId}`);
  return join(workspacesDir(), id);
}

function safeResolve(root: string, relPath: string): string {
  const abs = normalize(join(root, relPath));
  if (!abs.startsWith(root + sep) && abs !== root) throw new Error(`path escapes workspace: ${relPath}`);
  return abs;
}

async function lstatOrNull(path: string): Promise<Awaited<ReturnType<typeof fs.lstat>> | null> {
  try {
    return await fs.lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Resolve a workspace path one segment at a time, refusing symbolic links. */
async function resolveWithoutLinks(root: string, relPath: string, createParents: boolean): Promise<string> {
  const lexicalTarget = safeResolve(root, relPath);
  const rootStat = await lstatOrNull(root);
  if (rootStat?.isSymbolicLink()) throw new Error('workspace root must not be a symbolic link');
  if (rootStat === null) {
    if (!createParents) return lexicalTarget;
    await fs.mkdir(root, { recursive: true });
  } else if (!rootStat.isDirectory()) {
    throw new Error('workspace root is not a directory');
  }

  const segments = relPath.split(/[\\/]/).filter(Boolean);
  let current = root;
  for (let index = 0; index < segments.length; index++) {
    current = join(current, segments[index]!);
    const isLeaf = index === segments.length - 1;
    const stat = await lstatOrNull(current);
    if (stat?.isSymbolicLink()) throw new Error(`symbolic links are not allowed in workspace paths: ${relPath}`);
    if (isLeaf) return current;
    if (stat === null) {
      if (!createParents) return lexicalTarget;
      await fs.mkdir(current);
    } else if (!stat.isDirectory()) {
      throw new Error(`workspace path component is not a directory: ${segments[index]}`);
    }
  }
  return lexicalTarget;
}

export async function saveFile(req: SaveFileRequest): Promise<unknown> {
  const root = workspaceRoot(req.workspaceId);
  const abs = await resolveWithoutLinks(root, req.relPath, true);
  const tmp = `${abs}.rh-save-${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, req.content, 'utf8');
    await fs.rename(tmp, abs);
  } finally {
    await fs.rm(tmp, { force: true });
  }
  return SaveFileResponseSchema.parse({ ok: true, bytes: Buffer.byteLength(req.content, 'utf8') });
}

export async function readFile(req: ReadFileRequest): Promise<unknown> {
  const root = workspaceRoot(req.workspaceId);
  try {
    const content = await fs.readFile(await resolveWithoutLinks(root, req.relPath, false), 'utf8');
    return ReadFileResponseSchema.parse({ ok: true, content });
  } catch (err) {
    return ReadFileResponseSchema.parse({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

async function walk(dir: string, prefix: string, out: { relPath: string; sizeBytes: number }[]): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.rhbuild') continue;
    if (entry.isSymbolicLink()) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(abs, rel, out);
    } else {
      const stat = await fs.stat(abs);
      out.push({ relPath: rel, sizeBytes: stat.size });
    }
  }
}

export async function listFiles(_req: ListFilesRequest & { workspaceId: string }): Promise<unknown> {
  const root = workspaceRoot(_req.workspaceId);
  const files: { relPath: string; sizeBytes: number }[] = [];
  await walk(root, '', files);
  return ListFilesResponseSchema.parse({ ok: true, files });
}
