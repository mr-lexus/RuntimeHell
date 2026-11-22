import { expect, it } from 'vitest';
import { trackedProcessIsolation } from './isolation.js';

it('does not launch an engine after cancellation during preparation', async () => {
  const run = trackedProcessIsolation({ isLive: () => false, emit: () => {}, registerCancel: () => {} }, 'cancelled-request');
  await expect(run({ exePath: process.execPath, args: ['-e', 'console.log(42)'], cwd: process.cwd(), timeoutMs: 3_000 })).rejects.toThrow(/cancel/i);
});
