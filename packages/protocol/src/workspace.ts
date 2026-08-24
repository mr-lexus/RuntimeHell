import { z } from 'zod';

export const RelPathSchema = z
  .string()
  .min(1)
  .refine((p) => !p.includes('..') && !/^[a-zA-Z]:/.test(p) && !p.startsWith('/') && !p.startsWith('\\'), {
    message: 'relative path must stay inside the workspace'
  });

export const SaveFileRequestSchema = z
  .object({ workspaceId: z.string().min(1), relPath: RelPathSchema, content: z.string() })
  .strict();
export type SaveFileRequest = z.infer<typeof SaveFileRequestSchema>;

export const SaveFileResponseSchema = z.object({ ok: z.literal(true), bytes: z.number().int().nonnegative() });
export type SaveFileResponse = z.infer<typeof SaveFileResponseSchema>;

export const ReadFileRequestSchema = z.object({ workspaceId: z.string().min(1), relPath: RelPathSchema }).strict();
export type ReadFileRequest = z.infer<typeof ReadFileRequestSchema>;

export const ReadFileResponseSchema = z.union([
  z.object({ ok: z.literal(true), content: z.string() }),
  z.object({ ok: z.literal(false), error: z.string() })
]);
export type ReadFileResponse = z.infer<typeof ReadFileResponseSchema>;

export const ListFilesRequestSchema = z.object({ workspaceId: z.string().min(1) }).strict();
export type ListFilesRequest = z.infer<typeof ListFilesRequestSchema>;

export const WorkspaceFileInfoSchema = z.object({ relPath: z.string(), sizeBytes: z.number().int().nonnegative() });
export type WorkspaceFileInfo = z.infer<typeof WorkspaceFileInfoSchema>;

export const ListFilesResponseSchema = z.object({ ok: z.literal(true), files: z.array(WorkspaceFileInfoSchema) });
export type ListFilesResponse = z.infer<typeof ListFilesResponseSchema>;
