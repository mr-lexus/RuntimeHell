# t23-refactor.md — RuntimeAdapter/EngineAdapter extraction (plan todo 23)

Date: 2026-08-24 · Executed by: Sisyphus session

## What moved (behavior-preserving)

- `apps/main/src/runtimes/runtime-adapter.ts` — `RuntimeAdapter` interface +
  `NodeRuntimeAdapter` (delegating to the EXISTING proven pieces:
  `resolveRuntimeChoice` + `detectSystemNode`) + `RuntimeRegistry` with
  id-based lookup. ExecutionManager's default runtime resolution now routes
  through the registry; the displayed resolution order is unchanged because
  it is the SAME code (`runtime-resolver.ts`).
- `apps/main/src/engines/engine-adapter.ts` — `EngineAdapter` interface +
  per-request `AnalysisContext` (emit / registerCancel / isLive) +
  `AdapterNotFoundError`.
- `apps/main/src/engines/v8-adapter.ts` — gained `V8EngineAdapterV0`
  implementing `EngineAdapter`: owns TS-strip, per-type gate/run sequencing,
  partial-success events, cancel-aware isolation (`trackedProcessIsolation`)
  and terminal done emission. Registered for ids 'v8' and 'd8-debug'.
- `apps/main/src/engines/registry.ts` — `registerAdapter`/`getAdapter` +
  real `analyze(req, ctx)` dispatch replacing the todo-17 stub.
- `apps/main/src/engines/analysis-manager.ts` — now a THIN dispatcher:
  live-set + cancel-map + ctx construction only (~50 LOC of logic removed
  from the manager into the adapter layer).

## Zero-behavior-change proof

Named immutable suites (plan list) pass UNMODIFIED:

```
pnpm vitest run apps/main/src/execution/process-runner.test.ts \
                apps/renderer/src/editor  (t11 UI suite files) \
                apps/main/src/engines/v8-adapter.test.ts \
   → all green (see full-suite line below)
pnpm test        → exit 0; 27 passed | 8 skipped files; 175 passed | 12 skipped
pnpm typecheck   → exit 0
node scripts/e2e-vertical-slice.mjs --warm → exit 0 (post-refactor journey)
```

Delta note: analysis-manager.test shrank by 2 tests whose assertions tested
manager-internal sequencing that NOW lives in V8EngineAdapterV0 — that
behavior stays covered by v8-adapter.test (gates/partial-success) and
v8-adapter.net.test.ts (real binary). No production behavior changed;
diff review confirms extraction only (+ the two pre-existing fixes already
committed separately in 3b00546).

## Architecture gates

- NEW `scripts/lint-gates.mjs` (also repairs the previously missing lint
  script target): renderer purity — forbids engine-internal tokens
  (`--print-*`, `--trace-*`, `--no-lazy`, `SharedFunctionInfo`,
  `getElectronPath`) under apps/renderer/src. Engine NAMES remain allowed as
  @rh/protocol enum values.
- `pnpm lint` → renderer purity gate OK.
- Grep corroboration: no flag/format literals under renderer; adapters are
  the sole owners of engine specifics (engines/* + runtimes/*).

## Follow-ups registered

- electron-builder packaging must ship root-owned runtime externals
  (esbuild + its platform binary); recorded for todo 31.
