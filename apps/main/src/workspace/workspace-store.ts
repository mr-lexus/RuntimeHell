/**
 * WorkspaceStore (plan todo 21): CRUD over the native home directory.
 * workspaces\{id}\ with a meta.json per workspace. IDs are 12-char base62
 * (nanoid-style, crypto-backed) unless the caller supplies one.
 */
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { workspacesDir, workspaceRoot } from './files.js';

export interface WorkspaceMeta {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly lastOpenedAt: string;
}

const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export function shortId(length = 12): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += ID_ALPHABET[bytes[i]! % ID_ALPHABET.length];
  }
  return out;
}

function metaPath(root: string): string {
  return join(root, 'meta.json');
}

export async function createWorkspace(requestedId?: string, name?: string): Promise<WorkspaceMeta> {
  const id = requestedId ?? shortId();
  const root = workspaceRoot(id); // validates
  await fs.mkdir(root, { recursive: true });
  const now = new Date().toISOString();
  const meta: WorkspaceMeta = { id, name: name ?? id, createdAt: now, lastOpenedAt: now };
  await fs.writeFile(metaPath(root), JSON.stringify(meta, null, 2), 'utf8');
  return meta;
}

export async function listWorkspaces(): Promise<WorkspaceMeta[]> {
  let ids: string[] = [];
  try {
    ids = await fs.readdir(workspacesDir());
  } catch {
    return [];
  }
  const metas: WorkspaceMeta[] = [];
  for (const id of ids) {
    try {
      const raw = await fs.readFile(join(workspacesDir(), id, 'meta.json'), 'utf8');
      const meta = JSON.parse(raw) as WorkspaceMeta;
      if (typeof meta.id === 'string') metas.push(meta);
    } catch {
      /* directory without meta (e.g. stray) — skipped */
    }
  }
  return metas.sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt));
}

export async function touchWorkspace(id: string): Promise<void> {
  const root = workspaceRoot(id);
  const path = metaPath(root);
  let meta: WorkspaceMeta;
  try {
    meta = { ...(JSON.parse(await fs.readFile(path, 'utf8')) as WorkspaceMeta), lastOpenedAt: new Date().toISOString() };
  } catch {
    meta = { id, name: id, createdAt: new Date().toISOString(), lastOpenedAt: new Date().toISOString() };
  }
  await fs.writeFile(path, JSON.stringify(meta, null, 2), 'utf8');
}

export async function deleteWorkspace(id: string): Promise<void> {
  const root = workspaceRoot(id);
  await fs.rm(root, { recursive: true, force: false });
}
