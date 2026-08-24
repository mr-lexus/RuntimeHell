'use strict';
/**
 * One-shot fd-3 passthrough probe (plan todo 10).
 *
 * Parent spawns: `<exe> --require probe-fd3.cjs` with stdio[3] = pipe.
 * Success contract: marker line written to fd 3 AND exit code 0.
 * Any failure (EBADF, closed pipe, hostile exe): silent non-zero exit,
 * which the parent maps to transport='stderr'.
 */

try {
  require('fs').writeSync(3, '__RH_PROBE__ok\n');
  process.exit(0);
} catch (e) {
  // no-excuse-ok: catch — a probe must never surface its own failure; the
  // non-zero exit code IS the failure signal consumed by fd3-probe.ts.
  process.exit(1);
}
