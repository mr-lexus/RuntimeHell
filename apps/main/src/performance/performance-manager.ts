import { existsSync, promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import { arch, cpus, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { execFile } from 'node:child_process';
import { build, type BuildFailure } from 'esbuild';
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
  type PerformanceTargetRef,
  type BinaryManifest,
  type ManifestEntry,
  type NvmInfo
} from '@rh/protocol';
import { RuntimeRegistry } from '../runtimes/runtime-adapter.js';
import { ProcessRunner, type RunHandle } from '../execution/process-runner.js';
import { workspaceRoot } from '../workspace/files.js';
import { readManifest } from '../binaries/binary-manager.js';
import { detectNvmNode, detectSystemBrowser, type BrowserId, type DetectedRuntime } from '../runtimes/runtime-detection.js';
import { EmbeddedBrowserRuntime, type BrowserRuntimeRunner } from '../runtimes/browser/browser-runtime.js';
import { ExternalBrowserRuntime } from './external-browser-runner.js';
import { executableName, pathListSeparator } from '../platform.js';

const require = createRequire(__filename);
const MAX_BODY_LENGTH = 200_000;
const PERF_PREFIX = '__RH_PERF__';

interface ResolvedProfile {
  readonly ref: PerformanceProfileRef;
  readonly flags: string[];
  readonly extraEnv: Record<string, string>;
}

export interface ResolvedPerformanceTarget {
  readonly ref: PerformanceTargetRef;
  readonly executable: string;
  readonly runtimeId: string;
  readonly runtimeVersion: string;
  readonly engineId: string;
  readonly engineVersion?: string;
  readonly launchKind?: 'node' | 'deno' | 'bun' | 'embedded-browser' | 'external-browser' | 'shell';
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

const BROWSER_IDS: readonly BrowserId[] = ['chrome', 'firefox'];
const MANAGED_EXECUTABLES: Readonly<Record<string, string>> = {
  node: executableName('node'), deno: executableName('deno'), bun: executableName('bun'), txiki: executableName('tjs'),
  v8: executableName('d8'), 'd8-debug': executableName('d8'), spidermonkey: executableName('js'), javascriptcore: executableName('jsc'),
  quickjs: executableName('qjs'), graaljs: join('bin', executableName('js')), hermes: executableName('hermes'), chakra: executableName('ch'), 'moddable-xs': executableName('xst')
};

export interface PerformanceInventoryDeps {
  readonly readManifest?: () => Promise<BinaryManifest>;
  readonly detectNvm?: () => Promise<NvmInfo | null>;
  readonly detectBrowser?: (id: BrowserId) => Promise<DetectedRuntime | null>;
}

interface PerformanceInventory {
  readonly manifest: BinaryManifest;
  readonly nvm: NvmInfo | null;
  readonly browsers: ReadonlyMap<BrowserId, DetectedRuntime | null>;
}

export class RegistryPerformanceTargetResolver implements PerformanceTargetResolver {
  private readonly v8Options = new Map<string, Promise<string>>();

  constructor(private readonly runtimes: RuntimeRegistry, private readonly inventoryDeps: PerformanceInventoryDeps = {}) {}

  async resolve(ref: PerformanceTargetRef): Promise<ResolvedPerformanceTarget | null> {
    if (ref.source === 'runtime' && ref.id === 'browser') return embeddedBrowserTarget(ref);
    if (ref.source === 'runtime' && BROWSER_IDS.includes(ref.id as BrowserId)) {
      const detected = await (this.inventoryDeps.detectBrowser?.(ref.id as BrowserId) ?? detectSystemBrowser(ref.id as BrowserId));
      return detected === null ? null : externalBrowserTarget(ref, detected);
    }
    if (ref.source === 'runtime' && ref.id === 'node' && ref.provenance === 'nvm') {
      const nvm = await (this.inventoryDeps.detectNvm?.() ?? detectNvmNode());
      const selected = nvm?.versions.find((item) => item.version === ref.version);
      return selected === undefined ? null : runtimeTarget(ref, selected.exePath, selected.version, 'node');
    }
    if (ref.source === 'runtime' && this.runtimes.ids().includes(ref.id)) {
      const runtime = this.runtimes.get(ref.id as 'node' | 'deno' | 'bun');
      if (runtime === null) return null;
      const resolved = await runtime.resolveExecutable(ref.version);
      return resolved === null ? null : runtimeTarget(ref, resolved.exePath, resolved.version, runtime.id);
    }
    const manifest = await (this.inventoryDeps.readManifest?.() ?? readManifest());
    return managedTarget(ref, manifest.entries);
  }

  async catalog(): Promise<PerformanceCatalogResponse> {
    const optionPromises: Promise<PerformanceTargetOption>[] = [];
    const inventory = await this.inventory();
    const seen = new Set<string>();
    const add = (ref: PerformanceTargetRef): void => {
      const key = `${ref.source}:${ref.id}:${ref.version ?? 'auto'}:${ref.provenance ?? 'auto'}`;
      if (seen.has(key)) return;
      seen.add(key);
      optionPromises.push((async () => {
        const resolved = await this.resolveFromInventory(ref, inventory).catch(() => null);
        const profiles = resolved === null ? [NATURAL_PROFILE] : await this.profilesFor(resolved);
        return {
          ref,
          label: targetLabel(ref, resolved?.runtimeVersion),
          available: resolved !== null,
          reason: resolved === null ? `${targetName(ref.id)} is not installed or its executable is missing` : null,
          runtimeId: ref.id,
          runtimeVersion: resolved?.runtimeVersion ?? null,
          engineId: resolved?.engineId ?? engineFor(ref.id),
          profiles
        };
      })());
    };

    for (const id of this.runtimes.ids()) {
      const runtime = this.runtimes.get(id as 'node' | 'deno' | 'bun');
      if (runtime === null) continue;
      const system = await runtime.resolveExecutable('system').catch(() => null);
      const installedVersions = await runtime.installedVersions().catch(() => []);
      if (system !== null) add({ source: 'runtime', id, version: 'system', provenance: 'system' });
      for (const version of installedVersions) {
        add({ source: 'runtime', id, version, provenance: 'managed' });
      }
      if (system === null && installedVersions.length === 0) add({ source: 'runtime', id, provenance: 'auto' });
    }

    for (const version of inventory.nvm?.versions ?? []) {
      add({ source: 'runtime', id: 'node', version: version.version, provenance: 'nvm' });
    }
    add({ source: 'runtime', id: 'browser', version: 'embedded', provenance: 'builtin' });
    for (const id of BROWSER_IDS) {
      if (inventory.browsers.get(id) !== null) add({ source: 'runtime', id, version: 'system', provenance: 'system' });
    }
    for (const entry of inventory.manifest.entries) {
      if (entry.installedPath === undefined || entry.kind === 'runtime-support') continue;
      add({ source: entry.kind, id: entry.id, version: entry.version, provenance: entry.source === 'local-import' ? 'local-import' : 'managed' });
    }
    const targets = await Promise.all(optionPromises);
    return PerformanceCatalogResponseSchema.parse({ targets });
  }

  async resolveProfile(target: ResolvedPerformanceTarget, profile: PerformanceProfileRef): Promise<ResolvedProfile | null> {
    const option = (await this.profilesFor(target)).find((item) => item.id === profile.id && item.available);
    if (option === undefined) return null;
    const config = profileConfig(target, option.id);
    return { ref: { id: option.id, label: option.label }, ...config };
  }

  private async profilesFor(target: ResolvedPerformanceTarget): Promise<PerformanceProfileOption[]> {
    if (launchKind(target) === 'bun') return [
      { ...NATURAL_PROFILE, label: 'Natural JSC' },
      { id: 'jsc-interpreter', label: 'Interpreter only', description: 'Disables every JavaScriptCore JIT tier through BUN_JSC_useJIT=false.', available: true, classification: 'internal' },
      { id: 'jsc-baseline', label: 'Baseline ceiling', description: 'Keeps the Baseline JIT but disables the DFG and FTL optimizing tiers.', available: true, classification: 'internal' },
      { id: 'jsc-no-ftl', label: 'DFG ceiling', description: 'Keeps LLInt, Baseline and DFG while disabling the top FTL tier.', available: true, classification: 'internal' }
    ];
    if (target.engineId !== 'v8' || launchKind(target) === 'embedded-browser' || launchKind(target) === 'external-browser') {
      return [{ ...NATURAL_PROFILE, label: `Natural ${engineLabel(target.engineId)}` }];
    }
    const options = await this.readV8Options(target);
    const supports = (name: string): boolean => new RegExp(`--(?:\\[no-\\])?${name}(?:\\s|$)`, 'm').test(options);
    return [
      { ...NATURAL_PROFILE, label: `Natural ${targetName(target.runtimeId)} / V8` },
      { id: 'jitless', label: 'JITless', description: 'V8 executable-memory generation disabled; useful as an interpreter-oriented baseline.', available: supports('jitless'), classification: 'stable' },
      { id: 'baseline-ceiling', label: 'Baseline ceiling', description: 'Optimizing compiler disabled while baseline compilation remains available.', available: supports('opt'), classification: 'internal' },
      { id: 'maglev-disabled', label: 'Maglev disabled', description: 'Natural V8 tiering with the Maglev mid-tier disabled.', available: supports('maglev'), classification: 'experimental' }
    ];
  }

  private readV8Options(target: ResolvedPerformanceTarget): Promise<string> {
    const cached = this.v8Options.get(target.executable);
    if (cached !== undefined) return cached;
    const pending = new Promise<string>((resolve) => {
      const args = launchKind(target) === 'deno' ? ['eval', '--v8-flags=--help', ''] : ['--v8-options'];
      try {
        execFile(target.executable, args, {
          windowsHide: true, timeout: 8_000, maxBuffer: 8 * 1024 * 1024,
          env: {
            ...(process.platform === 'win32' ? { SystemRoot: process.env['SystemRoot'], windir: process.env['windir'] } : {}),
            PATH: [dirname(target.executable), ...(process.env['PATH'] ?? '').split(pathListSeparator()).filter(Boolean)].join(pathListSeparator())
          }
        }, (error, stdout, stderr) => resolve(error && !stdout ? stderr : `${stdout}\n${stderr}`));
      } catch {
        resolve('');
      }
    });
    this.v8Options.set(target.executable, pending);
    return pending;
  }

  private async inventory(): Promise<PerformanceInventory> {
    const [manifest, nvm, browserRows] = await Promise.all([
      this.inventoryDeps.readManifest?.() ?? readManifest(),
      this.inventoryDeps.detectNvm?.() ?? detectNvmNode(),
      Promise.all(BROWSER_IDS.map(async (id) => [id, await (this.inventoryDeps.detectBrowser?.(id) ?? detectSystemBrowser(id))] as const))
    ]);
    return { manifest, nvm, browsers: new Map(browserRows) };
  }

  private async resolveFromInventory(ref: PerformanceTargetRef, inventory: PerformanceInventory): Promise<ResolvedPerformanceTarget | null> {
    if (ref.source === 'runtime' && ref.id === 'browser') return embeddedBrowserTarget(ref);
    if (ref.source === 'runtime' && BROWSER_IDS.includes(ref.id as BrowserId)) {
      const detected = inventory.browsers.get(ref.id as BrowserId) ?? null;
      return detected === null ? null : externalBrowserTarget(ref, detected);
    }
    if (ref.source === 'runtime' && ref.id === 'node' && ref.provenance === 'nvm') {
      const selected = inventory.nvm?.versions.find((item) => item.version === ref.version);
      return selected === undefined ? null : runtimeTarget(ref, selected.exePath, selected.version, 'node');
    }
    if (ref.source === 'runtime' && this.runtimes.ids().includes(ref.id)) {
      const runtime = this.runtimes.get(ref.id as 'node' | 'deno' | 'bun');
      const resolved = await runtime?.resolveExecutable(ref.version);
      return resolved == null || runtime === null ? null : runtimeTarget(ref, resolved.exePath, resolved.version, runtime.id);
    }
    return managedTarget(ref, inventory.manifest.entries);
  }
}

function launchKind(target: ResolvedPerformanceTarget): NonNullable<ResolvedPerformanceTarget['launchKind']> {
  if (target.launchKind !== undefined) return target.launchKind;
  if (target.runtimeId === 'node' || target.runtimeId === 'deno' || target.runtimeId === 'bun') return target.runtimeId;
  if (target.runtimeId === 'browser') return 'embedded-browser';
  if (BROWSER_IDS.includes(target.runtimeId as BrowserId)) return 'external-browser';
  return 'shell';
}

function engineFor(id: string): string {
  if (id === 'bun' || id === 'javascriptcore') return 'javascriptcore';
  if (id === 'firefox' || id === 'spidermonkey') return 'spidermonkey';
  if (id === 'txiki' || id === 'quickjs') return 'quickjs';
  if (id === 'chrome' || id === 'browser' || id === 'node' || id === 'deno' || id === 'v8' || id === 'd8-debug') return 'v8';
  return id;
}

function runtimeTarget(ref: PerformanceTargetRef, executable: string, version: string, runtimeId: 'node' | 'deno' | 'bun'): ResolvedPerformanceTarget {
  return {
    ref: { ...ref, version }, executable, runtimeId, runtimeVersion: version,
    engineId: engineFor(runtimeId), launchKind: runtimeId
  };
}

function embeddedBrowserTarget(ref: PerformanceTargetRef): ResolvedPerformanceTarget {
  const version = process.versions.chrome ?? process.versions.v8 ?? 'embedded';
  return {
    ref: { ...ref, version }, executable: process.execPath, runtimeId: 'browser', runtimeVersion: version,
    engineId: 'v8', engineVersion: process.versions.v8, launchKind: 'embedded-browser'
  };
}

function externalBrowserTarget(ref: PerformanceTargetRef, detected: DetectedRuntime): ResolvedPerformanceTarget {
  return {
    ref: { ...ref, version: detected.version }, executable: detected.exePath, runtimeId: ref.id,
    runtimeVersion: detected.version, engineId: engineFor(ref.id), launchKind: 'external-browser'
  };
}

function managedTarget(ref: PerformanceTargetRef, entries: readonly ManifestEntry[]): ResolvedPerformanceTarget | null {
  const kind = ref.source === 'engine' ? 'engine' : 'runtime';
  const matches = entries.filter((entry) => entry.kind === kind && entry.id === ref.id && entry.installedPath !== undefined && (ref.version === undefined || ref.version === 'auto' || entry.version === ref.version));
  const entry = [...matches].sort((left, right) => right.version.localeCompare(left.version, undefined, { numeric: true }))[0];
  if (entry?.installedPath === undefined) return null;
  const executableName = MANAGED_EXECUTABLES[entry.id];
  if (executableName === undefined) return null;
  const executable = join(entry.installedPath, executableName);
  if (!existsSync(executable)) return null;
  const isRuntime = entry.kind === 'runtime';
  const kindOfLaunch = isRuntime && (entry.id === 'node' || entry.id === 'deno' || entry.id === 'bun') ? entry.id : 'shell';
  return {
    ref: { ...ref, version: entry.version }, executable, runtimeId: entry.id, runtimeVersion: entry.version,
    engineId: engineFor(entry.id), ...(isRuntime ? {} : { engineVersion: entry.version }), launchKind: kindOfLaunch
  };
}

function targetName(id: string): string {
  const names: Readonly<Record<string, string>> = {
    node: 'Node.js', deno: 'Deno', bun: 'Bun', browser: 'Chromium (embedded)', chrome: 'Google Chrome', firefox: 'Firefox',
    txiki: 'txiki.js', v8: 'V8', 'd8-debug': 'V8 (debug)', spidermonkey: 'SpiderMonkey', javascriptcore: 'JavaScriptCore',
    quickjs: 'QuickJS-ng', graaljs: 'GraalJS', hermes: 'Hermes', chakra: 'ChakraCore', 'moddable-xs': 'Moddable XS'
  };
  return names[id] ?? id;
}

function engineLabel(id: string): string {
  return id === 'v8' ? 'V8' : id === 'javascriptcore' ? 'JavaScriptCore' : id === 'spidermonkey' ? 'SpiderMonkey' : id === 'quickjs' ? 'QuickJS' : targetName(id);
}

function targetLabel(ref: PerformanceTargetRef, resolvedVersion?: string): string {
  const version = resolvedVersion ?? ref.version ?? '';
  const source = ref.provenance === 'builtin' ? 'built-in' : ref.provenance === 'nvm' ? 'nvm' : ref.provenance === 'system' ? 'system' : ref.provenance === 'local-import' ? 'local' : ref.provenance === 'managed' ? 'managed' : '';
  return `${targetName(ref.id)} ${version}${source ? ` · ${source}` : ''}`.trim();
}

interface ActivePerformanceRun { readonly requestId: string; handle: RunHandle | null; cancelled: boolean }
export interface PerformanceManagerDeps {
  readonly targetResolver: PerformanceTargetResolver;
  readonly emit: (event: PerformanceEvent) => void;
  readonly createRunner?: () => ProcessRunner;
  readonly createBrowserRunner?: () => BrowserRuntimeRunner;
  readonly createExternalBrowserRunner?: () => BrowserRuntimeRunner;
  readonly randomSeed?: () => number;
}

interface ChildSampleMessage { type: 'sample'; sample: PerformanceRawSample }
interface ChildSampleStartMessage { type: 'sample-start'; caseId: string; round: number }
interface ChildWarmupMessage { type: 'warmup'; round: number; caseId: string; completed: number }
interface ChildResultMessage { type: 'result'; result: PerformanceRunResult }
type ChildMessage = ChildSampleMessage | ChildSampleStartMessage | ChildWarmupMessage | ChildResultMessage;
class PerformanceExecutionError extends Error {
  constructor(message: string, readonly partialResults: PerformanceCaseResult[]) { super(message); }
}

export class PerformanceManager {
  private readonly runner: ProcessRunner;
  private readonly browserRunner: BrowserRuntimeRunner;
  private readonly externalBrowserRunner: BrowserRuntimeRunner;
  private readonly active = new Map<string, ActivePerformanceRun>();
  constructor(private readonly deps: PerformanceManagerDeps) {
    this.runner = deps.createRunner?.() ?? new ProcessRunner();
    this.browserRunner = deps.createBrowserRunner?.() ?? new EmbeddedBrowserRuntime();
    this.externalBrowserRunner = deps.createExternalBrowserRunner?.() ?? new ExternalBrowserRuntime();
  }

  catalog(): Promise<PerformanceCatalogResponse> { return this.deps.targetResolver.catalog(); }

  async start(req: PerformanceStartRequest): Promise<PerformanceStartResponse> {
    if (this.active.size > 0) throw new Error('a Performance Lab experiment is already active');
    for (const item of req.cases) if (item.body.length > MAX_BODY_LENGTH) throw new Error(`case '${item.label}' is too large`);
    const totalGroups = req.targets.reduce((sum, item) => sum + item.profiles.length, 0);
    const totalCells = req.targets.reduce((sum, selection) => sum + selection.profiles.reduce((profileSum, profile) => profileSum + casesForPerformanceGroup(req.cases, selection.target, profile).length, 0), 0);
    const active: ActivePerformanceRun = { requestId: req.requestId, handle: null, cancelled: false };
    this.active.set(req.requestId, active);
    void this.execute(req, active, totalGroups);
    return { accepted: true, requestId: req.requestId, totalGroups, totalCells };
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
    const unitCount = (caseCount: number): number => 1 + (req.measurement.warmupRounds * caseCount) + (req.measurement.samples * caseCount);
    const planned = req.targets.flatMap((selection) => selection.profiles.map((profile) => ({ selection, profile, cases: casesForPerformanceGroup(req.cases, selection.target, profile) })));
    const totalUnits = Math.max(1, planned.reduce((sum, group) => sum + unitCount(group.cases.length), 0));
    let progressBase = 0;
    try {
      for (const selection of req.targets) {
        if (active.cancelled) break;
        let target: ResolvedPerformanceTarget | null = null;
        let targetError: string | null = null;
        try {
          target = await this.deps.targetResolver.resolve(selection.target);
        } catch (error) {
          targetError = error instanceof Error ? error.message : String(error);
        }
        for (const requestedProfile of selection.profiles) {
          if (active.cancelled) break;
          const groupCases = casesForPerformanceGroup(req.cases, selection.target, requestedProfile);
          const unitsPerGroup = unitCount(groupCases.length);
          const currentProgressBase = progressBase;
          progressBase += unitsPerGroup;
          const groupId = groupKey(selection.target, requestedProfile);
          if (groupCases.length === 0) continue;
          if (target === null) {
            failedGroups++;
            const message = targetError ?? `target '${selection.target.id} ${selection.target.version ?? ''}' is not available`;
            this.send({ type: 'cell-error', requestId: req.requestId, groupId, target: selection.target, profile: requestedProfile, message, partialResults: [] });
            this.send({ type: 'progress', requestId: req.requestId, groupId, phase: 'resolving', completed: currentProgressBase + unitsPerGroup, total: totalUnits, message: `skipped ${selection.target.id} / ${requestedProfile.label ?? requestedProfile.id}: ${message}` });
            continue;
          }
          let profile: ResolvedProfile | null = null;
          let profileError: string | null = null;
          try {
            profile = await this.deps.targetResolver.resolveProfile(target, requestedProfile);
          } catch (error) {
            profileError = error instanceof Error ? error.message : String(error);
          }
          if (profile === null) {
            failedGroups++;
            const message = profileError ?? `profile '${requestedProfile.id}' is unavailable for ${target.runtimeId} ${target.runtimeVersion}`;
            this.send({ type: 'cell-error', requestId: req.requestId, groupId, target: target.ref, profile: requestedProfile, message, partialResults: [] });
            this.send({ type: 'progress', requestId: req.requestId, groupId, phase: 'resolving', completed: currentProgressBase + unitsPerGroup, total: totalUnits, message: `skipped ${target.runtimeId} / ${requestedProfile.label ?? requestedProfile.id}: ${message}` });
            continue;
          }
          this.send({ type: 'progress', requestId: req.requestId, groupId, phase: 'resolving', completed: currentProgressBase, total: totalUnits, message: `resolving ${target.runtimeId} ${target.runtimeVersion} / ${profile.ref.label ?? profile.ref.id}` });
          try {
            const result = await this.runGroup(req, active, target, profile, groupId, groupCases, currentProgressBase, totalUnits);
            if (active.cancelled) break;
            completedGroups++;
            this.send({ type: 'result', requestId: req.requestId, result });
          } catch (error) {
            if (active.cancelled) break;
            failedGroups++;
            const message = error instanceof Error ? error.message : String(error);
            this.send({ type: 'cell-error', requestId: req.requestId, groupId, target: target.ref, profile: profile.ref, message, partialResults: error instanceof PerformanceExecutionError ? error.partialResults : [] });
            this.send({ type: 'progress', requestId: req.requestId, groupId, phase: 'measurement', completed: currentProgressBase + unitsPerGroup, total: totalUnits, message: `failed ${target.runtimeId} / ${profile.ref.label ?? profile.ref.id}: ${message}` });
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

  private async runGroup(req: PerformanceStartRequest, active: ActivePerformanceRun, target: ResolvedPerformanceTarget, profile: ResolvedProfile, groupId: string, groupCases: readonly PerformanceCase[], progressBase: number, totalUnits: number): Promise<PerformanceRunResult> {
    const root = workspaceRoot(req.workspaceId);
    await fs.mkdir(join(root, '.rhbuild'), { recursive: true });
    const dir = await fs.mkdtemp(join(root, '.rhbuild', 'performance-run-'));
    const harnessPath = join(dir, 'group.js');
    const seed = (this.deps.randomSeed?.() ?? Math.floor(Math.random() * 0x7fffffff)) >>> 0;
    const mitataModule = await materializeMitataModule(dir);
    await fs.writeFile(harnessPath, await buildHarness(req, groupCases, seed, target, profile, groupId, mitataModule, root), 'utf8');
    this.send({ type: 'progress', requestId: req.requestId, groupId, phase: 'preparing', completed: progressBase + 1, total: totalUnits, message: `prepared ${target.runtimeId} ${target.runtimeVersion} / ${profile.ref.label ?? profile.ref.id}` });

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
          const caseLabel = groupCases.find((item) => item.id === sample.caseId)?.label ?? sample.caseId;
          this.send({ type: 'progress', requestId: req.requestId, groupId, phase: 'measurement', completed: progressBase + 1 + (req.measurement.warmupRounds * groupCases.length) + measurementDone, total: totalUnits, message: `${target.runtimeId} / ${profile.ref.label ?? profile.ref.id}: ${caseLabel} · sample ${sample.round + 1}/${req.measurement.samples}` });
        },
        (sampleStart) => {
          const caseLabel = groupCases.find((item) => item.id === sampleStart.caseId)?.label ?? sampleStart.caseId;
          const completed = progressBase + 1 + (req.measurement.warmupRounds * groupCases.length) + measurementDone;
          this.send({ type: 'progress', requestId: req.requestId, groupId, phase: 'measurement', completed, total: totalUnits, message: `${target.runtimeId} / ${profile.ref.label ?? profile.ref.id}: ${caseLabel} · sample ${sampleStart.round + 1}/${req.measurement.samples} running` });
        },
        (warmup) => {
          const caseLabel = groupCases.find((item) => item.id === warmup.caseId)?.label ?? warmup.caseId;
          this.send({ type: 'progress', requestId: req.requestId, groupId, phase: 'warmup', completed: progressBase + 1 + warmup.completed, total: totalUnits, message: `${target.runtimeId} / ${profile.ref.label ?? profile.ref.id}: ${caseLabel} · warmup ${warmup.round + 1}/${req.measurement.warmupRounds}` });
        }
      );
    };
    const parseOutput = (chunk: string): void => {
      pending += chunk;
      let newline = pending.indexOf('\n');
      while (newline !== -1) { acceptLine(pending.slice(0, newline)); pending = pending.slice(newline + 1); newline = pending.indexOf('\n'); }
    };
    const runner = launchKind(target) === 'embedded-browser' ? this.browserRunner : launchKind(target) === 'external-browser' ? this.externalBrowserRunner : this.runner;
    const off = runner.onEvent((event) => {
      if (active.handle?.runId !== event.runId) return;
      if (event.type === 'stdout') parseOutput(event.data);
      else if (event.type === 'console') parseOutput(`${event.text}\n`);
      else if (event.type === 'stderr' && stderr.join('').length < 100_000) stderr.push(event.data);
    });
    try {
      const handle = runner.run({
        exePath: target.executable,
        args: performanceLaunchArgs(target, harnessPath, profile.flags, req.measurement.gcMode),
        cwd: dir,
        timeoutMs: req.measurement.timeoutMs,
        extraEnv: profile.extraEnv
      });
      active.handle = handle;
      if (active.cancelled) await handle.cancel();
      const processResult = await handle.result;
      if (pending.trim() !== '') acceptLine(pending);
      if (active.cancelled || processResult.status === 'cancelled') throw new Error('benchmark group cancelled');
      if (processResult.status === 'timeout') throw new Error(`benchmark group timed out after ${req.measurement.timeoutMs} ms`);
      if (processResult.status !== 'completed' || processResult.exitCode !== 0) {
        throw new PerformanceExecutionError(stderr.join('').trim() || `benchmark child exited with code ${processResult.exitCode ?? 'unknown'}`, buildPartialResults(groupCases, [...samples.values()].flat()));
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
      await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }).catch(() => undefined);
    }
  }

  private acceptChildMessage(raw: string, samples: Map<string, PerformanceRawSample[]>, onResult: (result: PerformanceRunResult) => void, onSample: (sample: PerformanceRawSample) => void, onSampleStart: (sample: ChildSampleStartMessage) => void, onWarmup: (warmup: ChildWarmupMessage) => void): void {
    try {
      const parsed = JSON.parse(raw) as ChildMessage;
      if (parsed.type === 'sample') { const own = samples.get(parsed.sample.caseId) ?? []; own.push(parsed.sample); samples.set(parsed.sample.caseId, own); onSample(parsed.sample); }
      else if (parsed.type === 'sample-start') onSampleStart(parsed);
      else if (parsed.type === 'warmup') onWarmup(parsed);
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

async function buildHarness(req: PerformanceStartRequest, groupCases: readonly PerformanceCase[], seed: number, target: ResolvedPerformanceTarget, profile: ResolvedProfile, groupId: string, mitataModule: string, workspaceDir: string): Promise<string> {
  const payload = JSON.stringify(groupCases.map((item) => ({ id: item.id, label: item.label, body: item.body, mode: item.mode })));
  const setupPrelude = splitCasePrelude(req.setup);
  const preludes = groupCases.map((item) => splitCasePrelude(item.body));
  const caseImports = [...new Set([...setupPrelude.imports, ...preludes.flatMap((item) => item.imports)])].join('\n');
  const visibleFlags = [...profile.flags, ...Object.entries(profile.extraEnv).map(([key, value]) => `${key}=${value}`)];
  const environment = JSON.stringify({
    platform: platform(), arch: arch(), cpu: cpus()[0]?.model ?? 'unknown', logicalCores: Math.max(1, cpus().length),
    runtimeId: target.runtimeId, runtimeVersion: target.runtimeVersion, engineId: target.engineId,
    engineVersion: target.engineVersion, executable: target.executable, flags: visibleFlags, gcMode: req.measurement.gcMode
  });
  const runners = groupCases.map((item, index) => `${item.mode === 'async' ? 'async ' : ''}function __rh_${safeIdentifier(item.id)}() {\n${preludes[index]?.body ?? item.body}\n}`).join(',\n');
  const batches = groupCases.map((item, index) => item.mode === 'async'
    ? `async function __rh_batch_${index}() { for (let iteration = 0; iteration < __rhPerfIterationsPerSample; iteration++) do_not_optimize(await __rhPerfRunners[${index}]()); }`
    : `function __rh_batch_${index}() { for (let iteration = 0; iteration < __rhPerfIterationsPerSample; iteration++) { const value = __rhPerfRunners[${index}](); if (value && typeof value.then === 'function') throw new Error('returned a Promise in sync mode; switch this case to async'); do_not_optimize(value); } }`
  ).join(',\n');
  const source = `import { now, do_not_optimize } from '__rh_performance_kernel__';

${caseImports}

globalThis.__rhPerformanceDone = (async () => {

// Shared setup is evaluated once per isolated target/profile process.
${setupPrelude.body}

const __rhPerfCases = ${payload};
const __rhPerfSeed = ${seed};
const __rhPerfSampleCount = ${req.measurement.samples};
const __rhPerfWarmupRounds = ${req.measurement.warmupRounds};
const __rhPerfIterationsPerSample = ${req.measurement.iterationsPerSample};
const __rhPerfGcMode = ${JSON.stringify(req.measurement.gcMode)};
const __rhPerfEnvironment = ${environment};
if (typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string') {
  const browserVersion = /(?:Chrome|Firefox)\\/([\\d.]+)/.exec(navigator.userAgent)?.[1];
  if (browserVersion) __rhPerfEnvironment.runtimeVersion = browserVersion;
}
const __rhPerfPrefix = ${JSON.stringify(PERF_PREFIX)};
const __rhPerfEmit = (value) => {
  if (typeof globalThis.__rhPerformanceEmit === 'function') globalThis.__rhPerformanceEmit(value);
  else if (globalThis.console && typeof globalThis.console.log === 'function') globalThis.console.log(__rhPerfPrefix + JSON.stringify(value));
  else if (typeof globalThis.print === 'function') globalThis.print(__rhPerfPrefix + JSON.stringify(value));
};
const __rhPerfRunners = [${runners}];
const __rhPerfBatches = [${batches}];
const __rhPerfRawSamples = [];
const __rhPerfOrderFor = (round) => { const start = (__rhPerfSeed + round) % __rhPerfRunners.length; return __rhPerfRunners.map((_, index) => (start + index) % __rhPerfRunners.length); };
const __rhPerfCollectGarbage = () => {
  if (globalThis.Bun && typeof globalThis.Bun.gc === 'function') { globalThis.Bun.gc(true); return; }
  if (typeof globalThis.gc === 'function') { globalThis.gc(); return; }
  throw new Error('Explicit garbage collection was requested, but this runtime did not expose a GC hook.');
};
const __rhPerfCaseError = (error, index, phase, round) => {
  const detail = error instanceof Error ? error.message : String(error);
  return new Error('Case "' + __rhPerfCases[index].label + '" failed during ' + phase + ' round ' + (round + 1) + ': ' + detail);
};
const __rhPerfRunBatch = (index, phase, round) => {
  try {
    const pending = __rhPerfBatches[index]();
    if (pending && typeof pending.then === 'function') return pending.catch((error) => { throw __rhPerfCaseError(error, index, phase, round); });
    return pending;
  } catch (error) {
    throw __rhPerfCaseError(error, index, phase, round);
  }
};
try {
  for (let round = 0; round < __rhPerfWarmupRounds; round++) {
    let warmupIndex = 0;
    for (const index of __rhPerfOrderFor(round)) {
      const pending = __rhPerfRunBatch(index, 'warmup', round);
      if (pending && typeof pending.then === 'function') await pending;
      __rhPerfEmit({ type: 'warmup', round, caseId: __rhPerfCases[index].id, completed: (round * __rhPerfCases.length) + warmupIndex + 1 });
      warmupIndex++;
    }
  }
  if (__rhPerfGcMode === 'before-group') __rhPerfCollectGarbage();
  for (let round = 0; round < __rhPerfSampleCount; round++) {
    let orderIndex = 0;
    for (const index of __rhPerfOrderFor(round)) {
      __rhPerfEmit({ type: 'sample-start', caseId: __rhPerfCases[index].id, round });
      if (__rhPerfGcMode === 'before-sample') __rhPerfCollectGarbage();
      const startedAt = now();
      const pending = __rhPerfRunBatch(index, 'measurement', round);
      if (pending && typeof pending.then === 'function') await pending;
      const durationNs = Math.max(0, now() - startedAt);
      const sample = { caseId: __rhPerfCases[index].id, round, durationNs, iterations: __rhPerfIterationsPerSample, orderIndex };
      __rhPerfRawSamples.push(sample); __rhPerfEmit({ type: 'sample', sample }); orderIndex++;
    }
  }
  const results = __rhPerfCases.map((item) => { const own = __rhPerfRawSamples.filter((sample) => sample.caseId === item.id); const computed = __rhPerfMetrics(own); return { caseId: item.id, label: item.label, metrics: computed, samples: own, warnings: __rhPerfWarnings(item, computed) }; });
  const engineVersion = __rhPerfEnvironment.engineId === 'javascriptcore'
    ? (globalThis.Bun?.revision ?? globalThis.Bun?.version ?? undefined)
    : (globalThis.Deno?.version?.v8 ?? globalThis.process?.versions?.v8 ?? undefined);
  __rhPerfEmit({ type: 'result', result: { requestId: ${JSON.stringify(req.requestId)}, groupId: ${JSON.stringify(groupId)}, target: ${JSON.stringify(target.ref)}, profile: ${JSON.stringify(profile.ref)}, environment: { ...__rhPerfEnvironment, ...(engineVersion ? { engineVersion } : {}) }, results, comparisons: [], scheduleSeed: __rhPerfSeed, rounds: __rhPerfSampleCount } });
} catch (error) {
  if (globalThis.console && typeof globalThis.console.error === 'function') globalThis.console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  if (globalThis.process) { process.exitCode = 1; return; }
  if (globalThis.Deno && typeof globalThis.Deno.exit === 'function') { globalThis.Deno.exit(1); return; }
  throw error;
}

function __rhPerfMetrics(items) {
  const values = items.map((item) => item.durationNs / item.iterations).filter(Number.isFinite).sort((a, b) => a - b);
  const percentile = (p) => values.length ? values[Math.min(values.length - 1, Math.round((values.length - 1) * p))] : 0;
  const mean = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  const variance = values.length > 1 ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1) : 0;
  return { minNsPerOp: values[0] ?? 0, meanNsPerOp: mean, medianNsPerOp: percentile(.5), p75NsPerOp: percentile(.75), p95NsPerOp: percentile(.95), p99NsPerOp: percentile(.99), maxNsPerOp: values[values.length - 1] ?? 0, stddevNsPerOp: Math.sqrt(variance), throughput: mean > 0 ? 1e9 / mean : 0, sampleCount: values.length, totalIterations: items.reduce((sum, item) => sum + item.iterations, 0) };
}
function __rhPerfWarnings(item, value) {
  const out = [];
  if (!/\\breturn\\b/.test(item.body) && !item.body.includes('do_not_optimize')) out.push({ code: 'no-observable-result', message: 'No explicit return value; confirm the measured work cannot be eliminated.' });
  if (item.mode === 'async') out.push({ code: 'async-overhead', message: 'Async timing includes Promise scheduling and await overhead.' });
  if (value.meanNsPerOp > 0 && value.stddevNsPerOp / value.meanNsPerOp > .2) out.push({ code: 'high-variance', message: 'High variance (>20%); increase samples or reduce system load.' });
  if (value.medianNsPerOp < 1) out.push({ code: 'timer-saturation', message: 'Sub-nanosecond result is suspicious; increase cycles per sample.' });
  return out;
}
})();`;
  try {
    const resolveDir = req.setupSourceLabel ? dirname(join(workspaceDir, req.setupSourceLabel)) : workspaceDir;
    const compiled = await build({
      stdin: {
        contents: source,
        loader: 'ts',
        resolveDir,
        sourcefile: req.setupSourceLabel ?? 'performance-experiment.ts'
      },
      bundle: true,
      write: false,
      format: 'iife',
      platform: 'neutral',
      // Workspace packages are bundled into the isolated harness. The child
      // output is a self-contained script that also runs in browser pages and
      // standalone engine shells; leaving CommonJS packages external would
      // fail before a case starts in those targets.
      packages: 'bundle',
      target: 'es2018',
      treeShaking: false,
      sourcemap: 'inline',
      plugins: [{
        name: 'runtimehell-performance-kernel',
        setup(context) {
          context.onResolve({ filter: /^__rh_performance_kernel__$/ }, () => ({ path: mitataModule }));
        }
      }]
    });
    const output = compiled.outputFiles[0];
    if (output === undefined) throw new Error('esbuild returned no benchmark output');
    return output.text;
  } catch (error) {
    const failure = error as BuildFailure;
    const details = failure.errors?.map((item) => {
      const location = item.location === null ? '' : ` at ${item.location.line}:${item.location.column + 1}`;
      return `${item.text}${location}`;
    }).join('; ');
    throw new Error(`Experiment code could not be prepared: ${details || (error instanceof Error ? error.message : String(error))}. Put imports and shared declarations in Shared setup; mark cases containing await as async.`);
  }
}

export function performanceLaunchArgs(target: ResolvedPerformanceTarget, harnessPath: string, flags: readonly string[], gcMode: PerformanceStartRequest['measurement']['gcMode']): string[] {
  const kind = launchKind(target);
  const exposeGc = gcMode === 'runtime' ? [] : ['--expose-gc'];
  if (kind === 'embedded-browser' || kind === 'external-browser') return [harnessPath];
  if (kind === 'deno') {
    const v8Flags = [...flags, ...exposeGc];
    return ['run', '--quiet', ...(v8Flags.length ? [`--v8-flags=${v8Flags.join(',')}`] : []), harnessPath];
  }
  if (kind === 'node') return [...flags, ...exposeGc, harnessPath];
  if (kind === 'bun') return [...flags, ...(gcMode === 'runtime' ? [] : ['--expose-gc']), harnessPath];
  if (target.runtimeId === 'txiki') return ['run', ...flags, harnessPath];
  return [...flags, harnessPath];
}
function profileConfig(target: ResolvedPerformanceTarget, profileId: string): Pick<ResolvedProfile, 'flags' | 'extraEnv'> {
  if (launchKind(target) === 'bun') {
    if (profileId === 'jsc-interpreter') return { flags: [], extraEnv: { BUN_JSC_useJIT: 'false' } };
    if (profileId === 'jsc-baseline') return { flags: [], extraEnv: { BUN_JSC_useDFGJIT: 'false', BUN_JSC_useFTLJIT: 'false' } };
    if (profileId === 'jsc-no-ftl') return { flags: [], extraEnv: { BUN_JSC_useFTLJIT: 'false' } };
    return { flags: [], extraEnv: {} };
  }
  if (profileId === 'jitless') return { flags: ['--jitless'], extraEnv: {} };
  if (profileId === 'baseline-ceiling') return { flags: ['--no-opt'], extraEnv: {} };
  if (profileId === 'maglev-disabled') return { flags: ['--no-maglev'], extraEnv: {} };
  return { flags: [], extraEnv: {} };
}
function groupKey(target: PerformanceTargetRef, profile: PerformanceProfileRef): string { return `${target.source}:${target.id}:${target.version ?? 'auto'}:${profile.id}`; }
function targetRefMatches(left: PerformanceTargetRef | undefined, right: PerformanceTargetRef): boolean {
  if (left === undefined) return false;
  if (left.source !== right.source || left.id !== right.id) return false;
  return left.version === undefined || right.version === undefined || left.version === right.version || left.version === 'system' || left.version === 'auto' || right.version === 'system' || right.version === 'auto';
}
function casesForPerformanceGroup(cases: readonly PerformanceCase[], target: PerformanceTargetRef, profile: PerformanceProfileRef): PerformanceCase[] {
  return cases.filter((item) => item.target === undefined || (targetRefMatches(item.target, target) && (item.profileIds === undefined || item.profileIds.includes(profile.id))));
}
function safeIdentifier(value: string): string { return value.replace(/[^a-zA-Z0-9_$]/g, '_').replace(/^[^a-zA-Z_$]/, '_$&'); }

interface CasePrelude { readonly imports: string[]; readonly body: string }

/** Hoist common static imports pasted into a case before wrapping its body. */
function splitCasePrelude(body: string): CasePrelude {
  const imports: string[] = [];
  const kept: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    const match = line.match(/^\s*(import\s+(?:(?:[\s\S]*?)\sfrom\s+)?['\"][^'\"]+['\"]\s*;?)([\s\S]*)$/);
    if (match?.[1] !== undefined) {
      imports.push(match[1].trim());
      const remainder = match[2]?.trimStart();
      if (remainder) kept.push(remainder);
    } else if (/^\s*export\s*\{/.test(line) || /^\s*export\s+\*\s+from\b/.test(line)) {
      // Export lists have no useful meaning inside a measured function.
    } else if (/^\s*export\s+default\s+/.test(line)) {
      kept.push(line.replace(/^(\s*)export\s+default\s+/, '$1'));
    } else if (/^\s*export\s+(?=(?:async\s+)?(?:function|class|const|let|var)\b)/.test(line)) {
      kept.push(line.replace(/^(\s*)export\s+/, '$1'));
    } else kept.push(line);
  }
  return { imports: [...new Set(imports)], body: kept.join('\n') };
}

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
