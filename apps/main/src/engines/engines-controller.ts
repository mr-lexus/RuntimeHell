/**
 * EnginesController (plan todo 19): read-only surface for the drawer's
 * engine picker and capability-aware action gating.
 */
import type { AnalysisEngineId, EngineCapabilities, EngineDescriptor } from '@rh/protocol';
import type { EngineRegistry } from './registry.js';

export interface EnginesControllerDeps {
  readonly registry: EngineRegistry;
}

export class EnginesController {
  constructor(private readonly deps: EnginesControllerDeps) {}

  async list(): Promise<EngineDescriptor[]> {
    return this.deps.registry.list();
  }

  async capabilities(engineId: AnalysisEngineId): Promise<EngineCapabilities | null> {
    const description = await this.deps.registry.describe(engineId);
    return description.capabilities;
  }
}
