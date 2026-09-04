import { z } from 'zod';
import { RelPathSchema } from './workspace.js';

export const PerformanceTargetRefSchema = z.object({
  source: z.enum(['runtime', 'engine']), id: z.string().min(1),
  version: z.string().min(1).optional(), provenance: z.string().min(1).optional()
}).strict();
export type PerformanceTargetRef = z.infer<typeof PerformanceTargetRefSchema>;

export const PerformanceProfileRefSchema = z.object({ id: z.string().min(1), label: z.string().min(1).optional() }).strict();
export type PerformanceProfileRef = z.infer<typeof PerformanceProfileRefSchema>;
export const PerformanceTargetSelectionSchema = z.object({
  target: PerformanceTargetRefSchema, profiles: z.array(PerformanceProfileRefSchema).min(1).max(8)
}).strict();
export type PerformanceTargetSelection = z.infer<typeof PerformanceTargetSelectionSchema>;

export const PerformanceCaseSchema = z.object({
  id: z.string().min(1), label: z.string().min(1).max(80),
  sourceLabel: z.string().min(1).max(260).optional(), body: z.string().min(1),
  mode: z.enum(['sync', 'async']).default('sync'),
  // Cases created from the editor keep a live source reference. `body` is
  // retained as a validated fallback snapshot for old experiments and when a
  // referenced tab is no longer open.
  sourceMode: z.enum(['file', 'selection']).optional(),
  sourceRef: z.object({
    fileId: z.string().min(1).optional(), relPath: z.string().min(1), startLine: z.number().int().positive(), startCol: z.number().int().positive(),
    endLine: z.number().int().positive(), endCol: z.number().int().positive()
  }).strict().optional(), sourceSnapshot: z.string().optional(),
  target: PerformanceTargetRefSchema.optional(),
  profileIds: z.array(z.string().min(1)).min(1).max(8).optional()
}).strict();
export type PerformanceCase = z.infer<typeof PerformanceCaseSchema>;

export const PerformanceMeasurementSchema = z.object({
  samples: z.number().int().min(3).max(200).default(20),
  warmupRounds: z.number().int().min(0).max(10_000).default(5),
  iterationsPerSample: z.number().int().min(1).max(10_000_000).default(1_000),
  timeoutMs: z.number().int().min(1_000).max(600_000).default(120_000),
  gcMode: z.enum(['runtime', 'before-group', 'before-sample']).default('runtime')
}).strict();
export type PerformanceMeasurement = z.infer<typeof PerformanceMeasurementSchema>;
export const PerformanceIsolationSchema = z.object({ mode: z.literal('target-profile').default('target-profile') }).strict();
export type PerformanceIsolation = z.infer<typeof PerformanceIsolationSchema>;
export const MAX_PERFORMANCE_TARGETS = 64;

export const PerformanceStartRequestSchema = z.object({
  requestId: z.string().min(8), workspaceId: z.string().min(1),
  name: z.string().min(1).max(120).default('Untitled experiment'), setup: z.string().max(200_000).default(''), setupSourceLabel: RelPathSchema.optional(),
  // The editor can contribute any number of linked cases; execution remains
  // bounded by the user's selected runtimes/profiles and measurement settings.
  cases: z.array(PerformanceCaseSchema).min(1), targets: z.array(PerformanceTargetSelectionSchema).min(1).max(MAX_PERFORMANCE_TARGETS),
  measurement: PerformanceMeasurementSchema.default({ samples: 20, warmupRounds: 5, iterationsPerSample: 1_000, timeoutMs: 120_000, gcMode: 'runtime' }),
  isolation: PerformanceIsolationSchema.default({ mode: 'target-profile' })
}).strict();
export type PerformanceStartRequest = z.infer<typeof PerformanceStartRequestSchema>;
export const PerformanceStartResponseSchema = z.object({
  accepted: z.literal(true), requestId: z.string(), totalGroups: z.number().int().positive(), totalCells: z.number().int().positive()
}).strict();
export type PerformanceStartResponse = z.infer<typeof PerformanceStartResponseSchema>;
export const PerformanceCancelRequestSchema = z.object({ requestId: z.string().min(1) }).strict();
export const PerformanceCancelResponseSchema = z.object({ ok: z.boolean() }).strict();
export type PerformanceCancelResponse = z.infer<typeof PerformanceCancelResponseSchema>;

export const PerformanceRawSampleSchema = z.object({
  caseId: z.string(), round: z.number().int().nonnegative(), durationNs: z.number().finite().nonnegative(),
  iterations: z.number().int().positive(), orderIndex: z.number().int().nonnegative()
}).strict();
export type PerformanceRawSample = z.infer<typeof PerformanceRawSampleSchema>;
export const PerformanceMetricsSchema = z.object({
  minNsPerOp: z.number().finite().nonnegative(), meanNsPerOp: z.number().finite().nonnegative(),
  medianNsPerOp: z.number().finite().nonnegative(), p75NsPerOp: z.number().finite().nonnegative(),
  p95NsPerOp: z.number().finite().nonnegative(), p99NsPerOp: z.number().finite().nonnegative(),
  maxNsPerOp: z.number().finite().nonnegative(), stddevNsPerOp: z.number().finite().nonnegative(),
  throughput: z.number().finite().nonnegative(), sampleCount: z.number().int().nonnegative(), totalIterations: z.number().int().nonnegative()
}).strict();
export type PerformanceMetrics = z.infer<typeof PerformanceMetricsSchema>;
export const PerformanceComparisonSchema = z.object({
  baselineCaseId: z.string(), candidateCaseId: z.string(), medianRatio: z.number().finite().nonnegative(),
  percentChange: z.number().finite(), confidenceLow: z.number().finite().nonnegative(), confidenceHigh: z.number().finite().nonnegative(),
  significance: z.enum(['candidate-faster', 'baseline-faster', 'indistinguishable', 'insufficient-data'])
}).strict();
export type PerformanceComparison = z.infer<typeof PerformanceComparisonSchema>;

export const PerformanceEnvironmentSchema = z.object({
  platform: z.string(), arch: z.string(), cpu: z.string(), logicalCores: z.number().int().positive(),
  runtimeId: z.string(), runtimeVersion: z.string(), engineId: z.string().optional(), engineVersion: z.string().optional(),
  executable: z.string(), flags: z.array(z.string()), gcMode: z.enum(['runtime', 'before-group', 'before-sample']).default('runtime')
}).strict();
export const PerformanceWarningSchema = z.object({ code: z.string(), message: z.string() }).strict();
export const PerformanceCaseResultSchema = z.object({
  caseId: z.string(), label: z.string(), metrics: PerformanceMetricsSchema,
  samples: z.array(PerformanceRawSampleSchema), warnings: z.array(PerformanceWarningSchema)
}).strict();
export type PerformanceCaseResult = z.infer<typeof PerformanceCaseResultSchema>;
export const PerformanceRunResultSchema = z.object({
  requestId: z.string(), groupId: z.string(), target: PerformanceTargetRefSchema, profile: PerformanceProfileRefSchema,
  environment: PerformanceEnvironmentSchema, results: z.array(PerformanceCaseResultSchema).min(1),
  comparisons: z.array(PerformanceComparisonSchema), scheduleSeed: z.number().int().nonnegative(), rounds: z.number().int().nonnegative()
}).strict();
export type PerformanceRunResult = z.infer<typeof PerformanceRunResultSchema>;

export const PerformanceProfileOptionSchema = z.object({
  id: z.string(), label: z.string(), description: z.string(), available: z.boolean(),
  classification: z.enum(['stable', 'experimental', 'internal'])
}).strict();
export type PerformanceProfileOption = z.infer<typeof PerformanceProfileOptionSchema>;
export const PerformanceTargetOptionSchema = z.object({
  ref: PerformanceTargetRefSchema, label: z.string(), available: z.boolean(), reason: z.string().nullable(),
  runtimeId: z.string(), runtimeVersion: z.string().nullable(), engineId: z.string().nullable(),
  profiles: z.array(PerformanceProfileOptionSchema)
}).strict();
export type PerformanceTargetOption = z.infer<typeof PerformanceTargetOptionSchema>;
export const PerformanceCatalogResponseSchema = z.object({ targets: z.array(PerformanceTargetOptionSchema) }).strict();
export type PerformanceCatalogResponse = z.infer<typeof PerformanceCatalogResponseSchema>;

export const PerformanceEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('progress'), requestId: z.string(), groupId: z.string().optional(), phase: z.enum(['resolving', 'preparing', 'warmup', 'measurement']), completed: z.number().int().nonnegative(), total: z.number().int().positive(), message: z.string() }).strict(),
  z.object({ type: z.literal('result'), requestId: z.string(), result: PerformanceRunResultSchema }).strict(),
  z.object({ type: z.literal('cell-error'), requestId: z.string(), groupId: z.string(), target: PerformanceTargetRefSchema, profile: PerformanceProfileRefSchema, message: z.string(), partialResults: z.array(PerformanceCaseResultSchema).default([]) }).strict(),
  z.object({ type: z.literal('done'), requestId: z.string(), status: z.enum(['completed', 'partial', 'cancelled', 'failed']), completedGroups: z.number().int().nonnegative(), totalGroups: z.number().int().nonnegative() }).strict()
]);
export type PerformanceEvent = z.infer<typeof PerformanceEventSchema>;
