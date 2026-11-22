import { join } from 'node:path';
import type { EngineCapabilities } from '@rh/protocol';
import { supportDir } from '../../binaries/paths.js';
import { ALL_FALSE, type ExecuteBinary } from '../probe.js';

export function jscSupportPath(): string | undefined {
  return process.platform === 'win32' ? join(supportDir('webkit-requirements'), 'bin64') : undefined;
}

export async function probeJscBinary(exePath: string, execute: ExecuteBinary): Promise<EngineCapabilities> {
  const { code, stdout, stderr } = await execute(exePath, ['--options'], { pathPrepend: jscSupportPath() });
  if (code !== 0) {
    return { ...ALL_FALSE, notes: [`not a valid JavaScriptCore shell (option probe failed: exit ${String(code)})`] };
  }
  const options = `${stdout}\n${stderr}`;
  return {
    ...ALL_FALSE,
    bytecodeDump: /^\s*dumpGeneratedBytecodes=/m.test(options),
    deoptTrace: /^\s*printEachOSRExit=/m.test(options),
    gcLog: /^\s*logGC=/m.test(options)
  };
}
