import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@rh/protocol': resolve(process.cwd(), 'packages/protocol/src/index.ts')
    }
  },
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    environment: 'node',
    // Integration tests that need real downloaded binaries skip themselves
    // when the cache is cold; CI on clean machines stays green (plan: Verification strategy).
    testTimeout: 30000
  }
});
