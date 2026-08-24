/**
 * EnginesController (plan todo 19): read-only surface for the drawer's
 * engine picker and capability-aware action gating.
 */
import type { EngineCapabilities, EngineId } from '@rh/protocol';
import type { EngineRegistry } from './registry.js';

export interface EnginesControllerDeps {
  readonly registry: EngineRegistry;
}

export class EnginesController {
  constructor(private readonly deps: EnginesControllerDeps) {}

  async list(): Promise<
    { id: string; version: string | null; binaryPath: string | null; capabilities: EngineCapabilities | null; reason: string | null }[]
  > {
    return this.deps.registry.list();
  }

  async capabilities(engineId: string): Promise<EngineCapabilities | null> {
    const description = await this.deps.registry.describe(engineId as EngineId | 'd8-debug');
    return description.capabilities;
  }
}
