import { existsSync, promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import { arch, cpus, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import {
  PerformanceCatalogResponseSchema,
  PerformanceEventSchema,
  PerformanceRunResultSchema,
  type PerformanceCancelResponse,
  type PerformanceCase,
  type PerformanceCaseResult,
  type PerformanceCatalogResponse,
  type PerformanceComparison,
  type PerformanceEvent,
  type PerformanceProfileOption,
  type PerformanceProfileRef,
  type PerformanceRawSample,
  type PerformanceRunResult,
  type PerformanceStartRequest,
  type PerformanceStartResponse,
  type PerformanceTargetOption,
  type PerformanceTargetRef
} from '@rh/protocol';
import type { RuntimeId } from '@rh/protocol';
import { RuntimeRegistry } from '../runtimes/runtime-adapter.js';
import { ProcessRunner, type RunHandle } from '../execution/process-runner.js';
import { workspaceRoot } from '../workspace/files.js';

const require = createRequire(__filename);
const MAX_BODY_LENGTH = 200_000;
const PERF_PREFIX = '__RH_PERF__';

interface ResolvedProfile {
  readonly ref: PerformanceProfileRef;
  readonly flags: string[];
}

export interface ResolvedPerformanceTarget {
  readonly ref: PerformanceTargetRef;
  readonly executable: string;
  readonly runtimeId: RuntimeId;
  readonly runtimeVersion: string;
  readonly engineId: 'v8' | 'javascriptcore';
  readonly engineVersion?: string;
}

export interface PerformanceTargetResolver {
  resolve(ref: PerformanceTargetRef): Promise<ResolvedPerformanceTarget | null>;
  catalog(): Promise<PerformanceCatalogResponse>;
  resolveProfile(target: ResolvedPerformanceTarget, profile: PerformanceProfileRef): Promise<ResolvedProfile | null>;
}

const NATURAL_PROFILE: PerformanceProfileOption = {
  id: 'natural', label: 'Natural tiering', description: 'Runtime defaults; all normal engine tiers may participate.',
  available: true, classification: 'stable'
};

export class RegistryPerformanceTargetResolver implements PerformanceTargetResolver {
  private readonly v8Options = new Map<string, Promise<string>>();

  constructor(private readonly runtimes: RuntimeRegistry) {}

  async resolve(ref: PerformanceTargetRef): Promise<ResolvedPerformanceTarget | null> {
    if (ref.source !== 'runtime') throw new Error(`engine target '${ref.id}' is not executable through the runtime registry`);
    // The embedded browser lane is a general-purpose Web API environment,
    // not a child-process target for the benchmark harness.
    if (ref.id === 'browser') throw new Error("runtime 'browser' is not available in Performance Lab");
    if (!this.runtimes.ids().includes(ref.id)) throw new Error(`runtime '${ref.id}' is not registered`);
    const runtimeId = ref.id as Exclude<RuntimeId, 'browser'>;
    const runtime = this.runtimes.get(runtimeId);
    if (runtime === null) return null;
    const resolved = await runtime.resolveExecutable(ref.version);
    if (resolved === null) return null;
    return {
      ref: { ...ref, version: resolved.version }, executable: resolved.exePath, runtimeId,
      runtimeVersion: resolved.version, engineId: runtimeId === 'bun' ? 'javascriptcore' : 'v8'
    };
  }

  async catalog(): Promise<PerformanceCatalogResponse> {
    const targets: PerformanceTargetOption[] = [];
    for (const id of this.runtimes.ids() as Exclude<RuntimeId, 'browser'>[]) {
      const runtime = this.runtimes.get(id);
      if (runtime === null) continue;
      const refs: PerformanceTargetRef[] = [];
      const system = await runtime.resolveExecutable('system').catch(() => null);
      if (system !== null) refs.push({ source: 'runtime', id, version: 'system', provenance: 'system' });
      for (const version of await runtime.installedVersions().catch(() => [])) {
        refs.push({ source: 'runtime', id, version, provenance: 'managed' });
      }
      if (refs.length === 0) refs.push({ source: 'runtime', id, provenance: 'auto' });
      const seen = new Set<string>();
      for (const ref of refs) {
        const resolved = await this.resolve(ref).catch(() => null);
        const key = resolved === null ? `${id}:${ref.version ?? 'auto'}` : `${id}:${resolved.executable}:${resolved.runtimeVersion}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const profiles = resolved === null ? [NATURAL_PROFILE] : await this.profilesFor(resolved);
        targets.push({
          ref, label: `${runtimeLabel(id)} ${resolved?.runtimeVersion ?? ref.version ?? ''}`.trim(),
          available: resolved !== null, reason: resolved === null ? `${runtimeLabel(id)} is not installed` : null,
          runtimeId: id, runtimeVersion: resolved?.runtimeVersion ?? null,
          engineId: id === 'bun' ? 'javascriptcore' : 'v8', profiles
        });
      }
    }
    return PerformanceCatalogResponseSchema.parse({ targets });
  }

  async resolveProfile(target: ResolvedPerformanceTarget, profile: PerformanceProfileRef): Promise<ResolvedProfile | null> {
    const option = (await this.profilesFor(target)).find((item) => item.id === profile.id && item.available);
    if (option === undefined) return null;
    const flags = profileFlags(target.runtimeId, option.id);
    return { ref: { id: option.id, label: option.label }, flags };
  }

  private async profilesFor(target: ResolvedPerformanceTarget): Promise<PerformanceProfileOption[]> {
    if (target.runtimeId !== 'node') return [
      { ...NATURAL_PROFILE, label: target.runtimeId === 'bun' ? 'Natural JSC' : 'Natural V8' }
    ];
    const options = await this.readV8Options(target.executable);
    const supports = (name: string): boolean => new RegExp(`--(?:\\[no-\\])?${name}(?:\\s|$)`, 'm').test(options);
    return [
      { ...NATURAL_PROFILE, label: 'Natural V8' },
      { id: 'jitless', label: 'JITless', description: 'V8 executable-memory generation disabled; useful as an interpreter-oriented baseline.', available: supports('jitless'), classification: 'stable' },
      { id: 'baseline-ceiling', label: 'Baseline ceiling', description: 'Optimizing compiler disabled while baseline compilation remains available.', available: supports('opt'), classification: 'internal' },
      { id: 'maglev-disabled', label: 'Maglev disabled', description: 'Natural V8 tiering with the Maglev mid-tier disabled.', available: supports('maglev'), classification: 'experimental' }
    ];
  }

  private readV8Options(executable: string): Promise<string> {
    const cached = this.v8Options.get(executable);
    if (cached !== undefined) return cached;
    const pending = new Promise<string>((resolve) => {
      execFile(executable, ['--v8-options'], {
        windowsHide: true, timeout: 8_000, maxBuffer: 8 * 1024 * 1024,
        env: { SystemRoot: process.env['SystemRoot'], windir: process.env['windir'], PATH: `${dirname(executable)};${join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32')}` }
      }, (error, stdout, stderr) => resolve(error && !stdout ? stderr : `${stdout}\n${stderr}`));
    });
    this.v8Options.set(executable, pending);
    return pending;
  }
}

interface ActivePerformanceRun { readonly requestId: string; handle: RunHandle | null; cancelled: boolean }
export interface PerformanceManagerDeps {
  readonly targetResolver: PerformanceTargetResolver;
  readonly emit: (event: PerformanceEvent) => void;
  readonly createRunner?: () => ProcessRunner;
  readonly randomSeed?: () => number;
}

interface ChildSampleMessage { type: 'sample'; sample: PerformanceRawSample }
interface ChildWarmupMessage { type: 'warmup'; round: number }
interface ChildResultMessage { type: 'result'; result: PerformanceRunResult }
type ChildMessage = ChildSampleMessage | ChildWarmupMessage | ChildResultMessage;
class PerformanceExecutionError extends Error {
  constructor(message: string, readonly partialResults: PerformanceCaseResult[]) { super(message); }
}

export class PerformanceManager {
  private readonly runner: ProcessRunner;
  private readonly active = new Map<string, ActivePerformanceRun>();
  constructor(private readonly deps: PerformanceManagerDeps) { this.runner = deps.createRunner?.() ?? new ProcessRunner(); }

  catalog(): Promise<PerformanceCatalogResponse> { return this.deps.targetResolver.catalog(); }

  async start(req: PerformanceStartRequest): Promise<PerformanceStartResponse> {
    if (this.active.size > 0) throw new Error('a Performance Lab experiment is already active');
    for (const item of req.cases) if (item.body.length > MAX_BODY_LENGTH) throw new Error(`case '${item.label}' is too large`);
    const totalGroups = req.targets.reduce((sum, item) => sum + item.profiles.length, 0);
    const active: ActivePerformanceRun = { requestId: req.requestId, handle: null, cancelled: false };
    this.active.set(req.requestId, active);
    void this.execute(req, active, totalGroups);
    return { accepted: true, requestId: req.requestId, totalGroups, totalCells: totalGroups * req.cases.length };
  }

  async cancel(requestId: string): Promise<PerformanceCancelResponse> {
    const active = this.active.get(requestId);
    if (active === undefined) return { ok: false };
    active.cancelled = true;
    if (active.handle !== null) await active.handle.cancel();
    return { ok: true };
  }

  private send(event: PerformanceEvent): void { this.deps.emit(PerformanceEventSchema.parse(event)); }

  private async execute(req: PerformanceStartRequest, active: ActivePerformanceRun, totalGroups: number): Promise<void> {
    let completedGroups = 0;
    let failedGroups = 0;
    try {
      for (const selection of req.targets) {
        if (active.cancelled) break;
        const target = await this.deps.targetResolver.resolve(selection.target);
        for (const requestedProfile of selection.profiles) {
          if (active.cancelled) break;
          const groupId = groupKey(selection.target, requestedProfile);
          if (target === null) {
            failedGroups++;
            this.send({ type: 'cell-error', requestId: req.requestId, groupId, target: selection.target, profile: requestedProfile, message: `target '${selection.target.id} ${selection.target.version ?? ''}' is not available`, partialResults: [] });
            continue;
          }
          const profile = await this.deps.targetResolver.resolveProfile(target, requestedProfile);
          if (profile === null) {
            failedGroups++;
            this.send({ type: 'cell-error', requestId: req.requestId, groupId, target: target.ref, profile: requestedProfile, message: `profile '${requestedProfile.id}' is unavailable for ${target.runtimeId} ${target.runtimeVersion}`, partialResults: [] });
            continue;
          }
          this.send({ type: 'progress', requestId: req.requestId, groupId, phase: 'resolving', completed: completedGroups, total: totalGroups, message: `starting ${target.runtimeId} ${target.runtimeVersion} / ${profile.ref.label ?? profile.ref.id}` });
          try {
            const result = await this.runGroup(req, active, target, profile, groupId);
            if (active.cancelled) break;
            completedGroups++;
            this.send({ type: 'result', requestId: req.requestId, result });
          } catch (error) {
            if (active.cancelled) break;
            failedGroups++;
            const message = error instanceof Error ? error.message : String(error);
            this.send({ type: 'cell-error', requestId: req.requestId, groupId, target: target.ref, profile: profile.ref, message, partialResults: error instanceof PerformanceExecutionError ? error.partialResults : [] });
          }
        }
      }
      const status = active.cancelled ? 'cancelled' : completedGroups === 0 ? 'failed' : failedGroups > 0 ? 'partial' : 'completed';
      this.send({ type: 'done', requestId: req.requestId, status, completedGroups, totalGroups });
    } catch (error) {
      const status = active.cancelled ? 'cancelled' : 'failed';
      if (!active.cancelled) {
        const message = error instanceof Error ? error.message : String(error);
        this.send({ type: 'cell-error', requestId: req.requestId, groupId: 'experiment', target: req.targets[0]?.target ?? { source: 'runtime', id: 'unknown' }, profile: req.targets[0]?.profiles[0] ?? { id: 'unknown' }, message, partialResults: [] });
      }
      this.send({ type: 'done', requestId: req.requestId, status, completedGroups, totalGroups });
    } finally {
      this.active.delete(req.requestId);
    }
  }

  private async runGroup(req: PerformanceStartRequest, active: ActivePerformanceRun, target: ResolvedPerformanceTarget, profile: ResolvedProfile, groupId: string): Promise<PerformanceRunResult> {
    const root = workspaceRoot(req.workspaceId);
    await fs.mkdir(join(root, '.rhbuild'), { recursive: true });
    const dir = await fs.mkdtemp(join(root, '.rhbuild', 'performance-run-'));
    const harnessPath = join(dir, 'group.mjs');
    const seed = (this.deps.randomSeed?.() ?? Math.floor(Math.random() * 0x7fffffff)) >>> 0;
    const mitataModule = await materializeMitataModule(dir);
    await fs.writeFile(harnessPath, buildHarness(req, seed, target, profile, groupId, mitataModule), 'utf8');

    const stderr: string[] = [];
    const samples = new Map<string, PerformanceRawSample[]>();
    let finalResult: PerformanceRunResult | null = null;
    let measurementDone = 0;
    let pending = '';
    const acceptLine = (line: string): void => {
      const trimmed = line.trim();
      if (!trimmed.startsWith(PERF_PREFIX)) return;
      this.acceptChildMessage(trimmed.slice(PERF_PREFIX.length), samples,
        (value) => { finalResult = value; },
        (sample) => {
          measurementDone++;
          this.send({ type: 'progress', requestId: req.requestId, groupId, phase: 'measurement', completed: measurementDone, total: req.measurement.samples * req.cases.length, message: `${target.runtimeId} / ${profile.ref.label ?? profile.ref.id}: ${sample.caseId}` });
        },
        (round) => this.send({ type: 'progress', requestId: req.requestId, groupId, phase: 'warmup', completed: round + 1, total: Math.max(1, req.measurement.warmupRounds), message: `warmup ${round + 1}/${req.measurement.warmupRounds}` })
      );
    };
    const parseOutput = (chunk: string): void => {
      pending += chunk;
      let newline = pending.indexOf('\n');
      while (newline !== -1) { acceptLine(pending.slice(0, newline)); pending = pending.slice(newline + 1); newline = pending.indexOf('\n'); }
    };
    const off = this.runner.onEvent((event) => {
      if (active.handle?.runId !== event.runId) return;
      if (event.type === 'stdout') parseOutput(event.data);
      else if (event.type === 'stderr' && stderr.join('').length < 100_000) stderr.push(event.data);
    });
    try {
      const handle = this.runner.run({ exePath: target.executable, args: launchArgs(target.runtimeId, harnessPath, profile.flags), cwd: dir, timeoutMs: req.measurement.timeoutMs });
      active.handle = handle;
      if (active.cancelled) await handle.cancel();
      const processResult = await handle.result;
      if (pending.trim() !== '') acceptLine(pending);
      if (active.cancelled || processResult.status === 'cancelled') throw new Error('benchmark group cancelled');
      if (processResult.status === 'timeout') throw new Error(`benchmark group timed out after ${req.measurement.timeoutMs} ms`);
      if (processResult.status !== 'completed' || processResult.exitCode !== 0) {
        throw new PerformanceExecutionError(stderr.join('').trim() || `benchmark child exited with code ${processResult.exitCode ?? 'unknown'}`, buildPartialResults(req.cases, [...samples.values()].flat()));
      }
      if (finalResult === null) throw new Error(`benchmark child returned no structured result${stderr.length ? `: ${stderr.join('').trim()}` : ''}`);
      const parsed: PerformanceRunResult = PerformanceRunResultSchema.parse(finalResult);
      const baseline = parsed.results[0];
      return {
        ...parsed,
        comparisons: baseline === undefined ? [] : parsed.results.slice(1).map((candidate) => comparePairedSamples(baseline.samples, candidate.samples, baseline.caseId, candidate.caseId, parsed.scheduleSeed))
      };
    } finally {
      off(); active.handle = null;
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private acceptChildMessage(raw: string, samples: Map<string, PerformanceRawSample[]>, onResult: (result: PerformanceRunResult) => void, onSample: (sample: PerformanceRawSample) => void, onWarmup: (round: number) => void): void {
    try {
      const parsed = JSON.parse(raw) as ChildMessage;
      if (parsed.type === 'sample') { const own = samples.get(parsed.sample.caseId) ?? []; own.push(parsed.sample); samples.set(parsed.sample.caseId, own); onSample(parsed.sample); }
      else if (parsed.type === 'warmup') onWarmup(parsed.round);
      else if (parsed.type === 'result') onResult(PerformanceRunResultSchema.parse(parsed.result));
    } catch { /* malformed output is diagnosed when the terminal result is missing */ }
  }
}

function resolveMitataModule(): string {
  const bundled = join(__dirname, 'mitata', 'src', 'lib.mjs');
  if (existsSync(bundled)) return bundled;
  if (typeof process.versions.electron === 'string' && process.defaultApp !== true) throw new Error('Performance Lab kernel assets are missing; rebuild RuntimeHell');
  return join(dirname(require.resolve('mitata')), 'lib.mjs');
}

async function materializeMitataModule(runDir: string): Promise<string> {
  const destination = join(runDir, 'mitata-lib.mjs');
  await fs.copyFile(resolveMitataModule(), destination);
  return destination;
}

function buildHarness(req: PerformanceStartRequest, seed: number, target: ResolvedPerformanceTarget, profile: ResolvedProfile, groupId: string, mitataModule: string): string {
  const payload = JSON.stringify(req.cases.map((item) => ({ id: item.id, label: item.label, body: item.body })));
  const environment = JSON.stringify({
    platform: platform(), arch: arch(), cpu: cpus()[0]?.model ?? 'unknown', logicalCores: Math.max(1, cpus().length),
    runtimeId: target.runtimeId, runtimeVersion: target.runtimeVersion, engineId: target.engineId,
    engineVersion: target.engineVersion, executable: target.executable, flags: profile.flags
  });
  const factoryBody = `${req.setup}\nreturn [${req.cases.map((item) => `function __rh_${safeIdentifier(item.id)}() { return (function () {\n${item.body}\n})(); }`).join(',\n')}];`;
  return `import { measure, do_not_optimize } from ${JSON.stringify(pathToFileURL(mitataModule).href)};
const cases = ${payload};
const seed = ${seed};
const sampleCount = ${req.measurement.samples};
const warmupRounds = ${req.measurement.warmupRounds};
const iterationsPerSample = ${req.measurement.iterationsPerSample};
const environment = ${environment};
const prefix = ${JSON.stringify(PERF_PREFIX)};
const emit = (value) => console.log(prefix + JSON.stringify(value));
const runners = new Function('do_not_optimize', ${JSON.stringify(factoryBody)})(do_not_optimize);
const rawSamples = [];
const orderFor = (round) => { const start = (seed + round) % runners.length; return runners.map((_, index) => (start + index) % runners.length); };
try {
  for (let round = 0; round < warmupRounds; round++) {
    for (const index of orderFor(round)) for (let iteration = 0; iteration < iterationsPerSample; iteration++) do_not_optimize(runners[index]());
    emit({ type: 'warmup', round });
  }
  for (let round = 0; round < sampleCount; round++) {
    let orderIndex = 0;
    for (const index of orderFor(round)) {
      const stats = await measure(() => { for (let iteration = 0; iteration < iterationsPerSample; iteration++) do_not_optimize(runners[index]()); }, { min_samples: 1, max_samples: 1, min_cpu_time: 0, warmup_samples: 0 });
      const durationNs = Number(stats.samples[0] ?? stats.p50 ?? stats.avg ?? 0);
      const sample = { caseId: cases[index].id, round, durationNs, iterations: iterationsPerSample, orderIndex };
      rawSamples.push(sample); emit({ type: 'sample', sample }); orderIndex++;
    }
  }
  const results = cases.map((item) => { const own = rawSamples.filter((sample) => sample.caseId === item.id); const computed = metrics(own); return { caseId: item.id, label: item.label, metrics: computed, samples: own, warnings: warnings(item.body, computed) }; });
  const engineVersion = environment.engineId === 'javascriptcore'
    ? (globalThis.Bun?.revision ?? globalThis.Bun?.version ?? undefined)
    : (globalThis.Deno?.version?.v8 ?? globalThis.process?.versions?.v8 ?? undefined);
  emit({ type: 'result', result: { requestId: ${JSON.stringify(req.requestId)}, groupId: ${JSON.stringify(groupId)}, target: ${JSON.stringify(target.ref)}, profile: ${JSON.stringify(profile.ref)}, environment: { ...environment, ...(engineVersion ? { engineVersion } : {}) }, results, comparisons: [], scheduleSeed: seed, rounds: sampleCount } });
} catch (error) { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); globalThis.process ? (process.exitCode = 1) : Deno.exit(1); }

function metrics(items) {
  const values = items.map((item) => item.durationNs / item.iterations).filter(Number.isFinite).sort((a, b) => a - b);
  const percentile = (p) => values.length ? values[Math.min(values.length - 1, Math.round((values.length - 1) * p))] : 0;
  const mean = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  const variance = values.length > 1 ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1) : 0;
  return { minNsPerOp: values[0] ?? 0, meanNsPerOp: mean, medianNsPerOp: percentile(.5), p75NsPerOp: percentile(.75), p95NsPerOp: percentile(.95), p99NsPerOp: percentile(.99), maxNsPerOp: values[values.length - 1] ?? 0, stddevNsPerOp: Math.sqrt(variance), throughput: mean > 0 ? 1e9 / mean : 0, sampleCount: values.length, totalIterations: items.reduce((sum, item) => sum + item.iterations, 0) };
}
function warnings(body, value) {
  const out = [];
  if (!/\\breturn\\b/.test(body) && !body.includes('do_not_optimize')) out.push({ code: 'no-observable-result', message: 'No explicit return value; confirm the measured work cannot be eliminated.' });
  if (value.meanNsPerOp > 0 && value.stddevNsPerOp / value.meanNsPerOp > .2) out.push({ code: 'high-variance', message: 'High variance (>20%); increase samples or reduce system load.' });
  if (value.medianNsPerOp < 1) out.push({ code: 'timer-saturation', message: 'Sub-nanosecond result is suspicious; increase cycles per sample.' });
  return out;
}`;
}

function launchArgs(runtimeId: RuntimeId, harnessPath: string, flags: readonly string[]): string[] {
  if (runtimeId === 'deno') return ['run', '--quiet', ...(flags.length ? [`--v8-flags=${flags.join(',')}`] : []), harnessPath];
  return [...flags, harnessPath];
}
function profileFlags(runtimeId: RuntimeId, profileId: string): string[] {
  if (runtimeId !== 'node') return [];
  if (profileId === 'jitless') return ['--jitless'];
  if (profileId === 'baseline-ceiling') return ['--no-opt'];
  if (profileId === 'maglev-disabled') return ['--no-maglev'];
  return [];
}
function runtimeLabel(id: RuntimeId): string { return id === 'node' ? 'Node.js' : id === 'deno' ? 'Deno' : 'Bun'; }
function groupKey(target: PerformanceTargetRef, profile: PerformanceProfileRef): string { return `${target.source}:${target.id}:${target.version ?? 'auto'}:${profile.id}`; }
function safeIdentifier(value: string): string { return value.replace(/[^a-zA-Z0-9_$]/g, '_').replace(/^[^a-zA-Z_$]/, '_$&'); }

function buildPartialResults(cases: readonly PerformanceCase[], samples: readonly PerformanceRawSample[]): PerformanceCaseResult[] {
  return cases.map((item) => {
    const own = samples.filter((sample) => sample.caseId === item.id);
    return own.length ? { caseId: item.id, label: item.label, metrics: metricsFor(own), samples: own, warnings: [{ code: 'partial-run', message: 'Benchmark stopped before all planned samples completed.' }] } : null;
  }).filter((item): item is PerformanceCaseResult => item !== null);
}
function metricsFor(items: readonly PerformanceRawSample[]) {
  const values = items.map((item) => item.durationNs / item.iterations).sort((a, b) => a - b);
  const percentile = (p: number): number => values.length ? values[Math.min(values.length - 1, Math.round((values.length - 1) * p))] ?? 0 : 0;
  const mean = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  const variance = values.length > 1 ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1) : 0;
  return { minNsPerOp: values[0] ?? 0, meanNsPerOp: mean, medianNsPerOp: percentile(.5), p75NsPerOp: percentile(.75), p95NsPerOp: percentile(.95), p99NsPerOp: percentile(.99), maxNsPerOp: values[values.length - 1] ?? 0, stddevNsPerOp: Math.sqrt(variance), throughput: mean > 0 ? 1e9 / mean : 0, sampleCount: values.length, totalIterations: items.reduce((sum, item) => sum + item.iterations, 0) };
}

export function comparePairedSamples(baseline: readonly PerformanceRawSample[], candidate: readonly PerformanceRawSample[], baselineCaseId: string, candidateCaseId: string, seed = 1): PerformanceComparison {
  const right = new Map(candidate.map((item) => [item.round, item.durationNs / item.iterations]));
  const ratios = baseline.map((item) => { const left = item.durationNs / item.iterations; const value = right.get(item.round); return left > 0 && value !== undefined && value > 0 ? value / left : null; }).filter((value): value is number => value !== null);
  const sorted = [...ratios].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  if (ratios.length < 3) return { baselineCaseId, candidateCaseId, medianRatio: median, percentChange: (median - 1) * 100, confidenceLow: 0, confidenceHigh: 0, significance: 'insufficient-data' };
  let state = seed >>> 0;
  const next = (): number => { state = (Math.imul(1664525, state) + 1013904223) >>> 0; return state / 0x100000000; };
  const boot: number[] = [];
  for (let run = 0; run < 1000; run++) { const sample: number[] = []; for (let index = 0; index < ratios.length; index++) sample.push(ratios[Math.floor(next() * ratios.length)] ?? 0); sample.sort((a, b) => a - b); boot.push(sample[Math.floor(sample.length / 2)] ?? median); }
  boot.sort((a, b) => a - b);
  const low = boot[Math.floor(boot.length * .025)] ?? median;
  const high = boot[Math.floor(boot.length * .975)] ?? median;
  return { baselineCaseId, candidateCaseId, medianRatio: median, percentChange: (median - 1) * 100, confidenceLow: low, confidenceHigh: high, significance: high < 1 ? 'candidate-faster' : low > 1 ? 'baseline-faster' : 'indistinguishable' };
}
