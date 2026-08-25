/**
 * Shared cancel-aware process isolation (extracted in todo 23/24 so both the
 * V8 and SpiderMonkey adapters use identical runner semantics).
 *
 * The returned IsolatedRun registers its kill-hook through ctx.registerCancel
 * for the duration of the run, so AnalysisManager.cancel can tree-kill the
 * engine process mid-analysis.
 */
import type { AnalysisContext } from '../engines/engine-adapter.js';

export interface IsolatedRunOptions {
  exePath: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  /** Extra PATH directories prepended for this child only. */
  pathPrepend?: string[];
  /** Extra environment variables merged over the sanitized base. */
  extraEnv?: Record<string, string>;
}
export interface IsolatedRunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export type IsolatedRun = (options: IsolatedRunOptions) => Promise<IsolatedRunResult>;

export function trackedProcessIsolation(ctx: AnalysisContext, requestId: string): IsolatedRun {
  return async (options) => {
    const { ProcessRunner } = await import('../execution/process-runner.js');
    const runner = new ProcessRunner();
    const out: string[] = [];
    const err: string[] = [];
    const off = runner.onEvent((e) => {
      if (e.type === 'stdout') out.push(e.data);
      else if (e.type === 'stderr') err.push(e.data);
    });
    const handle = runner.run({
      exePath: options.exePath,
      args: options.args,
      cwd: options.cwd,
      timeoutMs: options.timeoutMs,
      pathPrepend: options.pathPrepend,
      extraEnv: options.extraEnv
    });
    ctx.registerCancel(async () => {
      await handle.cancel();
    });
    try {
      const result = await handle.result;
      return {
        code: result.exitCode,
        stdout: out.join(''),
        stderr: err.join(''),
        timedOut: result.status === 'timeout'
      };
    } finally {
      off();
    }
  };
}
