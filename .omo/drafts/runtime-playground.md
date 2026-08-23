# runtime-playground - Planning Draft (ulw-plan resume point)

<!-- ulw-plan-draft-state
slug: runtime-playground
intent: clear
review_required: false
classification: Architecture
status: exploring
created: 2026-08-23
workspace_root: C:\server\RuntimeHell
scaffold_note: hand-built template-conformant draft (planner has no shell tool in this environment); post-approval plan skeleton will follow script header order verbatim
pending_action_policy: { review_required: "n/a (false)", otherwise: "write .omo/plans/runtime-playground.md after explicit approval" }
-->

## TL;DR (For humans)
(pending — filled LAST, after plan body, post-approval)

## Scope
(pending — drafted during exploration; see Decisions ledger)

## Decisions ledger
- D1 (adopted default): greenfield app at C:\server\RuntimeHell; monorepo layout; TypeScript everywhere.
- D2 (user-given): vertical-slice-first principle — Editor → Node execution → selected function → V8 bytecode output end-to-end before extracting abstractions.
- D3 (user-given): MVP boundary per request §18; phased roadmap §19 may be reordered only if research justifies.
- D4 (open → brief): desktop stack Electron vs Tauri — research-driven recommendation presented as owner-question at approval gate.
- D5 (open → brief): engine/runtime binary distribution model (bundle vs on-demand download cache) — owner-question at approval gate.
- D6 (default, announce): editor = Monaco unless research overturns.
- D7 (default, announce): test strategy = tests-after per todo with agent-executed QA (happy + failure scenarios, evidence paths); TDD where pure logic allows.

## Research lanes dispatched (2026-08-23, background librarians)
- R1 V8/d8 flags + Windows binary acquisition + licensing + node --print-bytecode on Windows.
- R2 SpiderMonkey js shell real option surface + Taskcluster Windows artifacts + MPL-2.0.
- R3 JSC jsc options (OptionsList.h) + Windows availability + WebKit licensing + Bun JSC passthrough.
- R4 Node/Deno/Bun version discovery, download URLs, checksums, isolation layouts, licenses.
- R5 Electron vs Tauri 2 trade-offs for process-spawning IDE tool on Windows.
- R6 Monaco + TS worker + JSX/TSX + prettier + monaco-vscode-api evaluation.
- R7 npm isolation strategies + registry search + supply-chain posture.
- R8 Prior art: turbolizer/--trace-turbo, bytecode viewers, QuickJS/GraalJS briefs, common-AST options, microbench libs.

## Evidence ledger
- Workspace C:\server\RuntimeHell is EMPTY (verified 2026-08-23): greenfield; §20.1/§20.2 resolved — no reusable components exist.
- (research findings appended below as they land; claims stay CLAIMS until planner verifies key ones independently)

### Verified key facts (planner-checked)
- [CONFIRMED] jsvu README platform matrix: V8 (`v8`) AND `v8-debug` ship win32+win64; SpiderMonkey win64 ✅; QuickJS-ng win64 ✅; JavaScriptCore win64 ✅ BUT requires WebKitRequirements bin64 DLLs on PATH (https://raw.githubusercontent.com/GoogleChromeLabs/jsvu/main/README.md). jsvu supports pinned versions (`jsvu v8@7.2`), non-interactive mode (`--os=win64 --engines=...`). => engine-shell distribution problem largely solved by replicating/jsvu-compatible downloads.
- [CONFIRMED] `node --print-bytecode` (+`--print-bytecode-filter=<fn>`) works in release builds incl. output shape (Parameter count / Register count / Frame size / Constant pool lines) — nodejs/node#38158 + drag13.io/posts/v8-bytecode + dev.to sample.
- [CONFIRMED] `--print-ast` is v8-debug-only; `--print-opt-code` needs function actually optimized (targos in nodejs/node#38158); SO answer lists flag availability split (stackoverflow.com/questions/78066707).
- [ARCH-INSIGHT] Runtime vs Engine separation maps cleanly onto tooling reality: runtimes (Node/Deno/Bun) execute programs; analysis runs through separately-managed engine SHELLS (d8 / v8-debug via jsvu-style downloader) so Windows build-config quirks of Node never gate inspection features.
- [OPEN-VERIFY] Whether OFFICIAL win64 node.exe enables disassembler (--print-opt-code/%DebugPrint) — V8 lane (bg_6f4c62aa) to settle; plan assumes NO and uses v8-debug instead (safe default either way).
- [CONFIRMED] Chrome-for-Testing does NOT publish d8 (only chrome/chromedriver/chrome-headless-shell; checked last-known-good-versions-with-downloads.json 2026-08-23).
- [CONFIRMED] Official V8 binary endpoints via jsvu source (engines/v8*/predict-url.js + get-latest-version.js): release = https://storage.googleapis.com/chromium-v8/official/canary/v8-{platform}-rel-{version}.zip (+ -rel-latest.json), debug = .../v8-{platform}-dbg-{version}.zip (+ -dbg-latest.json); dbg endpoint verified LIVE returning {"version":"15.4.44"} for win64 on 2026-08-23. Debug builds carry the full inspection surface (disassembler/object-print gated flags). Apache-2.0 jsvu code may be referenced for URL logic.
- [IMPLICATION] MVP engine-analysis binary strategy: download official Google-hosted v8 rel+dbg zips into app-managed cache with checksum pinning; no custom engine builds required for v0.x bytecode/AST inspection.

## Components ledger (topology candidates — lock at brief)
- C1 ui-editor: React shell + Monaco editing experience (TS/JS/JSX, diagnostics, formatting, selection commands).
- C2 execution: execution manager isolating runs from UI (timeout/cancel/streaming results/inspection serialization).
- C3 runtimes: RuntimeAdapter layer + version manager (Node first; Deno/Bun adapters; discovery/download/cache/remove).
- C4 engines-analysis: EngineAdapter layer (V8 first), selected-code wrapping, AnalysisResult normalization, raw-output preservation.
- C5 packages: per-workspace dependency environments, install/remove/search UI, import resolution.
- C6 workspace: persistent playgrounds/tabs/history/settings storage.

### Editor lane findings (self-researched after bg_10a03870 stall; CLOSED)
- [CONFIRMED] Monaco TS worker config API surface: typescriptDefaults.setCompilerOptions({target:99 ESNext, jsx:1, allowNonTsExtensions:true}), setDiagnosticsOptions({noSemanticValidation/noSyntaxValidation/diagnosticCodesToIgnore...}), setWorkerOptions({customWorkerPath}) — microsoft/monaco-editor src/languages/features/language/register.ts + docs/integrate-esm.md via context7 /microsoft/monaco-editor.
- [CONFIRMED] Modern monaco uses native ESM module workers (workerManager.ts: new Worker(new URL('./ts.worker?esm', import.meta.url), {type:'module'})); Vite pattern `import EditorWorker from 'monaco-editor/editor/editor.worker?worker'` proven in slidevjs/slidev packages/client/setup/monaco.ts.
- [CONFIRMED] npm-package IntelliSense = @typescript/ata setupTypeAcquisition → addExtraLib; production-proven in microsoft/TypeScript-Website sandbox, slidev, BabylonJS playground, typehero, twoslash-cdn (grep_app evidence). This answers §2 "TypeScript IntelliSense" + package-import completion without full tsserver.
- [DECISION default] Plain monaco-editor (+ata+prettier standalone) for v0.x; @codingame/monaco-vscode-api evaluated later only if richer VS Code services needed. Prettier standalone + plugins/{typescript,babel} in a web worker.

### Runtime distribution facts (planner-verified against live primary endpoints 2026-08-23)
- [CONFIRMED] Node: dist/latest shows node-v26.7.0-win-x64.zip (+ .7z, msi), SHASUMS256.txt(+.asc/.sig) alongside; per-version dirs under https://nodejs.org/dist/v{ver}/ ; index.json remains the version-list endpoint (fields incl. version/lts/files — parse defensively at build time).
- [CONFIRMED] Deno: latest release v2.9.5; Windows asset deno-x86_64-pc-windows-msvc.zip with .sha256sum sidecars AND GitHub API per-asset sha256 "digest" fields; bsdiff delta assets exist between adjacent versions.
- [CONFIRMED] Bun: latest release bun-v1.4.0; asset family bun-{os}-{arch}[-baseline][-profile].zip; GitHub API sha256 digest per asset; baseline = pre-AVX2 CPU fallback variant.
- [IMPLICATION] VersionManager design: per-runtime provider implementing {listVersions(), resolveAssetURL(version), fetch+verify(checksum), extract to %LOCALAPPDATA%\RuntimeHell\runtimes\{runtime}\{version}\, remove()}; spawn via absolute exe path, never PATH lookup.
- [DEFAULT adopted] npm operations = spawned npm CLI inside per-playground workspace dir (package.json + package-lock.json committed there); registry search UI uses GET https://registry.npmjs.org/-/v1/search?text=... (docs.npmjs.org documented; integration test will pin response shape). ignore-scripts default ON with explicit opt-in toggle (supply-chain mitigation).

### Engine capability facts (planner-verified from primary sources 2026-08-23)
- [CONFIRMED] V8 bytecode printing is UNGATED: src/flags/flag-definitions.h defines print_bytecode_filter as plain DEFINE_STRING; src/interpreter/interpreter.cc gates only on v8_flags.print_bytecode => works in standard rel AND dbg builds. --trace-turbo/--trace-turbo-graph/--trace-turbo-path/--trace-turbo-filter/--trace-turbo-cfg-file confirmed live in v8/v8 test suite (2025–2026 files); Maglev & Turbolev pipelines present in current tree (pipeline: Ignition→Sparkplug→Maglev→TurboFan/Turbolev).
- [CONFIRMED] SpiderMonkey: firefox-source-docs.mozilla.org/js/hacking_tips.html documents shell builtin dis(fn) dumping bytecode + source notes; legacy -D/--dump-bytecode ("dump bytecode with exec count") existed (aldeid mirror, 2012-era); IONFLAGS env var drives JIT spew incl. IONFLAGS=logs (JitSpewer.cpp via searchfox; Discourse thread w/ Matthew Gaudet; bnjbvr gist notes debug-build recommendation). Many dump tips "only apply to debug builds" => per-binary capability PROBE required (run-time detection, no hard assumptions).
- [CONFIRMED] JavaScriptCore OptionsList.h (WebKit main, ©2026): dumpGeneratedBytecodes, dumpBytecodeLivenessResults, validateBytecode, dumpDisassembly/dumpBaselineDisassembly/dumpDFGDisassembly/dumpFTLDisassembly, dumpGraphAfterParsing, dumpGraphAtEachPhase, dumpDFGGraphAtEachPhase, dumpDFGFTLGraphAtEachPhase, dumpB3GraphAtEachPhase, dumpAirGraphAtEachPhase, dumpGraphAllowlist (per-function-signature filtering!), dumpSourceAtDFGTime, dumpBytecodeAtDFGTime, tier toggles useLLInt/useBaselineJIT/useDFGJIT/useFTLJIT/useRegExpJIT, reportCompileTimes/reportTotalPhaseTimes, printEachOSRExit, verbose* family, logGC, useSamplingProfiler(+shell --sample). Env overrides documented IN-FILE: "environment variables of the form: JSC_<name>".
- [CONFIRMED] QuickJS-ng: CLI dump flags DUMP_BYTECODE_FINAL/PASS2/PASS1/HEX/PC2LINE/STACK/STEP etc. documented in docs/docs/cli.md + JS_SetDumpFlags API (quickjs.h); MIT; win64 via jsvu matrix.
- [CAPABILITY-MATRIX GROUNDED] All three major engines expose REAL machine-readable-ish inspection surfaces, each DIFFERENT in kind: V8=flag-driven text/JSON (per-function filters built-in), SM=shell-builtin dis()+env-var spew (debug-leaning), JSC=option/env-driven dumps with allowlists. Confirms AnalysisResult design: rawOutput preserved verbatim + engine-specific parser + best-effort normalized view labeled as such.
- [RISK logged] V8 canary bucket serves -latest.json + version-addressable zips (v8-win64-dbg-{version}.zip verified pattern); enumerating HISTORICAL versions may need milestone guessing (jsvu approach) — MVP uses latest dbg canary; pinning research deferred to implementation probe.

## Lane health log
- bg_7aab9d69 (runtimes lane) stalled at start ~407s no output → cancelled; respawned tighter as bg_4367efaf.
- bg_fd1145db (desktop-stack lane) stalled at start ~447s no output → cancelled; respawned tighter as bg_6a5ae5a9.

## Open questions
- none — Q-desktop/Q-distribution resolved by user approval (see Approval gate receipts).

## Approval gate
status: COMPLETED — plan written and finalized at .omo/plans/runtime-playground.md
receipts:
- Approval received 2026-08-24 ("ok"): Q1 Electron, Q2 on-demand+manifest constraints, Q3 tests-after.
- Metis-equivalent gap analysis performed DIRECTLY by planner (user ordered zero subagents after systemic infra failures: deepseek-v4-flash insufficient balance → fallback models weekly-limited; every librarian lane stalled with zero output). Findings folded into todos 10/12/13/15/17/20/26 + D7: npm-binary resolution order added (blocker-grade gap), fd3 transport made non-load-bearing, todo-20 wrapper pseudo-text replaced with deterministic spec, turbo-json glob softened to QA-verified, compare assertions made concrete, resolution order + behavior-preserving labels added.
- Structural self-check passed: 32 implementation rows (- [ ] N., column-zero, ## Todos) + 4 final-verifier rows (- [ ] F<n>.) ; header order template-verbatim; TL;DR first and filled last.
- Deviations from standard workflow (documented): scaffold hand-built (no shell tool in planner env); Metis run directly instead of via subagent; no momus/oracle lanes possible this session.
next_action: user decides start-work vs high-accuracy review (planner asked; must not pick).
decisions locked:
- Q1 = Electron + React + Vite + TypeScript.
- Q2 = on-demand download + checksum pinning + local caching, WITH user constraints: official/verifiable sources only; versioned manifest {platform,arch,version,checksum}; never assume every engine ships prebuilts for every OS; custom-build requirements get their own explicitly-marked path (C-lane), never disguised as normal downloads.
- Q3 test strategy = tests-after per todo + agent-executed happy/failure QA.
pending_action: none — plan finalized; awaiting user start-work or review decision.
infra-note: background subagents failed systematically this session (deepseek-v4-flash insufficient balance -> fallback models weekly-limit); librarian lanes produced zero output; all research done by planner directly. Metis dispatch was attempted once and aborted by user order; self-review fallback executed and recorded above. User directive standing: ZERO new subagents for the rest of this planning session.
