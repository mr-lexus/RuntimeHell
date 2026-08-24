import { z } from 'zod';

export const RuntimeIdSchema = z.enum(['node', 'deno', 'bun']);
export type RuntimeId = z.infer<typeof RuntimeIdSchema>;

/**
 * Structural value node produced by the ResultCapture serializer (todo 10).
 * Recursive; children carry keys for objects/entries for Map/Set.
 * `refId` marks back-edges into previously emitted nodes (circular refs).
 */
export type SerializedValue = {
  t:
    | 'undefined'
    | 'null'
    | 'boolean'
    | 'number'
    | 'string'
    | 'bigint'
    | 'symbol'
    | 'function'
    | 'class'
    | 'error'
    | 'promise'
    | 'map'
    | 'set'
    | 'date'
    | 'regexp'
    | 'typedarray'
    | 'object'
    | 'array';
  /** Primitive payload (stringified for bigint/symbol). */
  prim?: string;
  /** Display label (function name, error name, typed-array kind...). */
  label?: string;
  /** Element/entry count when known. */
  size?: number;
  /** Object/array/map/set children. */
  children?: { k: string; node: SerializedValue }[];
  /** Back-edge target index into the flat node table. */
  refId?: number;
  /** True when caps truncated this subtree. */
  truncated?: boolean;
};

export const SerializedValueSchema: z.ZodType<SerializedValue> = z.lazy(() =>
  z.object({
    t: z.enum([
      'undefined', 'null', 'boolean', 'number', 'string', 'bigint', 'symbol',
      'function', 'class', 'error', 'promise', 'map', 'set', 'date', 'regexp',
      'typedarray', 'object', 'array'
    ]),
    prim: z.string().optional(),
    label: z.string().optional(),
    size: z.number().int().nonnegative().optional(),
    children: z.array(z.object({ k: z.string(), node: z.lazy(() => SerializedValueSchema) })).optional(),
    refId: z.number().int().nonnegative().optional(),
    truncated: z.boolean().optional()
  })
);

export const RunRequestSchema = z
  .object({
    runId: z.string().min(8),
    workspaceId: z.string().min(1),
    entryPath: z.string().min(1), // absolute path to the file to execute
    runtimeId: RuntimeIdSchema,
    runtimeVersion: z.string().min(1),
    timeoutMs: z.number().int().positive(),
    cwd: z.string().min(1),
    envAllowlist: z.record(z.string(), z.string()).optional(),
    args: z.array(z.string()).optional()
  })
  .strict();
export type RunRequest = z.infer<typeof RunRequestSchema>;

export const RunEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('stdout'), runId: z.string(), data: z.string() }),
  z.object({ type: z.literal('stderr'), runId: z.string(), data: z.string() }),
  z.object({ type: z.literal('result'), runId: z.string(), index: z.number().int().nonnegative(), value: SerializedValueSchema }),
  z.object({
    type: z.literal('exit'),
    runId: z.string(),
    code: z.number().int().nullable(),
    signal: z.string().nullable(),
    durationMs: z.number().nonnegative(),
    killedBy: z.enum(['timeout', 'user']).nullable()
  }),
  z.object({ type: z.literal('error'), runId: z.string(), message: z.string(), code: z.string().optional() })
]);
export type RunEvent = z.infer<typeof RunEventSchema>;

export const RunStatusSchema = z.enum(['completed', 'timeout', 'cancelled', 'crashed', 'error']);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const RunResultSchema = z
  .object({
    runId: z.string(),
    status: RunStatusSchema,
    exitCode: z.number().int().nullable(),
    durationMs: z.number().nonnegative(),
    reports: z.array(z.object({ index: z.number().int().nonnegative(), value: SerializedValueSchema }))
  })
  .strict();
export type RunResult = z.infer<typeof RunResultSchema>;

/**
 * Lean IPC surface for todo 11: the renderer sends the ACTIVE FILE CONTENT;
 * the main process persists it into the workspace, transpiles, captures and
 * runs. Runtime resolution stays a main-process concern.
 */
export const RunStartRequestSchema = z
  .object({
    workspaceId: z.string().min(1),
    relPath: z.string().min(1),
    content: z.string(),
    timeoutMs: z.number().int().positive(),
    /** Requested MANAGED node version; falls back to system when absent/uninstalled. */
    runtimeVersion: z.string().min(1).optional()
  })
  .strict();
export type RunStartRequest = z.infer<typeof RunStartRequestSchema>;

export interface RunStartOk {
  readonly ok: true;
  readonly runId: string;
  readonly runtimeVersion: string;
}
export interface RunStartRejected {
  readonly ok: false;
  readonly stage: 'active' | 'transform' | 'transpile' | 'runtime';
  /** Present for transform/transpile failures. */
  readonly errors?: { readonly text: string; readonly line?: number; readonly column?: number }[];
  /** Present for stage='active'. */
  readonly activeRunId?: string;
  /** Human-readable detail for stage='runtime'. */
  readonly message?: string;
}
export type RunStartResponse = RunStartOk | RunStartRejected;

export const RunStartResponseSchema: z.ZodType<RunStartResponse> = z.union([
  z.object({ ok: z.literal(true), runId: z.string(), runtimeVersion: z.string() }),
  z.object({
    ok: z.literal(false),
    stage: z.enum(['active', 'transform', 'transpile', 'runtime']),
    errors: z.array(z.object({ text: z.string(), line: z.number().optional(), column: z.number().optional() })).optional(),
    activeRunId: z.string().optional(),
    message: z.string().optional()
  })
]);

export const RunCancelRequestSchema = z.object({ runId: z.string().min(1) }).strict();
export type RunCancelRequest = z.infer<typeof RunCancelRequestSchema>;

export const RunCancelResponseSchema = z.object({ ok: z.boolean() }).strict();
export type RunCancelResponse = z.infer<typeof RunCancelResponseSchema>;
