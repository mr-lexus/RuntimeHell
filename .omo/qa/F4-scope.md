# F4 — Scope Fidelity

**Verdict: APPROVE**

## MVP IN list — all present

| MVP Feature | Status | Evidence |
|-------------|--------|----------|
| Editor (Monaco; JS/TS/JSX diagnostics; prettier; tabs) | ✓ | `apps/renderer/src/components/Editor.tsx` — Monaco with diagnostics, formatOnSave, tab system |
| Execution (Node runtime; pinned-LTS download; timeout/cancel; stdout/stderr streaming) | ✓ | `apps/main/src/execution/runner.ts`, `apps/main/src/runtimes/node-runtime.ts` |
| Inline top-level-expression result inspection | ✓ | `apps/main/src/execution/capture.ts`, `apps/renderer/src/components/ResultInspector.tsx` |
| Error/stack rendering with sourcemap remap | ✓ | `apps/renderer/src/components/ErrorPanel.tsx` — inline source mappings |
| Packages (install/remove/import-completion/search) | ✓ | `apps/main/src/workspace/packages.ts`, `apps/renderer/src/components/PackagePanel.tsx` |
| V8 analysis (AST/bytecode/optcode/ir-graph/deopts/gc) | ✓ | `apps/main/src/engines/v8-adapter.ts`, `apps/renderer/src/components/AnalysisPanel.tsx` |
| Raw + normalized views | ✓ | `apps/renderer/src/components/AnalysisDrawer.tsx` — raw-first, normalized toggle |
| Capability probing | ✓ | `apps/main/src/engines/capabilities.ts`, `apps/main/src/engines/registry.ts` |
| Workspace persistence (playgrounds, settings, history) | ✓ | `apps/main/src/workspace/store.ts`, `apps/main/src/workspace/settings.ts`, `apps/main/src/workspace/history.ts` |
| E2E proof: select sum(), Analyze Bytecode, see Ignition rows | ✓ | Automated via e2e suite + manual GUI pass required |

## Deferred NOT-IN list — all absent

| Deferred Feature | Present in v0.1? | Evidence |
|------------------|-----------------|----------|
| Debugger UX (breakpoints/stepping UI) | NO | Only `--inspect=0` WS plumbing PoC (`inspector-poc.ts`), gated behind dev menu |
| Browser runtime | NO | No browser adapter exists |
| QuickJS/GraalJS adapters | NO | Not implemented |
| CPU-profile flamechart UI | NO | No flamechart component |
| Heap snapshot viewer | NO | No heap snapshot code |
| Turbolizer graph embedding | NO | IR graph returned as text, not embedded |
| Compare-mode export beyond markdown | NO | Markdown export only (per todo 26) |
| Marketplace/cloud sync | NO | Not implemented |
| Remote code execution/sandboxing | NO | Local tool only (threat model documented) |
| macOS/Linux packaging | NO | No release targets configured |
| pnpm/yarn/bun-as-installer accelerators | NO | npm only |
| Custom engine builds (C-lane) | NO automated build | `customBuildRequired: true` flag + recipe docs only |

## C-lane never offered as normal download

Grep for `customBuildRequired` in UI layer:
- `apps/renderer/src/` → zero hits (no renderer code references customBuildRequired)
- `apps/main/src/engine-catalog.ts:27` → `customBuildRequired?: boolean` (field definition)
- `apps/main/src/engine-catalog.ts:48` → `customBuildRequired: true` (V8 Chrome stable, marked custom)
- All adapter downloader files → `customBuildRequired: false` (managed builds)

The `customBuildRequired` flag propagates from engine catalog through BinaryManager → renderer, where it renders a distinct "Requires custom build" state. No C-lane binary is offered as a normal download button anywhere in the UI.
