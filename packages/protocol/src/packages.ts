/**
 * Packages IPC contracts (plan todo 13, D7).
 * npm ops are scoped to the ACTIVE WORKSPACE directory; the npm binary is
 * resolved per D7: managed active runtime's bundled npm → PATH npm →
 * structured error with setup guidance.
 */
import { z } from 'zod';

export const PkgOpRequestSchema = z
  .object({
    workspaceId: z.string().min(1),
    /** Bare package name (install/uninstall). */
    name: z.string().min(1),
    /** Optional range for installs ('latest' default). */
    versionRange: z.string().min(1).optional(),
    /** Renderer's selected MANAGED node version — drives D7 npm resolution. */
    managedNodeVersion: z.string().min(1).optional(),
    /** Whether npm lifecycle scripts are disabled for this operation. */
    ignoreScripts: z.boolean().default(true)
  })
  .strict();
export type PkgOpRequest = z.infer<typeof PkgOpRequestSchema>;

export const PkgListRequestSchema = z.object({ workspaceId: z.string().min(1) }).strict();
export type PkgListRequest = z.infer<typeof PkgListRequestSchema>;

/** Verbatim npm CLI output lines streamed to the panel log area. */
export const PkgEventSchema = z
  .object({
    workspaceId: z.string(),
    stream: z.enum(['stdout', 'stderr']),
    text: z.string()
  })
  .strict();
export type PkgEvent = z.infer<typeof PkgEventSchema>;

export const PkgOpResponseSchema = z.union([
  z.object({ ok: z.literal(true), dependencies: z.record(z.string(), z.string()) }).strict(),
  z.object({ ok: z.literal(false), message: z.string().min(1), stderrTail: z.string() }).strict()
]);
export type PkgOpResponse = z.infer<typeof PkgOpResponseSchema>;

export const PkgListResponseSchema = z.union([
  z.object({ ok: z.literal(true), dependencies: z.record(z.string(), z.string()) }).strict(),
  z.object({ ok: z.literal(false), message: z.string().min(1) }).strict()
]);
export type PkgListResponse = z.infer<typeof PkgListResponseSchema>;

export const PkgSearchRequestSchema = z.object({ query: z.string().min(1), size: z.number().int().positive().max(50).default(20) }).strict();
export type PkgSearchRequest = z.infer<typeof PkgSearchRequestSchema>;

export const PkgSearchRowSchema = z
  .object({
    name: z.string().min(1),
    version: z.string().min(1),
    description: z.string(),
    score: z.number()
  })
  .strict();
export type PkgSearchRow = z.infer<typeof PkgSearchRowSchema>;

export const PkgSearchResponseSchema = z.union([
  z.object({ ok: z.literal(true), results: z.array(PkgSearchRowSchema) }).strict(),
  z.object({ ok: z.literal(false), message: z.string().min(1) }).strict()
]);
export type PkgSearchResponse = z.infer<typeof PkgSearchResponseSchema>;
