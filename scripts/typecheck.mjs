#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const tsc = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url));
const projects = ['packages/protocol', 'apps/main', 'apps/preload', 'apps/renderer'];
if (process.argv.includes('--all')) projects.push('packages/engine-parsers');
for (const project of projects) {
  const result = spawnSync(process.execPath, [tsc, '--noEmit', '-p', project], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
