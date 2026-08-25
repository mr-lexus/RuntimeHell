/**
 * Capability probe for the SpiderMonkey js shell (plan todo 24).
 *
 * VERIFIED against real jsshell 140.14.0esr (win64, taskcluster):
 *  - `dis()` builtin REMOVED in modern SM shells (drift vs older docs)
 *  - `dumpStencil(src)` is a no-op without an internally-flagged build
 *  - `hasDisassembler()` returns false on release builds
 * ⇒ stock shells: astDump=true (Reflect.parse), bytecodeDump=false with an
 *   explicit C-lane note. Debug/custom builds would flip these via probes.
 */
import type { EngineCapabilities } from '@rh/protocol';
import { realExecutor, type ExecuteBinary } from './probe.js';

export const ALL_FALSE_SM: EngineCapabilities = {
  astDump: false,
  bytecodeDump: false,
  optCodeDisasm: false,
  irGraphDump: false,
  deoptTrace: false,
  gcLog: false,
  profileSampling: false,
  perFunctionFilter: false,
  notes: []
};

const STOCK_NOTE =
  'stock SM shell cannot dump bytecode — requires a debug/custom build (see docs/custom-builds.md)';

async function runScript(
  execute: ExecuteBinary,
  exePath: string,
  scriptContent: string
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const dir = await mkdtemp(join(tmpdir(), 'rh-sm-probe-'));
  const scriptFile = join(dir, 'probe.js');
  await writeFile(scriptFile, scriptContent, 'utf8');
  try {
    return await execute(exePath, [scriptFile], { cwd: dir });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function probeSmBinary(exePath: string, execute: ExecuteBinary = realExecutor): Promise<EngineCapabilities> {
  // Liveness: print() must exist and echo our marker.
  const live = await runScript(execute, exePath, "print('[RH_PROBE_OK]');");
  if (live.code !== 0 || !live.stdout.includes('[RH_PROBE_OK]')) {
    return {
      ...ALL_FALSE_SM,
      notes: [`not a valid engine binary (liveness probe failed: exit ${String(live.code)})`]
    };
  }

  // AST: Reflect.parse must exist AND parse trivial code successfully.
  const ast = await runScript(
    execute,
    exePath,
    "print(JSON.stringify(Reflect.parse('1+1', { loc: true })) ? '[RH_AST_OK]' : '[RH_AST_NO]');"
  );
  const astDump = ast.code === 0 && ast.stdout.includes('[RH_AST_OK]');

  const caps: EngineCapabilities = {
    ...ALL_FALSE_SM,
    astDump,
    notes: [
      'Raw output is authoritative; normalized views are best-effort.',
      'Capability results are cached per binary sha256.',
      STOCK_NOTE
    ]
  };
  if (!astDump) caps.notes.push('Reflect.parse unavailable on this binary');
  return caps;
}
