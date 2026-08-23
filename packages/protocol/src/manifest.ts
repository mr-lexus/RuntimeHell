import { z } from 'zod';

export const PlatformSchema = z.enum(['win64', 'linux64', 'mac64', 'mac64arm']);
export type Platform = z.infer<typeof PlatformSchema>;

export const ArchSchema = z.enum(['x64', 'arm64']);
export type Arch = z.infer<typeof ArchSchema>;

/**
 * One downloadable artifact. User constraint (plan D2): official/verifiable
 * sources only; every entry carries platform/arch/version/checksum.
 */
export const ManifestEntrySchema = z
  .object({
    kind: z.enum(['runtime', 'engine', 'runtime-support']),
    id: z.string().min(1), // 'node' | 'd8' | 'jsshell' | 'jsc' | 'webkit-requirements' ...
    platform: PlatformSchema,
    arch: ArchSchema,
    version: z.string().min(1),
    url: z.string().url(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    license: z.string().min(1),
    source: z.enum(['official-dist', 'official-canary', 'taskcluster', 'webkit-requirements']),
    installedPath: z.string().optional(),
    addedAt: z.string().datetime().optional(),
    // true entries never appear here — they live ONLY in the C-lane catalog
    customBuildRequired: z.literal(false).default(false)
  })
  .strict();
export type ManifestEntry = z.infer<typeof ManifestEntrySchema>;

export const BinaryManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    entries: z.array(ManifestEntrySchema)
  })
  .strict();
export type BinaryManifest = z.infer<typeof BinaryManifestSchema>;

/** C-lane catalog row: an engine/platform combo with NO official prebuilt. */
export const CustomBuildRecipeSchema = z
  .object({
    engineId: z.string().min(1),
    platform: PlatformSchema,
    reason: z.string().min(1),
    recipeDoc: z.string().min(1) // pointer into docs/custom-builds.md
  })
  .strict();
export type CustomBuildRecipe = z.infer<typeof CustomBuildRecipeSchema>;
