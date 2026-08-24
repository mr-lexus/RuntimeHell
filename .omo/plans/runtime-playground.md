# runtime-playground - Work Plan

<!-- ulw-plan plan artifact | slug: runtime-playground | intent: clear | review_required: false | approved: 2026-08-24 -->
<!-- scaffold note: hand-built in script-emitted header order (planner env has no shell); headers are the canonical template -->
<!-- review note: mandatory Metis pass executed DIRECTLY by planner (user ordered zero subagents after infra failures); findings folded into todos 10,12,13,15,17,20,26 and Scope/D7 -->

## TL;DR (For humans)

**What you'll get:** A Windows-first desktop app (Electron+React+Vite+TS) that works as a daily JS/TS scratchpad AND an engine-internals research instrument: write code in Monaco (TS/JS/JSX IntelliSense via `@typescript/ata`, prettier), run it instantly on a managed Node.js (downloadable pinned LTS with SHA-256 verification, timeout + tree-cancel so broken programs never freeze the UI), inspect structured results (objects/Maps/Sets/Promises/circular refs) in a virtualized tree, install npm packages per-playground — and select any function/expression/class/file to see how V8 compiles it: Ignition bytecode, AST, optimized code, TurboFan IR graphs, deopts — with SpiderMonkey (`dis()`) and JavaScriptCore (`JSC_*` dumps + WebKitRequirements managed automatically) added behind the same capability-probed adapter model, plus a Compare mode that preserves each engine's raw terminology.

**Why this approach:** Every engine-inspection claim was verified against primary sources before planning (V8 flag gating in source; official Google-hosted win64 d8 rel+dbg endpoints live-checked; JSC options read from WebKit's OptionsList.h; runtime distribution endpoints live-checked). The vertical slice Editor → Node exec → selected function → V8 bytecode ships end-to-end FIRST; abstractions are extracted afterward by behavior-preserving refactor. Engines/runtimes are NEVER bundled — they download on-demand from official sources into a checksummed, manifest-tracked cache, and anything requiring a custom build is quarantined in an explicit C-lane UI state.

**What it will NOT do (v0.x):** full debugger UI, browser runtime, QuickJS/GraalJS adapters, profiling flamecharts/heap viewers, Turbolizer embedding, cloud sync, remote execution sandboxing, macOS/Linux release targets, custom engine builds.

**Effort:** 32 implementation todos across 10 waves (P0 foundations → P10 packaging/docs) + 4 final-verification tasks; sized for incremental delivery where v0.1 (todos 1–22) is already the useful product.

**Risk:** highest-risk areas (engine output parsing drift, debug-build availability, Windows process-tree kills, JSC DLLs) each carry encoded mitigations — capability probes decide features per binary, raw output is always preserved verbatim alongside best-effort normalization, and every QA wave includes failure scenarios.

**Decisions locked:** Electron stack · on-demand checksummed downloads w/ versioned manifest · tests-after QA with agent-executed happy/failure evidence · npm binary resolution order · fd3-never-load-bearing result transport.

## Scope

### Product definition

Desktop developer tool (Windows-first; Linux desirable; macOS later) for writing, running, debugging and *internally analyzing* JavaScript/TypeScript across runtimes (Node.js, Deno, Bun) and engines (V8, SpiderMonkey, JavaScriptCore). RunJS-inspired scratchpad + engine-internals research instrument. Working name: **RuntimeHell**. Root: `C:\server\RuntimeHell`.

### Locked decisions

| # | Decision |
|---|---|
| D1 | Desktop stack: **Electron + React + Vite (electron-vite) + TypeScript**. Main process = Node.js (native child_process/fs/zlib). Renderer sandboxed (`contextIsolation:true`, `nodeIntegration:false`, typed preload bridge only). State: zustand. Styling: Tailwind CSS. Tests: vitest (+ Playwright `_electron` for E2E). |
| D2 | Binary distribution: **on-demand download into `%LOCALAPPDATA%\RuntimeHell\`** with checksum pinning. Installer ships ZERO engines/runtimes. Constraints (user-mandated): official/verifiable sources only; versioned manifest with platform/arch/version/checksum; NEVER assume every engine ships prebuilt binaries for every OS; any custom-build requirement becomes an explicitly-marked **C-lane** entry (see Custom-build lane), never presented as a normal download. |
| D3 | Vertical-slice-first: working slice Editor → Node exec → inline inspection → selected function → d8 bytecode BEFORE extracting `RuntimeAdapter`/`EngineAdapter` abstractions (abstractions extracted by behavior-preserving refactor in todo 23). |
| D4 | Runtime ≠ Engine. Runtimes execute programs (Node→V8, Deno→V8, Bun→JSC). Engine analysis runs through separately-managed engine SHELLS (d8/d8-debug, jsshell, jsc) downloaded independently of runtimes. UI never contains engine-specific logic outside the engines layer. |
| D5 | TS execution strategy v0.x: transpile with esbuild API in main process before every run on runtimes without native TS; native TS used when `capabilities.supportsTypeScriptNative` (Deno/Bun). No ts-node/ts-node/register loaders. Type-checking stays in Monaco's TS worker (diagnostics), not at execution time. |
| D6 | Test strategy: tests-after per todo; agent-executed QA with happy AND failure scenarios, each writing an evidence file under `.omo/qa/`. TDD permitted where logic is pure (parsers, serializers). |
| D7 | npm ops: spawn the npm CLI inside the active workspace dir; **npm binary resolution order: managed active runtime's bundled npm → PATH npm → structured error with setup guidance**; `--ignore-scripts` default ON (settings toggle); lockfile = package-lock.json committed per workspace; registry search via `GET https://registry.npmjs.org/-/v1/search?text=…&size=20`. |

### Verified evidence base (all planner-checked 2026-08-24 against primary sources)

Full ledger lives in `.omo/drafts/runtime-playground.md`. Load-bearing facts:

1. V8: `--print-bytecode`(+`--print-bytecode-filter`) is ungated (works in rel builds) — `flag-definitions.h`, `interpreter.cc`. Debug build unlocks `--print-ast`, `--print-opt-code`, `--allow-natives-syntax` natives. Official win64 rel+dbg zips: `https://storage.googleapis.com/chromium-v8/official/canary/v8-win64-{rel|dbg}-{version}.zip`, latest-version JSON `v8-win64-dbg-latest.json` (verified live → `{"version":"15.4.44"}`). `--trace-turbo(-graph/-filter/-path/-cfg-file)` emit JSON/graph files (confirmed in v8 test suite; pipeline now Ignition→Sparkplug→Maglev→TurboFan/Turbolev). Chrome-for-Testing does NOT ship d8.
2. SpiderMonkey: shell builtin `dis(fn)` dumps bytecode+source notes (firefox-source-docs Hacking Tips); legacy `-D/--dump-bytecode`; JIT spew via `IONFLAGS` env var (debug-build-leaning). win64 shells via Mozilla Taskcluster artifacts / jsvu (Apache-2.0, platform matrix ✅). MPL-2.0.
3. JavaScriptCore: option surface verified in WebKit `OptionsList.h` (©2026): `dumpGeneratedBytecodes`, `dumpBytecodeLivenessResults`, `dumpDisassembly` family, `dumpGraphAfterParsing`, `dumpGraphAtEachPhase`, `dumpDFG/B3/AirGraphAtEachPhase`, `dumpGraphAllowlist` (per-function filtering), tier toggles `useLLInt/useBaselineJIT/useDFGJIT/useFTLJIT`, `printEachOSRExit`, `logGC`, `useSamplingProfiler`; overrides via `JSC_<Option>` ENV VARS (documented in-file). Windows jsc exists via jsvu BUT requires WebKitRequirements `bin64` DLLs on PATH (must be managed by us, child-PATH-only).
4. QuickJS-ng: CLI dump flags `DUMP_BYTECODE_FINAL/PASS2/PASS1/HEX/PC2LINE/STACK/STEP` (docs/cli.md), MIT, win64 ✅ — future-phase adapter target.
5. Runtimes: Node `https://nodejs.org/dist/v{ver}/node-v{ver}-win-x64.zip` + `SHASUMS256.txt` (latest v26.7.0 verified); Deno GitHub release `deno-x86_64-pc-windows-msvc.zip` + `.sha256sum` + API sha256 digests (v2.9.5 verified); Bun `bun-windows-x64[-baseline].zip` + API digests (v1.4.0 verified).
6. Editor: monaco-editor native ESM module workers; Vite pattern `monaco-editor/editor/editor.worker?worker` (proven: slidevjs/slidev); npm-package IntelliSense via `@typescript/ata` → `addExtraLib` (proven: TypeScript-Website sandbox, Babylon.js playground, typehero); TS worker config via `typescriptDefaults.setCompilerOptions/setDiagnosticsOptions`.
7. Microbench: tinybench v6.1.3, MIT, ESM, node>=20 (registry-verified).

### Architecture

```mermaid
flowchart TB
  subgraph Renderer[Renderer process - React+Vite]
    ED[Monaco editor\n+ selection service] --> UI[Panels: Console / Inspector tree /\nAnalysis drawer / Packages / Runtimes / Compare]
    ST[zustand stores]
  end
  subgraph Preload[Preload - typed bridge]
    PB[window.api: invoke/on\nzod-validated channels]
  end
  subgraph Main[Main process - Node]
    IPC[IPC router] --> EXE[ExecutionManager\nspawn/timeout/cancel-tree/stream]
    IPC --> ANA[AnalysisManager]
    IPC --> PKG[PackageService\nnpm CLI in workspace dir]
    IPC --> WS[WorkspaceStore\nfiles+history+settings]
    EXE --> RA[RuntimeAdapter registry]
    ANA --> EA[EngineAdapter registry]
    subgraph runtimes[runtimes/]
      RN[node adapter] ; RD[deno] ; RB[bun]
    end
    subgraph engines[engines/]
      EV[v8] ; ES[spidermonkey] ; EJ[javascriptcore]
    end
    BM[BinaryManager\nmanifest+checksum+atomic extract+probe cache]
    RA --> BM ; EA --> BM
    TR[TranspileService esbuild] --> EXE
    RC[ResultCapture babel transform\n+ serializer] --> EXE
  end
  subgraph Disk[Disk]
    WSD[(workspaces/{id}/\nfiles+package.json)]
    CCH[(cache/\nruntimes+engines\nmanifest.json)]
  end
  Renderer <--> PB <--> IPC
  EXE --> WSD ; PKG --> WSD ; WS --> WSD ; BM --> CCH
```

Process isolation: user code ALWAYS runs as a separate OS process owned by ExecutionManager; UI can never be frozen by it (timeout + tree-kill via `taskkill /pid <pid> /T /F`; Job Object wrapper is a hardening follow-up). Output streams batched (≥16ms coalesce) over IPC.

Core interfaces (packages/protocol, zod-validated):

```ts
type RuntimeId = 'node' | 'deno' | 'bun';
type EngineId  = 'v8' | 'spidermonkey' | 'javascriptcore' | 'quickjs';

interface RuntimeCapabilities {
  supportsTypeScriptNative: boolean; supportsNpm: boolean;
  supportsCommonJS: boolean; supportsESM: boolean;
  supportsInspector: boolean; supportsProfiling: boolean; supportsHeapSnapshot: boolean;
}
interface RuntimeAdapter {
  id: RuntimeId;
  capabilities(): Promise<RuntimeCapabilities>;          // probe-backed, cached
  listVersions(): Promise<VersionInfo[]>;                 // from manifest/index endpoints
  resolveExecutable(versionSpec: string): Promise<string>;// absolute path; downloads if needed
  execute(req: RunRequest, sink: OutputSink): RunHandle;  // stdout/stderr/result events
  terminate(handle: RunHandle): Promise<void>;            // tree kill, idempotent
}

interface EngineCapabilities {
  astDump: boolean; bytecodeDump: boolean; optCodeDisasm: boolean;
  irGraphDump: boolean; deoptTrace: boolean; gcLog: boolean;
  profileSampling: boolean; perFunctionFilter: boolean;
  notes: string[];                                        // raw terminology caveats
}
interface EngineAdapter {
  id: EngineId;
  capabilities(): Promise<EngineCapabilities>;            // runs probe scripts once, caches
  analyze(req: AnalysisRequest): Promise<AnalysisResult>;
}
interface AnalysisRequest {
  code: string;                    // wrapped standalone snippet (SelectionService output)
  analysisTypes: AnalysisType[];   // 'ast'|'bytecode'|'optcode'|'ir-graph'|'deopts'|'gc'
  functionName?: string;           // filter when perFunctionFilter
}
interface AnalysisResult {
  source: string; engine: EngineId; engineVersion: string;
  analysisType: AnalysisType;
  rawOutput: string;                               // preserved VERBATIM, always shown available
  normalized?: NormalizedAnalysis;                 // best-effort, labeled as such in UI
  artifacts: { name: string; path: string }[];     // e.g. turbo-*.json files
  metadata: { flagsUsed: string[]; durationMs: number; binaryPath: string };
}
interface ManifestEntry {
  kind: 'runtime' | 'engine' | 'runtime-support';
  id: string;                       // 'node', 'd8', 'jsshell', 'jsc', 'webkit-requirements'
  platform: 'win64' | 'linux64' | 'mac64' | 'mac64arm';
  arch: 'x64' | 'arm64';
  version: string;
  url: string;                      // official source only
  sha256: string;
  license: string;
  source: 'official-dist' | 'official-canary' | 'taskcluster' | 'webkit-requirements';
  installedPath?: string; addedAt?: string;
  customBuildRequired: false;       // true entries live ONLY in the C-lane catalog
}
```

### Capability matrix (realistic, probe-gated at runtime; ✅=verified path, ⚠️=partial/probe-required, ❌=no realistic public path)

| Capability | Node | Bun | Deno | V8 (d8/d8-dbg) | SpiderMonkey (js) | JavaScriptCore (jsc) |
|---|---|---|---|---|---|---|
| Program execution (managed binaries, win64) | ✅ official dist | ✅ GH releases | ✅ GH releases | ✅ official canary rel+dbg | ✅ taskcluster/jsvu | ✅ jsvu **+WebKitRequirements DLLs** |
| Native TS execution | ⚠️ (v22+ strip-types; app uses esbuild anyway) | ✅ | ✅ | ❌ | ❌ | ❌ |
| npm packages | ✅ npm CLI | ✅ builtin install | ✅ `npm:` specifiers | ❌ | ❌ | ❌ |
| ESM + CommonJS | ✅ | ✅ | ✅ (CJS via npm: interop) | ESM ✅ CJS ⚠️ | ESM ✅ CJS ⚠️ | ESM ✅ CJS ⚠️ |
| AST dump | via d8-dbg | ❌ | ❌ | ✅ `--print-ast` (dbg only) | ✅ `reflect.parse()` object | ❌ no public dump |
| Bytecode dump | n/a (use d8) | ❌ | ❌ | ✅ `--print-bytecode --print-bytecode-filter=<fn>` (rel ok) | ⚠️ `dis(fn)` builtin; legacy `-D`; build-dependent → probe | ✅ `dumpGeneratedBytecodes` / `JSC_dumpGeneratedBytecodes=true` env |
| Optimized-code disassembly | via d8-dbg | ❌ | ❌ | ✅ `--print-opt-code --code-comments` (dbg) | ⚠️ `IONFLAGS=logs` (debug-leaning) | ✅ `dumpDisassembly/dumpBaselineDFGFTLDisassembly` (probe `needDisassemblySupport`) |
| Compiler IR graphs | via d8 | ❌ | ❌ | ✅ `--trace-turbo*` JSON (Turbolizer-compatible) | ⚠️ MIR spew text via IONFLAGS | ✅ `dumpGraphAtEachPhase`,`dumpDFG/B3/AirGraphAtEachPhase` |
| Deopt events | via d8 `--trace-deopt` | ⚠️ | ⚠️ (V8 flags passthrough limited) | ✅ | ⚠️ bailout spew | ✅ `printEachOSRExit`, `verboseDFGOSRExit` |
| Per-function filtering | — | ❌ | ❌ | ✅ built-in filters | ⚠️ manual `dis(fn)` wrapper | ✅ graphs via `dumpGraphAllowlist`; others manual |
| GC stats | ✅ `--trace-gc` | ⚠️ `Bun.gc` API | ⚠️ | ✅ `--trace-gc` | ⚠️ env-var probes | ✅ `logGC=2` |
| Sampling/CPU profiling | ✅ `--cpu-prof` | ⚠️ probe | ✅ `--cpu-prof` | ✅ `--prof` | ⚠️ | ✅ `useSamplingProfiler` + shell `--sample` |
| Heap snapshot | ✅ `v8.writeHeapSnapshot` | ✅ | ✅ | ⚠️ | ❌ | ⚠️ |
| Inspector/debugger protocol | ✅ `--inspect` (CDP) | ✅ (CDP-compatible) | ✅ (CDP) | ⚠️ d8 inspector limited | ❌ | ❌ |
| License of shipped artifact | MIT | MIT core, bundles JSC (legal-review note) | MIT | BSD-style (V8 LICENSE) | MPL-2.0 | LGPL-2.1 + BSD mix |

Rule encoded everywhere: the matrix is a *default view*; actual gating comes from `capabilities()` probes executed against the exact downloaded binary, cached per `{engine,binaryHash}`.

### MVP — v0.1 scope IN

Editor (Monaco; JS/TS/JSX diagnostics; prettier formatting; tabs), Execution (Node runtime incl. pinned-LTS download; timeout/cancel; stdout/stderr streaming; inline top-level-expression result inspection; error/stack rendering with sourcemap remap), Packages (install/remove/import-completion/search), V8 analysis (selected function/expression/file → AST/bytecode via managed d8+d8-debug; raw + normalized views; capability probing), Workspace persistence (playgrounds, settings, run history). E2E proof: select `function sum(a,b){return a+b}`, run "Analyze Bytecode", see Ignition rows.

### Deferred features — NOT in v0.1 (guardrails)

Debugger UX (breakpoints/stepping UI — only WS plumbing PoC todo 30), browser runtime, QuickJS/GraalJS adapters, CPU-profile flamechart UI, heap snapshot viewer, Turbolizer graph embedding, compare-mode export beyond markdown, marketplace/cloud sync, remote code execution/sandboxing (this is a LOCAL tool; threat model documented), macOS/Linux packaging (CI compiles but no release targets), pnpm/yarn/bun-as-installer accelerators, custom engine builds (C-lane below), telemetry.

### Custom-build lane (C-lane, explicitly separate per user constraint)

When `BinaryManager` cannot resolve a manifest artifact for `{engine, platform}` it returns `customBuildRequired: true` + recipe pointer; UI renders a distinct "Requires custom build" state (never a normal download button). Recipes maintained in `docs/custom-builds.md` starting with: V8 (`gm.py x64.release` + `v8_enable_disassembler=true v8_enable_object_print=true`), SpiderMonkey (`./mach build` debug js shell), JSC (WebKitBuild Release+Debug). NO automated building in v0.x.

### Phase breakdown (each phase: goal / modules / interfaces / files / external deps / risks / depends-on; acceptance+tests are encoded per-todo below)

- **P0 Foundations** — goal: bootable signed-architecture skeleton. Modules: monorepo, IPC contract. Files: repo layout below. Deps: none.
- **P1 Editor core** — goal: productive editing. Modules: editor/, panels/. Deps: P0.
- **P2 Node execution slice** — goal: run/cancel/inspect JS+TS on Node end-to-end. Modules: execution/, runtimes/node, packages/protocol. Interfaces: RuntimeAdapter(v0 concrete), OutputSink, RunHandle. Deps: P1.
- **P3 Result capture & inspection** — goal: structured inline results. Modules: ResultCapture, serializer, Inspector UI. Deps: P2.
- **P4 Packages** — goal: import-and-run with npm deps. Modules: PackageService, workspace dirs, ATA wiring. Deps: P2.
- **P5 V8 analysis vertical slice** — goal: THE differentiator working end-to-end. Modules: BinaryManager, engines/v8, engine-parsers, analysis drawer. Interfaces: EngineAdapter(v0 concrete), ManifestEntry, AnalysisRequest/Result. Deps: P3 (selection service lands in P1).
- **P6 Workspace persistence polish** — goal: durable daily-driver state. Deps: P2–P5.
- **P7 Abstraction extraction + multi-engine** — goal: generalize FROM working code. Modules: adapters registries, engines/spidermonkey, engines/javascriptcore, Compare UI. Deps: P5.
- **P8 Additional runtimes** — goal: Deno+Bun parity basics. Deps: P7 (interfaces), P4 (per-runtime pkg strategy).
- **P9 Perf/devtools foundations** — benchmark command; inspector plumbing PoC. Deps: P7.
- **P10 Packaging/docs** — NSIS, updater scaffold, threat-model/licensing/troubleshooting docs. Deps: all.

Repository layout to create:

```
C:\server\RuntimeHell\
  package.json  pnpm-workspace.yaml  .gitignore  tsconfig.base.json
  apps/
    main/      # Electron main (Node ESM)
      src/
        index.ts  ipc/
        execution/{execution-manager.ts,process-runner.ts,result-capture.ts,serializer.ts}
        runtimes/{types.ts,registry.ts,node/,deno/,bun/}
        engines/{types.ts,registry.ts,v8/,spidermonkey/,javascriptcore/}
        binaries/{binary-manager.ts,manifest.ts,probe.ts}
        packages/package-service.ts
        workspace/{workspace-store.ts,settings-store.ts,history.ts}
        transpile/transpile-service.ts
    preload/src/index.ts
    renderer/
      index.html
      src/
        main.tsx App.tsx
        editor/{monaco-setup.ts,selection-service.ts,prettier-worker.ts}
        panels/{console/,inspector/,analysis/,packages/,runtimes/,compare/}
        state/{run.ts,analysis.ts,workspace.ts}
  packages/
    protocol/src/{run.ts,analysis.ts,manifest.ts,ipc-channels.ts,schemas.ts}
    engine-parsers/src/{v8-bytecode.ts,v8-deopt.ts,sm-dis.ts,jsc-bytecode.ts}
    engine-parsers/fixtures/*.txt
  resources/ icons etc.
  docs/{threat-model.md,engines-licensing.md,windows-troubleshooting.md,custom-builds.md}
  .github/workflows/ci.yml
```

### Risk register

| Risk | Severity | Mitigation (encoded in todos) |
|---|---|---|
| Engine flag/output drift across versions (bytecode format changes every V8 release; SM/JSC internals move faster) | High | Version-tag parsers; tolerant pass-through parsing (never throw); golden fixtures regenerated per binary; normalized view always labeled best-effort; rawOutput always preserved verbatim (todo 18) |
| Historical version pinning of V8 dbg canaries may be limited (only `-latest.json` + addressable zips confirmed) | Medium | MVP uses latest dbg canary; milestone-guess helper marked experimental (todo 15); pinning research is an implementation probe, not an assumption |
| SpiderMonkey/JSC dump features need debug-ish builds or missing DLLs | Medium | Capability PROBES decide features per binary (todo 16); JSC auto-manages WebKitRequirements into child PATH only (todo 25); missing capability = disabled UI action, never a crash |
| Windows process-tree leaks (orphaned children) | Medium | taskkill /T /F + idempotent terminate + orphan sweep on app start (todo 8); Job Object hardening listed as follow-up |
| Defender/SmartScreen friction with unsigned downloads | Medium | checksum verify + docs/windows-troubleshooting.md; signing guidance in todo 31 |
| Arbitrary-code execution (supply chain: postinstall scripts) | Medium | ignore-scripts default ON; runs confined to workspace cwd with sanitized env; timeouts; threat-model doc states plainly this is NOT a security sandbox (todo 13, 32) |
| node_modules long-path/onefile issues on Windows | Low-Med | workspaces under `%USERPROFILE%\RuntimeHell\workspaces` (short root); long-path doc; npm default config untouched |
| esbuild/babel transform breaks unusual user syntax (decorators/TS5 exotic) | Medium | transform failure falls back to plain-file execution WITHOUT expression results (feature degradation, never failure) (todo 10) |
| ATA/network unavailable → no package types | Low | editor still functional; explicit status chip (todo 14) |
| Licensing exposure if we ever SHIP engines inside installer | High (avoided) | D2 forbids bundling; docs/engines-licensing.md records per-artifact licenses; Bun's bundled-JSC noted for legal review (todo 32) |

### Roadmap v0.1 → full

v0.1 = P0–P6 (todos 1–22) → v0.2 = abstraction extraction + SpiderMonkey + JSC + Compare (23–26) → v0.3 = Deno/Bun + version-selector UX (27–28) → v0.4 = benchmarking + inspector plumbing (29–30) → v1.0 = packaging/updater/docs (31–32). Beyond v1.0 backlog (not planned here): debugger UX, browser runtime, QuickJS/GraalJS, Turbolizer embed, profiling viewers, Linux/macOS releases, C-lane automated recipes.

## Verification strategy

- Per-todo QA (agent-executed): happy + failure scenario each, evidence written to `.omo/qa/t<N>-<slug>.md` including exact commands and observed output excerpts. Failure scenario must demonstrate graceful behavior (e.g., cancel mid-infinite-loop kills process tree; corrupted download rejected by checksum; unknown flag → capability probe marks unsupported, UI disables action).
- Unit/integration: vitest. Pure logic (parsers, serializer, manifest math, selection wrapping) gets TDD-style fixture tests. Integration tests spawn REAL downloaded binaries when present in cache; otherwise skip with explicit `SKIPPED(no-binary)` marker so CI on clean machines stays green while dev machines prove reality.
- E2E: Playwright `_electron` driving the packaged dev app: type program → run → inspect; select function → analyze bytecode → assert table rows exist.
- Golden fixtures: parser tests run against recorded outputs checked into `packages/engine-parsers/fixtures/` (regeneration script included; fixtures carry generator binary version in header comment).
- Final verification wave F1–F4 (below) must all APPROVE before completion claim; misleading-success guard: every done-claim cites the exact command + artifact; grep hits alone insufficient.

## Execution strategy

Waves map 1:1 to phases above; wave = 3–6 todos executed sequentially within the wave, waves ordered by dependency (P0→…→P10). Worker executes one todo at a time, runs its QA, commits (see Commit strategy), then proceeds. Any todo blocked >2 attempts → stop wave, record blocker in `.omo/blockers.md`, continue with independent next wave if possible. Abstractions are extracted ONLY in todo 23+ (refactor, behavior-preserving, existing tests must remain green before and after). No engine-specific strings ever appear under `renderer/` except through protocol enums.

## Todos

- [x] 1. Scaffold pnpm monorepo + electron-vite app with typed IPC round-trip
  - References: Scope→Architecture (layout), D1; create exactly the tree under "Repository layout to create" (empty module files allowed as stubs with TODO markers, but apps/main must boot).
  - Acceptance: `pnpm i && pnpm dev` launches an Electron window rendering a React root; `contextIsolation:true`, `nodeIntegration:false`; preload exposes typed `window.api.ping()` → main replies `'pong'` via zod-validated channel `app:ping`; `pnpm typecheck` passes across all three TS projects; vitest runs one smoke test asserting the preload channel schema.
  - QA happy: `.omo/qa/t01-boot.md` records `pnpm dev` launch log + ping/pong assertion output. QA failure: corrupt the zod schema intentionally → test fails with schema error, record in same file, then fix.
  - Commit: `chore(p0): scaffold electron-vite monorepo with typed ipc bridge`

- [ ] 2. CI pipeline (Windows-first)
  - References: Scope→D1; `.github/workflows/ci.yml`.
  - Acceptance: GH Actions workflow runs on `windows-latest` (required) + `ubuntu-latest` (allowed-fail initially): pnpm install w/ cache, lint, typecheck, unit tests, `electron-builder --dir` smoke producing unpacked exe artifact. Badge in README.
  - QA happy: link to first green run URL in `.omo/qa/t02-ci.md`. QA failure: push commit breaking typecheck → CI red screenshot/log excerpt recorded, then revert.
  - Commit: `chore(ci): windows-first github actions pipeline`

- [x] 3. Shared protocol package (zod schemas for every cross-process payload)
  - References: Scope→Architecture interfaces block; `packages/protocol/src/*`.
  - Acceptance: schemas+types exported for RunRequest/RunEvent(stdout|stderr|result|exit|error)/RunResult/AnalysisRequest/AnalysisResult/ManifestEntry/RuntimeCapabilities/EngineCapabilities/ipc-channel name union; unit tests cover parse(serialize(x))==x round-trips and rejection of malformed payloads (missing sha256 in ManifestEntry etc.).
  - QA happy: `.omo/qa/t03-protocol.md` with passing round-trip test names. QA failure: inject invalid AnalysisResult (unknown analysisType) → zod rejects, test asserts rejection, evidence recorded.
  - Commit: `feat(protocol): zod contracts for run, analysis, manifest payloads`

- [ ] 4. Monaco integration with TS/JS/JSX diagnostics
  - References: Evidence fact 6; `apps/renderer/src/editor/*`.
  - Acceptance: monaco-editor imported via Vite `?worker` pattern for editor+ts workers; model language switches by file extension (.js/.mjs/.ts/.tsx/.jsx); `typescriptDefaults.setCompilerOptions({target: ESNext, jsx: Preserve, allowNonTsExtensions: true, allowJs: true})`; semantic diagnostics visible (test: type error `const x:string=1` produces marker); hover works on lib functions.
  - QA happy: Playwright _electron script opens window, sets model content with deliberate type error, asserts marker count ≥1 (`.omo/qa/t04-monaco.md`). QA failure: break worker import path → diagnostics silently absent → test asserts markers appear AFTER fix (record both states).
  - Commit: `feat(editor): monaco with ts/js/jsx language workers and diagnostics`

- [ ] 5. Formatting + selection service
  - References: Scope→P1; prettier standalone + `plugins/{typescript,babel,estree}` in web worker.
  - Acceptance: Shift+Alt+F formats current model via prettier worker (idempotent second format = zero diff); SelectionService exposes `{text, range, kindGuess}` where kindGuess ∈ expression|statement|function|class|block|module computed via `@babel/parser` range intersection on full document (unit-tested with 10+ fixtures covering each kind incl. class methods, arrow bodies, JSX elements).
  - QA happy: unit test log + manual keybinding demo recording path in `.omo/qa/t05-format-select.md`. QA failure: selection spanning two top-level statements → kindGuess='block', wrapper (todo 20) will IIFE-wrap; unit test proves classification, evidence recorded.
  - Commit: `feat(editor): prettier worker formatting and ast-based selection classification`

- [ ] 6. App shell layout (editor left, output right/bottom, resizable, tabbed files)
  - References: Scope→MVP editor bullet.
  - Acceptance: dockable split layout (editor zone / bottom drawer with tabs Console|Inspector|Analysis|Packages|Runtimes), draggable splitters persist proportions to settings store; multi-tab bar with dirty indicators; Ctrl+S saves file to workspace dir; Ctrl+Enter triggers run-event placeholder bus (no executor yet — emits `run:requested` consumed by a no-op listener that logs).
  - QA happy: `.omo/qa/t06-shell.md` with screenshots of layout + persistence after reload. QA failure: kill app mid-edit → reopen shows dirty indicator restored from autosave (todo 22 finalizes; here assert file written on Ctrl+S only).
  - Commit: `feat(ui): resizable shell layout with panel drawers and file tabs`

- [ ] 7. RuntimeManager v0: system Node detection + pinned-LTS download/verify/cache/remove
  - References: Evidence facts 5; `apps/main/src/binaries/*` (shared downloader lands here FIRST, engines reuse it in todo 15); D2 constraints.
  - Acceptance: detects system-installed node (`where.exe node` + spawn `--version`, absolute path captured); lists versions from `https://nodejs.org/dist/index.json` (defensive parse: tolerate extra/missing optional fields, require version+lts+files); downloads `node-v{ver}-win-x64.zip`, verifies SHA-256 against `SHASUMS256.txt`, atomically extracts (temp dir → rename) to `%LOCALAPPDATA%\RuntimeHell\runtimes\node\{version}\`, writes/upserts `manifest.json` ManifestEntry (sha256 recorded, source:'official-dist'); `remove(version)` deletes dir + manifest row (refuses if entry missing); all operations stream progress events.
  - QA happy: download pinned LTS (e.g., v22.x) on real machine; spawn downloaded exe `--version`; manifest inspected in evidence `.omo/qa/t07-runtime-mgr.md`. QA failure: tamper 1 byte of zip → sha mismatch → install aborted + partial temp removed (assert no orphan dir), evidence recorded.
  - Commit: `feat(binaries): runtime manager with checksummed node distribution installs`

- [ ] 8. ProcessRunner: isolated execution with timeout, tree-cancel, streaming, crash recovery
  - References: Scope→Architecture isolation paragraph; `apps/main/src/execution/process-runner.ts`.
  - Acceptance: spawns executable by ABSOLUTE path, cwd=workspace dir, env = minimal allowlist (PATH trimmed to system32+node dir, no inherited secrets — document exact env policy in code comment); captures stdout/stderr chunks → coalesced ≥16ms events; timeout timer default 5000ms (configurable per run) → tree-kill via `taskkill /pid <pid> /T /F` (win) with fallback `kill()`; cancel() idempotent; exit event carries {code, signal, durationMs, killedBy}; crash (spawn ENOENT/EACCES) surfaces as structured RunError, never throws unhandled; orphan sweep utility kills stale PIDs recorded in run-journal on startup.
  - QA happy: run `console.log('hi')` via downloaded node → events sequence logged (`.omo/qa/t08-runner.md`). QA failure scenarios BOTH tested: (a) `while(true){}` → cancel → process gone (assert via `process.kill(pid,0)` throwing) + children reaped; (b) executable path deleted mid-flight → RunError event with actionable message.
  - Commit: `feat(execution): hardened process runner with tree-cancel and crash recovery`

- [ ] 9. TranspileService (esbuild) with sourcemap remap
  - References: D5; `apps/main/src/transpile/transpile-service.ts`.
  - Acceptance: .ts/.tsx inputs transformed (loader matching extension, format cjs for node v0.x, sourceMap external) into `workspaces/{id}/.rhbuild/entry.{cjs,mjs}`; stack-trace lines from runtime errors remapped to ORIGINAL positions using source maps before display (unit test: synthetic error in TS maps back to authored line); non-TS files pass through unchanged (copy); transform failure returns structured error with esbuild message array.
  - QA happy: run TS sample with deliberate TypeError → rendered stack points at original .ts line (evidence `.omo/qa/t09-transpile.md`). QA failure: syntax-error TS file → structured esbuild diagnostics shown in Console panel (screenshot/log), runner never invoked.
  - Commit: `feat(transpile): esbuild pipeline with sourcemap-based stack remapping`

- [ ] 10. ResultCapture: top-level expression reporting + value serializer
  - References: Scope→P3; TDD-permitted pure modules; `result-capture.ts`, `serializer.ts`, `packages/engine-parsers` untouched here.
  - Acceptance: babel plugin injects `__rh.report(index, value)` after each top-level EXPRESSION statement and variable declaration initializer (config flag, default on); bootstrap prelude defines `__rh.report` writing NDJSON to fd 3, AND unconditionally implements the stderr sentinel prefix `__RH__:` path; a one-time startup probe decides fd-3 passthrough support on Windows and caches the transport choice — fd3 is never load-bearing; serializer handles primitives, objects, arrays, Map/Set, Date/RegExp, Error(+stack), Promise(state/value settled-only), functions/classes (name+arity flag), TypedArrays/DataView (type+len+first N), circular refs (reference-id back-edges), depth cap 20, node cap 5000, string truncation 10k chars — all caps configurable; unit tests cover EVERY type incl. circular + 100k-element array truncation + BOTH transports.
  - QA happy: program mixing all types → serialized tree asserted equal to golden JSON (`.omo/qa/t10-capture.md`). QA failure: self-referential object + getter that throws → report still emitted (throwing getter replaced by `<threw>` marker), evidence recorded.
  - Commit: `feat(results): expression-level capture transform and capped structural serializer`

- [ ] 11. Console + Inspector UI wired to real runs
  - References: Scope→P3 UI.
  - Acceptance: Ctrl+Enter executes current file via RuntimeManager-selected node (system or downloaded) through ProcessRunner+TranspileService+ResultCapture; Console tab shows merged stdout/stderr with error styling and remapped stacks; Inspector tab renders reported values as virtualized expandable tree (react-window) honoring serializer caps; status badge shows runtime/version/duration/exit code; Auto-run toggle (debounced 800ms); Cancel button enabled during run only.
  - QA happy: demo program (async top-level await fetch-less promise chain + Map + Error throw caught) → console lines + inspectable tree screenshots `.omo/qa/t11-inspector-ui.md`. QA failure: infinite loop + Auto-run ON → debounce does not stack runs (single running handle enforced), Cancel terminates, UI returns idle — timings recorded.
  - Commit: `feat(ui): live console and virtualized value inspector bound to execution`

- [ ] 12. Multi-runtime groundwork: version selector UI reading RuntimeManager
  - References: Scope→MVP "runtime version selector".
  - Acceptance: Runtimes panel lists detected system node + installed/downloadable versions (from todo 7 index parse); selecting uninstalled version streams progress and flips to ready on completion; per-workspace override stored; **executable resolution order implemented and displayed: managed selected version → system installation → offer managed download**; removal button (disabled while version in use by a run).
  - QA happy: install v22 LTS via UI, run sample, uninstall after `.omo/qa/t12-runtime-ui.md` evidence. QA failure: network cut mid-download → progress errors, temp cleaned, manifest unchanged (assert), retry succeeds after reconnect.
  - Commit: `feat(runtimes): version selector ui backed by managed installs`

- [ ] 13. PackageService: npm operations scoped to workspaces
  - References: D7; `apps/main/src/packages/package-service.ts`.
  - Acceptance: ensure-workspace creates `package.json` ({"private":true,"type":"commonjs"} default) on first dep op; **npm executable resolved per D7 order (managed active runtime's bundled npm → PATH npm → structured error with actionable setup guidance)**; install/uninstall/list via spawned npm CLI (`--ignore-scripts` unless setting off) streaming parsed progress lines; search panel queries registry search endpoint (size 20, abortable); failures surface npm stderr verbatim in Packages panel log area.
  - QA happy: `npm i lodash` in workspace → import works in next run (evidence `.omo/qa/t13-packages.md`). QA failure: install nonexistent package `@rh/nope-xyz` → npm error text displayed, workspace package.json unchanged (hash-compared before/after).
  - Commit: `feat(packages): workspace-scoped npm install remove search with progress`

- [ ] 14. Import IntelliSense via @typescript/ata
  - References: Evidence fact 6; renderer ts-worker setup.
  - Acceptance: ATA delegate receives type files for imports (lodash/zod smoke) → added via `addExtraLib`; re-acquisition debounced on package.json change; offline → status chip "types unavailable (offline)" and editor fully usable; completions offer installed package exports (assert via monaco completion API in Playwright step).
  - QA happy: type `import _ from 'lodash'` → hover on `_.chunk` shows signature (`.omo/qa/t14-ata.md`). QA failure: bogus import `'nonexistent-pkg-xyz'` → no crash, ATA settles, chip shows unresolved, evidence recorded.
  - Commit: `feat(editor): automatic type acquisition for installed packages`

- [ ] 15. BinaryManager generalization + engine manifest seed (V8 first)
  - References: Evidence facts 1,5; D2 constraints; C-lane section.
  - Acceptance: todo-7 downloader generalized behind ManifestEntry schema (kind:'engine'); generalization is BEHAVIOR-PRESERVING — runtime install tests from todo 7/12 stay green unmodified; seed manifest sources implemented: v8 rel+dbg via chromium-v8 official canary URLs incl. `*-latest.json` discovery + EXPERIMENTAL milestone-guess helper for historical pins (marked experimental in code+UI tooltip); spidermonkey/jsc entries declared but DISABLED until todos 24/25 (schema-ready); every resolved artifact hash-verified before install; C-lane: resolver returning `customBuildRequired:true` when no artifact source covers {engine,platform} → UI state per C-lane spec (unit-testable resolver decision table covering v8-win64 ✅, sm-win64 ✅, jsc-win64 ✅(+support entry webkit-requirements), quickjs-win64 ✅ future, v8-macos-arm64 ✅, hypothetical missing combo → C-lane).
  - QA happy: download d8-dbg latest win64; `d8 --version` executes; manifest row present (`.omo/qa/t15-binary-manager.md`). QA failure: wrong-size artifact (truncated download) → sha reject, atomic temp cleanup, no manifest mutation.
  - Commit: `feat(binaries): general manifest-driven engine downloader with v8 seed and c-lane resolution`

- [ ] 16. EngineRegistry + capability probe framework
  - References: Capability matrix rule ("probes decide"); `apps/main/src/engines/{types.ts,registry.ts,binaries/probe.ts}`.
  - Acceptance: probe framework runs per-engine scripted checks against the exact binary (e.g., V8: echo-marker script under `--print-bytecode` presence of `[generated bytecode` in output ⇒ bytecodeDump=true; `--print-ast` attempt only on dbg binaries ⇒ astDump) caching results keyed by binary sha256; EngineCapabilities surfaced to renderer; UI actions disabled (tooltip reason) when capability false; registry exposes analyze() dispatch stubbed per-engine.
  - QA happy: probe against downloaded rel d8 → astDump=false, bytecodeDump=true; against dbg d8 → both true (`.omo/qa/t16-probes.md`). QA failure: point registry at node.exe masquerading as engine binary → probes fail cleanly → capabilities all-false + UI shows "not a valid engine binary".
  - Commit: `feat(engines): registry with sha-keyed capability probing and ui gating`

- [ ] 17. V8EngineAdapter: six analysis types end-to-end
  - References: Evidence fact 1 flags; AnalysisRequest/Result contracts.
  - Acceptance: implements ast(dbg)/bytecode(rel|dbg)/optcode(dbg)/ir-graph(--trace-turbo --trace-turbo-path to temp dir; ALL *.json emitted into that directory are collected as artifacts — exact file naming verified during QA against real d8, never assumed)/deopts(--trace-deopt)/gc(--trace-gc); wraps SelectionService output (todo 20 provides wrapping; here accept prepared file); applies `--print-bytecode-filter=<fn>` when functionName provided and capability perFunctionFilter; assembles AnalysisResult verbatim rawOutput + metadata.flagsUsed/engineVersion(`d8 --version`)/durationMs; per-analysis timeout reuses ProcessRunner.
  - QA happy: `function sum(a,b){return a+b}; sum(1,2)` → bytecode run yields output containing `[generated bytecode for function: sum]` (`.omo/qa/t17-v8-adapter.md`). QA failure: request optcode on REL binary → capability gate rejects BEFORE spawn with explanation (no wasted process), logged.
  - Commit: `feat(engines): v8 adapter covering ast bytecode optcode ir-graph deopts gc`

- [ ] 18. V8 bytecode/deopt parsers + golden fixtures
  - References: Evidence fact 1 output shape (Parameter count/Register count/Frame size/Constant pool lines); `packages/engine-parsers/*`.
  - Acceptance (TDD): v8-bytecode parser converts blocks `[generated bytecode for function: X]` into NormalizedAnalysis{functions:[{name,parameterCount,registerCount,frameSize,instructions:[{offset,bytecode,operands[],sourceHint?}],constantPool[],handlerTable[]}]} tolerant to unknown lines (passed through as `rawLines` on nearest block, NEVER thrown); deopt parser extracts {functionName,reason,location,bytecodeOffset} from `--trace-deopt` lines; fixtures generated by executing REAL downloaded d8 during QA and committed with generator-version header; regeneration script `pnpm gen-fixtures`.
  - QA happy: parser golden test passes on committed fixtures incl. one ≥200-instruction function (`.omo/qa/t18-parsers.md`). QA failure: feed truncated/garbage fixture → parser returns partial + rawLines, no exception (assert), evidence recorded.
  - Commit: `feat(parsers): tolerant v8 bytecode and deopt parsers with golden fixtures`

- [ ] 19. Analysis drawer UI (raw-first)
  - References: Scope→MVP analysis bullets; D4 (no engine terms outside engines layer).
  - Acceptance: context menu on selection: Analyze ▸ {AST, Bytecode, Optimized code, IR graph, Deopts, GC} — items disabled by capability probe with reason tooltips; drawer tabs Raw (monospace, verbatim) | Normalized (table from parsers; header banner "best-effort normalization — raw output is authoritative") | Artifacts (turbo-*.json listing); engine picker shows engine@version+binary origin; Copy raw button; requests cancellable while process alive.
  - QA happy: analyze sum() bytecode → normalized table rows visible + raw tab byte-identical to captured stdout (diff-checked) `.omo/qa/t19-analysis-ui.md`. QA failure: cancel analysis mid-run → process killed, drawer shows cancelled state, no zombie (runner journal asserted).
  - Commit: `feat(ui): analysis drawer with raw and normalized views and capability-aware actions`

- [ ] 20. SelectionService wrapping strategies (safe standalone snippets)
  - References: todo 5 kindGuess; Scope→user §7 requirement (fragments not independently executable must wrap safely).
  - Acceptance (TDD): deterministic wrappers per kind — expression→emit `__rh.report(<seq>, (<expr>))` reusing the ResultCapture bootstrap from todo 10 (analysis runs include the bootstrap; when the target shell cannot load it, fall back to `console.log(repr(<expr>))`, repr = structural inspect); function/class→emit source verbatim + harness invoking with placeholder args ONLY when user opts "with sample invocation" (default OFF for analysis: definitions alone compile fine for bytecode); statements/block→async IIFE; module-kind→verbatim file; ALL wrappers emitted as standalone .mjs written to workspace `.rhbuild/analysis/` with header comment showing exact emitted code; UI toggle "show generated wrapper" displays it pre-run; unit tests ≥15 cases (arrow implicit return, class static blocks, JSX element, top-level await snippet, destructured export fragments).
  - QA happy: select bare expression `users.filter(x=>x.active)` (with `users` defined above in file) → wrapped snippet runs standalone producing bytecode for filter callback (`.omo/qa/t20-wrapping.md`). QA failure: selection referencing undefined identifier → engine reports ReferenceError in Raw tab (expected, clearly surfaced as analysis-of-broken-snippet), no app crash.
  - Commit: `feat(selection): safe standalone wrapping strategies with transparent preview`

- [ ] 21. WorkspaceStore + Settings + History (persistence core)
  - References: Scope→MVP workspace bullet; `apps/main/src/workspace/*`.
  - Acceptance: workspaces CRUD under `%USERPROFILE%\RuntimeHell\workspaces\{id}\` (id=nanoid; files stored verbatim); settings store in `%APPDATA%\RuntimeHell\settings.json` with versioned migrations (v1 defaults: timeoutMs 5000, autorun false, ignoreScripts true, defaultRuntime 'node'); history ring buffer last 100 runs per workspace (request snapshot + result summary + timestamps) persisted and viewable; autosave debounce 500ms on edit; session restore reopens previous tabs/workspaces exactly.
  - QA happy: create workspace, edit 3 files, restart app → identical state restored (file hashes compared) `.omo/qa/t21-persistence.md`. QA failure: hand-corrupt settings.json → app boots on defaults + backup of corrupt file saved alongside (assert), never crashes.
  - Commit: `feat(workspace): persistent workspaces settings history with session restore`

- [ ] 22. v0.1 vertical-slice E2E hardening (release-candidate gate)
  - References: MVP definition; all prior todos.
  - Acceptance: Playwright _electron suite covering THE slice: fresh workspace → type TS program using lodash → run (auto-transpile) → inspect Map result → select `function sum(a,b){return a+b}` → Analyze Bytecode (d8-dbg) → assert normalized rows contain `sum` + ≥3 instruction rows + Raw tab non-empty; suite green twice consecutively on clean cache (cold-start download path included); cold-start duration logged.
  - QA happy: full-suite run log `.omo/qa/t22-e2e.md` with assertions echoed. QA failure: delete engine cache between runs → second run exercises download path and still passes (timing captured), proving recovery.
  - Commit: `test(e2e): v0.1 vertical slice suite with cold-start recovery coverage`

- [ ] 23. REFACTOR: extract RuntimeAdapter/EngineAdapter from proven implementations
  - References: D3 (abstraction AFTER working code); Architecture interface block.
  - Acceptance: node runtime + v8 engine reimplemented AS adapters implementing the protocol interfaces; registries with id-based lookup; call sites (ExecutionManager/AnalysisManager/UI) consume ONLY registry lookups; ZERO behavioral change — todos 8/11/17/22 suites pass UNMODIFIED before and after; diff review confirms no new features smuggled in (pure extraction; any discovered bug fixed in separate commit flagged in evidence).
  - QA happy: full existing suite green post-refactor + architecture rule greps (no 'v8'/'--print-' literals under apps/renderer/src) recorded `.omo/qa/t23-refactor.md`. QA failure: temporarily reintroduce engine literal in renderer → grep gate fails in CI (rule added to lint), evidence recorded, reverted.
  - Commit: `refactor(adapters): extract runtime and engine adapter registries preserving behavior`

- [ ] 24. SpiderMonkeyAdapter (capability-probed)
  - References: Evidence fact 2; matrix column SM.
  - Acceptance: manifest entry via jsvu-compatible taskcluster win64 jsshell source (URL scheme verified at implementation; if taskcluster auth/retention blocks direct fetch, FALLBACK documented+implemented: drive `npx jsvu --os=win64 --engines=spidermonkey` programmatically and adopt its installed binary into our cache+manifest); probes decide dis()-availability (script defines fn, calls dis(fn), checks output markers); analyses: bytecode via dis-wrapper file, ast via reflect.parse(...).toSource()/JSON serialization captured from shell, deopts/JIT-spew ONLY when probe detects debug-capable binary (IONFLAGS env injection supported in adapter options); normalized SM parser for dis() output (loc/op/source-notes tables) with fixtures from real binary.
  - QA happy: analyze same sum() on SpiderMonkey → Raw contains SM opcode names (independent terminology asserted, e.g., not LdaZero) `.omo/qa/t24-sm.md`. QA failure: force-disable probe (mock) → Bytecode action disabled with reason, no spawn attempted.
  - Commit: `feat(engines): spidermonkey adapter with dis-based bytecode and reflect.parse ast`

- [ ] 25. JavaScriptCoreAdapter (+WebKitRequirements support artifact)
  - References: Evidence fact 3; matrix column JSC.
  - Acceptance: manifest entries jsc (source:'taskcluster'/'webkit-requirements' as applicable) PLUS support artifact webkit-requirements zip (sha256-verified) extracted under our cache and injected into CHILD process PATH only (never user/system PATH; adapter composes env per-run); options driven via `JSC_*` env vars (verified in OptionsList.h) preferring env over CLI-flag parsing drift: bytecode=`JSC_dumpGeneratedBytecodes=true`, deopts=`JSC_printEachOSRExit=true`, gc=`JSC_logGC=2`, graphs=`JSC_dumpGraphAtEachPhase=true` (+artifact collection of dumped files, location verified at impl and asserted in tests); per-function via `JSC_dumpGraphAllowlist` file for ir-graph type when capability allows; jsc parser for bytecode dump format + fixtures.
  - QA happy: analyze sum() on jsc → bytecode raw contains JSC opcodes; child PATH contains requirements dir ONLY within that run (env snapshot asserted) `.omo/qa/t25-jsc.md`. QA failure: remove requirements dir → probe fails with actionable error referencing support artifact, UI offers "repair" redownload.
  - Commit: `feat(engines): javascriptcore adapter with managed webkitrequirements and env-driven dumps`

- [ ] 26. Compare-engines mode
  - References: user §8; D4 terminology preservation.
  - Acceptance: select fragment → Compare ▸ pick ≥2 probed engines → fan-out parallel AnalysisRequests (shared wrapper from todo 20 ensures IDENTICAL input); unified result grid rows={engine,version,analysisType} columns Raw|Normalized toggles; engine columns titled with RAW engine terminology (e.g., V8 "Ignition bytecode", SM "dis() bytecode + source notes", JSC "LLInt/generated bytecode") — mapping table constant lives in engines layer; export current comparison to markdown file via save dialog; cancellation cancels whole fan-out.
  - QA happy: V8+SM+JSC compare of sum() renders 3 rows with distinct opcode vocabularies — assert V8 raw matches /\b(Lda|Star|Mov|CallProperty)/ AND SM raw contains dis-table headers (`loc`, `op`) AND neither raw contains the other's signature tokens `.omo/qa/t26-compare.md`. QA failure: one engine lacks capability (rel d8 for AST) → row renders "unsupported (reason)" while others complete — partial success semantics asserted.
  - Commit: `feat(compare): multi-engine comparison grid with raw terminology and md export`

- [ ] 27. Deno + Bun runtime adapters
  - References: Evidence facts 5; matrix columns; P8.
  - Acceptance: DenoAdapter/BunAdapter behind extracted interfaces; managers resolve versions via GitHub releases APIs (asset patterns verified; sha256 digest field primary, sidecar .sha256sum fallback for Deno; baseline variant selection for Bun exposed as advanced toggle); capabilities: deno/bun supportsTypeScriptNative=true → TranspileService bypassed (assert no .rhbuild emitted); permission model: Deno runs with explicit `--allow-all` OFF by default — default deny with per-run permission checkboxes mapped to flags; bun baseline CPU check documented; per-runtime package strategy: Deno npm-natural imports allowed via `npm:` specifier hint in UI when runtime=deno and bare import fails once.
  - QA happy: run same TS sample on node(transpiled)/deno(native)/bun(native) — outputs equivalent; evidence includes three run manifests `.omo/qa/t27-runtimes.md`. QA failure: deno run needing net permission with deny-default → permission error surfaced with hint linking permission checkboxes.
  - Commit: `feat(runtimes): deno and bun adapters with native ts and permission controls`

- [ ] 28. Runtime/engine pairing UX + disk management
  - References: D4 display rule; Runtimes panel evolution.
  - Acceptance: pairing info displayed (Node→V8, Deno→V8, Bun→JavaScriptCore) as informational chips linking to docs/engines-licensing.md anchors; cache manager screen lists installed runtimes+engines+support artifacts with sizes, per-item removal, aggregate disk usage; removal blocked while referenced by open workspace default OR running process.
  - QA happy: install node+v8-dbg+jsc+requirements → usage sums correct → remove unused jsc OK, removal of in-use node blocked `.omo/qa/t28-disk.md`. QA failure: double-remove race (two clicks) → second call no-ops idempotently, manifest consistent.
  - Commit: `feat(ui): runtime engine pairing info and cache disk management`

- [ ] 29. Benchmark command (selection microbenchmarks)
  - References: user §15 example; Evidence fact 7 tinybench.
  - Acceptance: selection/context command Benchmark wraps target fn into generated harness importing tinybench (auto-installed as devDependency of workspace on first use, version pinned in workspace package.json); runs via CURRENTLY SELECTED runtime; parses bench summary → table {ops/sec, mean, p50/p95, samples}; environment header records runtime+version+engine pairing+CPU name (via os.cpus on host, labeled host-CPU); warmup+min-samples enforced by tinybench defaults, iterations configurable.
  - QA happy: benchmark `foo()` from user §15 → table renders plausible ops/sec (>0, finite) `.omo/qa/t29-bench.md`. QA failure: benchmarking code that throws on first call → harness catches, error surfaced, no partial stats rendered.
  - Commit: `feat(bench): selection microbenchmark harness with percentile reporting`

- [ ] 30. Inspector plumbing PoC (--inspect websocket attach)
  - References: user §14 (explicitly NOT debugger UX in v0.x).
  - Acceptance: hidden dev command "Attach inspector": launches node `--inspect=0`, parses ws URL from stderr, establishes CDP WebSocket from MAIN process, receives `Debugger.paused` on injected `debugger;` statement, logs paused/resumed/resumed-lifecycle events to a diagnostic file, clean detach+kill on close. Deliverable = plumbing + logs, NO breakpoint UI. Explicitly marked internal/dev-only menu item.
  - QA happy: attach → pause event received and logged with callframes count `.omo/qa/t30-inspector.md`. QA failure: runtime lacking inspector (future engines) → command disabled via capabilities.supportsInspector.
  - Commit: `feat(debugger): inspector websocket plumbing poc behind dev menu`

- [ ] 31. Packaging: NSIS installer + updater scaffold + single-instance
  - References: D1/D2 (installer ships no engines); P10.
  - Acceptance: electron-builder targets nsis (+portable), icon set, appId/company metadata; single-instance lock with focus-restore; crash logging to `%APPDATA%\RuntimeHell\logs` (main+renderer handlers, last 20 retained); electron-updater integrated but DISABLED by default behind settings flag (no update server configured yet) — enabling without server logs clear warning; installer size budget note documenting why it stays small (no engines bundled).
  - QA happy: built installer on clean VM/second machine installs, launches, passes t22-lite subset `.omo/qa/t31-package.md`. QA failure: launch second instance → first focused, second exits code 0 (asserted).
  - Commit: `chore(package): nsis portable targets crash logs and updater scaffold`

- [ ] 32. Docs pack: threat model, licensing, Windows troubleshooting, custom-builds, README
  - References: risk register; C-lane; D2 constraints restated for posterity.
  - Acceptance: docs/threat-model.md (local tool posture, what isolation IS and ISN'T, supply-chain mitigations incl. ignore-scripts default), docs/engines-licensing.md (per-artifact license table incl. Bun bundled-JSC legal-review note, download-source provenance policy = official endpoints only), docs/windows-troubleshooting.md (Defender/SmartScreen, long paths, WebKitRequirements, taskkill perms), docs/custom-builds.md (C-lane recipes V8/SM/JSC with exact gn/mach/build flags), README (features, screenshots, dev setup). All claims in docs traceable to evidence ledger or marked assumption.
  - QA happy: docs lint (markdown link checker) green; every engine flag mentioned in docs appears in engines-layer code or fixtures (cross-check script) `.omo/qa/t32-docs.md`. QA failure: introduce fake flag into doc draft → cross-check script fails → removed (proof the guard works).
  - Commit: `docs: threat model licensing troubleshooting custom-build recipes readme`

## Final verification wave

- [ ] F1. Plan compliance audit — verify shipped repo matches this plan: template sections honored, Must-NOT-Have respected (Deferred list absent from v0.1 code paths), every todo has QA evidence file with real commands+outputs (spot-open 5 random evidence files; reject self-report-only). Evidence: `.omo/qa/F1-audit.md`.
- [ ] F2. Code quality review — architecture rules hold: no engine literals under renderer/, adapters sole owners of engine/runtime specifics, zod validation at every IPC boundary, strict TS (`tsc --noEmit` clean), no unhandled-rejection paths in main process (grep + targeted tests). Evidence: `.omo/qa/F2-quality.md`.
- [ ] F3. Real manual QA — execute scripted user journey on the PACKAGED installer build: install → write TS+lodash program → run → cancel infinite loop → install zod → analyze sum() bytecode on d8-dbg → compare V8 vs SM vs JSC → benchmark foo() → restart → state restored. Record every step with screenshots/logs. Evidence: `.omo/qa/F3-manual.md`.
- [ ] F4. Scope fidelity — diff delivered feature set against MVP IN list and Deferred NOT-IN list; confirm C-lane never offered as normal download anywhere in UI (walk all engine/version-missing states). Evidence: `.omo/qa/F4-scope.md`.

ALL FOUR must APPROVE; results surfaced to user; explicit user okay required before declaring complete.

## Commit strategy

Conventional commits, one commit per todo (scope tags p0…p10 as in Commit lines above). Trunk-based on `main`; every push runs CI (todo 2); a wave = merge-ready state (all wave todos committed + QA evidence present). Refactor commits (todo 23) must be isolated and reference pre/post green suite runs in their message body. Never mix feature+generated-fixtures regen in one commit (fixtures get `chore(fixtures): regenerate …` commits citing generator binary version). Tags: `v0.1.0` after F-wave approval.

## Success criteria

1. The §Important Planning Principle slice demonstrably works end-to-end on Windows: Editor → Node execution → selected function → V8 bytecode output (t22 proves it; F3 replays it on the installer build).
2. All v0.1 MVP bullets (Scope→MVP) demonstrably work; every Deferred item is provably absent from v0.1 code paths (F4).
3. Capability matrix claims hold against REAL downloaded binaries — every ✅ path exercised by at least one committed test or QA evidence; every ⚠️ path either probed-working or honestly gated-off in UI.
4. Zero invented APIs/flags anywhere: every engine flag string in the codebase traces to OptionsList.h / flag-definitions.h / firefox-source-docs / quickjs cli.md evidence recorded in `.omo/drafts/runtime-playground.md` (F2 cross-check).
5. Distribution constraints honored: official sources only, manifest with platform/arch/version/sha256 per artifact, no engine ships inside the installer, custom-build requirements surface ONLY through the C-lane UI state.
6. Broken user programs can never degrade the app: timeout/tree-cancel proven, crash-recovery paths tested, UI always reachable (t08, t11, t22 failure scenarios).
