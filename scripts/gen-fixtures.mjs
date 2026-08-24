#!/usr/bin/env node
/**
 * Regenerate V8 golden fixtures from a REAL d8-debug binary (plan todo 18).
 * Cross-platform env pre-set wrapper around the gated vitest generator.
 */
import { spawnSync } from 'node:child_process';

const result = spawnSync(
  'pnpm',
  ['vitest', 'run', 'packages/engine-parsers/src/gen-fixtures.test.ts'],
  {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, RH_NET_TESTS: '1', RH_GEN_FIXTURES: '1' }
  }
);
process.exit(result.status ?? 1);
