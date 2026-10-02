import { z } from 'zod';
import { RunStatusSchema } from './run.js';

export const WorkspaceIdSchema = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/, 'invalid workspace id');
export type WorkspaceId = z.infer<typeof WorkspaceIdSchema>;

export const RelPathSchema = z
  .string()
  .min(1)
  .refine((path) => {
    if (path.includes('\0') || /^[a-zA-Z]:/.test(path) || path.startsWith('/') || path.startsWith('\\')) return false;
    return !path.split(/[\\/]/).some((segment) => segment === '.' || segment === '..');
  }, {
    message: 'relative path must stay inside the workspace'
  });

export const SaveFileRequestSchema = z
  .object({ workspaceId: WorkspaceIdSchema, relPath: RelPathSchema, content: z.string() })
  .strict();
export type SaveFileRequest = z.infer<typeof SaveFileRequestSchema>;

export const SaveFileResponseSchema = z.object({ ok: z.literal(true), bytes: z.number().int().nonnegative() });
export type SaveFileResponse = z.infer<typeof SaveFileResponseSchema>;

export const ReadFileRequestSchema = z.object({ workspaceId: WorkspaceIdSchema, relPath: RelPathSchema }).strict();
export type ReadFileRequest = z.infer<typeof ReadFileRequestSchema>;

export const ReadFileResponseSchema = z.union([
  z.object({ ok: z.literal(true), content: z.string() }),
  z.object({ ok: z.literal(false), error: z.string() })
]);
export type ReadFileResponse = z.infer<typeof ReadFileResponseSchema>;

export const ListFilesRequestSchema = z.object({ workspaceId: WorkspaceIdSchema }).strict();
export type ListFilesRequest = z.infer<typeof ListFilesRequestSchema>;

export const WorkspaceFileInfoSchema = z.object({ relPath: z.string(), sizeBytes: z.number().int().nonnegative() });
export type WorkspaceFileInfo = z.infer<typeof WorkspaceFileInfoSchema>;

export const ListFilesResponseSchema = z.object({ ok: z.literal(true), files: z.array(WorkspaceFileInfoSchema) });
export type ListFilesResponse = z.infer<typeof ListFilesResponseSchema>;

export const WorkspaceMetaSchema = z.object({
  id: WorkspaceIdSchema,
  name: z.string().min(1).max(200),
  createdAt: z.string().min(1),
  lastOpenedAt: z.string().min(1)
}).strict();
export type WorkspaceMeta = z.infer<typeof WorkspaceMetaSchema>;

export const CreateWorkspaceRequestSchema = z.object({
  id: WorkspaceIdSchema.optional(),
  name: z.string().trim().min(1).max(200).optional()
}).strict();
export type CreateWorkspaceRequest = z.infer<typeof CreateWorkspaceRequestSchema>;

export const ListWorkspacesResponseSchema = z.array(WorkspaceMetaSchema);
export const DeleteWorkspaceRequestSchema = z.object({ workspaceId: WorkspaceIdSchema }).strict();
export const DeleteWorkspaceResponseSchema = z.object({ ok: z.literal(true) }).strict();

export const HistoryRecordSchema = z.object({
  runId: z.string().min(1),
  startedAt: z.string().min(1),
  finishedAt: z.string().min(1),
  relPath: RelPathSchema,
  contentSnapshot: z.string(),
  status: RunStatusSchema,
  exitCode: z.number().int().nullable(),
  durationMs: z.number().nonnegative(),
  killedBy: z.enum(['timeout', 'user']).nullable()
}).strict();
export type HistoryRecord = z.infer<typeof HistoryRecordSchema>;

export const HistoryListRequestSchema = z.object({ workspaceId: WorkspaceIdSchema }).strict();
export const HistoryListResponseSchema = z.object({ ok: z.literal(true), records: z.array(HistoryRecordSchema) }).strict();
export type HistoryListResponse = z.infer<typeof HistoryListResponseSchema>;
