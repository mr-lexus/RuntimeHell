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
    source: z.enum(['official-dist', 'official-canary', 'taskcluster', 'webkit-requirements', 'local-import']),
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

// --- Runtimes panel surface (todo 12) --------------------------------------

export const NodeVersionRowSchema = z
  .object({
    version: z.string().min(1), // '22.17.0' (no leading v)
    lts: z.boolean(),
    date: z.string()
  })
  .strict();
export type NodeVersionRow = z.infer<typeof NodeVersionRowSchema>;

export const SystemRuntimeInfoSchema = z
  .object({
    exePath: z.string().min(1),
    version: z.string().min(1)
  })
  .strict();
export type SystemRuntimeInfo = z.infer<typeof SystemRuntimeInfoSchema>;

/** One row in a runtime's available-version list (nodejs.org / GitHub releases). */
export const RuntimeVersionRowSchema = z
  .object({
    version: z.string().min(1), // '22.17.0' (no leading v)
    date: z.string(), // ISO date or ''
    lts: z.boolean().optional() // node only
  })
  .strict();
export type RuntimeVersionRow = z.infer<typeof RuntimeVersionRowSchema>;

/** One nvm-windows installed Node version. */
export const NvmVersionInfoSchema = z
  .object({
    version: z.string().min(1), // '22.17.0'
    exePath: z.string().min(1), // absolute path to node.exe
    active: z.boolean() // is this the nvm-active version (symlink target)
  })
  .strict();
export type NvmVersionInfo = z.infer<typeof NvmVersionInfoSchema>;

/** nvm-windows detection result (null when nvm is not installed). */
export const NvmInfoSchema = z
  .object({
    root: z.string().min(1), // nvm root dir (NVM_HOME or %APPDATA%\nvm)
    versions: z.array(NvmVersionInfoSchema)
  })
  .strict();
export type NvmInfo = z.infer<typeof NvmInfoSchema>;

export const BinariesListRequestSchema = z.object({}).strict();
export type BinariesListRequest = z.infer<typeof BinariesListRequestSchema>;

export const BinariesListResponseSchema = z
  .object({
    /** System-wide (PATH) detection per runtime id: 'node' | 'deno' | 'bun'. */
    systemRuntimes: z.record(z.string(), SystemRuntimeInfoSchema.nullable()),
    /** Installed desktop browsers detected outside the embedded browser lane. */
    systemBrowsers: z.record(z.string(), SystemRuntimeInfoSchema.nullable()),
    /** nvm-windows Node versions (null when nvm absent). */
    nvm: NvmInfoSchema.nullable(),
    /** Managed runtime, engine, and support binaries currently installed. */
    installed: z.array(ManifestEntrySchema),
    /** Available versions per runtime id (bounded slice for node). */
    availableVersions: z.record(z.string(), z.array(RuntimeVersionRowSchema)),
    /** Non-fatal per-runtime index-fetch failures surfaced to the UI. */
    availableErrors: z.record(z.string(), z.string())
  })
  .strict();
export type BinariesListResponse = z.infer<typeof BinariesListResponseSchema>;

export const BinaryInstallRequestSchema = z
  .object({
    kind: z.enum(['runtime', 'engine']),
    id: z.string().min(1),
    version: z.string().min(1).optional(),
    /** Optional existing executable/directory copied into the RuntimeHell sandbox. */
    sourcePath: z.string().min(1).optional()
  })
  .strict();
export type BinaryInstallRequest = z.infer<typeof BinaryInstallRequestSchema>;

export const BinaryInstallAcceptedSchema = z
  .object({ ok: z.literal(true), entry: ManifestEntrySchema })
  .strict();
export const BinaryInstallRejectedSchema = z
  .object({ ok: z.literal(false), message: z.string().min(1) })
  .strict();
export const BinaryInstallResponseSchema = z.union([BinaryInstallAcceptedSchema, BinaryInstallRejectedSchema]);
export type BinaryInstallResponse = z.infer<typeof BinaryInstallResponseSchema>;

export const BinaryRemoveRequestSchema = z
  .object({
    kind: z.enum(['runtime', 'engine', 'runtime-support']),
    id: z.string().min(1),
    version: z.string().min(1)
  })
  .strict();
export type BinaryRemoveRequest = z.infer<typeof BinaryRemoveRequestSchema>;

export const BinaryRemoveResponseSchema = z.union([
  z.object({ ok: z.literal(true) }).strict(),
  z.object({ ok: z.literal(false), message: z.string().min(1) }).strict()
]);
export type BinaryRemoveResponse = z.infer<typeof BinaryRemoveResponseSchema>;

/** Streamed install/download progress over the binariesProgress channel. */
export const BinaryProgressEventSchema = z
  .object({
    kind: z.literal('runtime'),
    id: z.string().min(1),
    version: z.string().min(1),
    receivedBytes: z.number().nonnegative(),
    totalBytes: z.number().nullable(),
    done: z.boolean().optional()
  })
  .strict();
export type BinaryProgressEvent = z.infer<typeof BinaryProgressEventSchema>;
