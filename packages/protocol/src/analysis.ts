import { z } from 'zod';
import { RuntimeIdSchema } from './run.js';

export const EngineIdSchema = z.enum(['v8', 'spidermonkey', 'javascriptcore', 'quickjs']);
export type EngineId = z.infer<typeof EngineIdSchema>;

export const AnalysisTypeSchema = z.enum(['ast', 'bytecode', 'optcode', 'ir-graph', 'deopts', 'gc']);
export type AnalysisType = z.infer<typeof AnalysisTypeSchema>;

export const RuntimeCapabilitiesSchema = z
  .object({
    supportsTypeScriptNative: z.boolean(),
    supportsNpm: z.boolean(),
    supportsCommonJS: z.boolean(),
    supportsESM: z.boolean(),
    supportsInspector: z.boolean(),
    supportsProfiling: z.boolean(),
    supportsHeapSnapshot: z.boolean()
  })
  .strict();
export type RuntimeCapabilities = z.infer<typeof RuntimeCapabilitiesSchema>;

export const EngineCapabilitiesSchema = z
  .object({
    astDump: z.boolean(),
    bytecodeDump: z.boolean(),
    optCodeDisasm: z.boolean(),
    irGraphDump: z.boolean(),
    deoptTrace: z.boolean(),
    gcLog: z.boolean(),
    profileSampling: z.boolean(),
    perFunctionFilter: z.boolean(),
    /** Raw-terminology caveats surfaced in UI tooltips. */
    notes: z.array(z.string())
  })
  .strict();
export type EngineCapabilities = z.infer<typeof EngineCapabilitiesSchema>;

export const AnalysisRequestSchema = z
  .object({
    requestId: z.string().min(8),
    code: z.string(), // wrapped standalone snippet (SelectionService output)
    analysisTypes: z.array(AnalysisTypeSchema).min(1),
    functionName: z.string().optional()
  })
  .strict();
export type AnalysisRequest = z.infer<typeof AnalysisRequestSchema>;

/**
 * Normalized representations are engine-parser-specific and intentionally NOT
 * schema-frozen here; `normalized` is opaque at the protocol boundary while
 * rawOutput stays the authoritative artifact (plan D4 / capability matrix rule).
 */
export const AnalysisResultSchema = z
  .object({
    source: z.string(),
    engine: EngineIdSchema,
    engineVersion: z.string().min(1),
    analysisType: AnalysisTypeSchema,
    rawOutput: z.string(),
    normalized: z.unknown().optional(),
    artifacts: z.array(z.object({ name: z.string(), path: z.string() })),
    metadata: z.object({
      flagsUsed: z.array(z.string()),
      durationMs: z.number().nonnegative(),
      binaryPath: z.string()
    })
  })
  .strict();
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;
