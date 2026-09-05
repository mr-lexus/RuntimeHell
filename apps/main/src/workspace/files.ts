/**
 * Workspace file operations (early minimal surface; WorkspaceStore in todo 21
 * builds metadata/history on top of the same root layout).
 *
 * Root: native home directory/RuntimeHell/workspaces/{workspaceId}/
 * Path safety: relPath is validated by RelPathSchema AND re-verified here
 * (defense in depth) after normalization.
 */
import { promises as fs } from 'node:fs';
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

export async function saveFile(req: SaveFileRequest): Promise<unknown> {
  const root = workspaceRoot(req.workspaceId);
  const abs = safeResolve(root, req.relPath);
  await fs.mkdir(abs.slice(0, abs.lastIndexOf(sep)), { recursive: true });
  await fs.writeFile(abs, req.content, 'utf8');
  return SaveFileResponseSchema.parse({ ok: true, bytes: Buffer.byteLength(req.content, 'utf8') });
}

export async function readFile(req: ReadFileRequest): Promise<unknown> {
  const root = workspaceRoot(req.workspaceId);
  try {
    const content = await fs.readFile(safeResolve(root, req.relPath), 'utf8');
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
