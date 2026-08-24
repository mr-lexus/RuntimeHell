# t11-inspector-ui.md — Console + Inspector UI wired to real runs (plan todo 11)

Date: 2026-08-24
Executed by: Sisyphus session

## Scope delivered

Main process:
- `apps/main/src/execution/execution-manager.ts` — composition root:
  ResultCapture transform (retainLines) → TranspileService → ProcessRunner.
  Single-flight per workspace (`stage:'active'` structured rejection);
  runtime-first failure path; bootstrap `--require` wiring; fd3-vs-stderr
  transport chosen via the todo-10 probe; per-run event scoping so
  concurrent workspaces sharing the runner cannot cross-talk.
- `apps/main/src/execution/stack-remapper.ts` — order-stable async line
  remapper rewriting generated `.cjs` frames to authored positions via the
  esbuild sourcemap before stderr events reach the renderer.
- `apps/main/src/ipc/router.ts` + `index.ts` — `run:start` / `run:cancel`
  handlers (zod-parsed); `run:event` streamed to all windows.
- `packages/protocol/src/run.ts` — RunStartRequest/Response (discriminated
  ok/rejected), RunCancel contracts.

Preload/renderer:
- `apps/preload/src/index.ts` — typed `startRun`/`cancelRun`/`onRunEvent`
  with zod validation at the bridge boundary.
- `apps/renderer/src/state/run.ts` — run store: phase machine
  (idle→running→cancelling), capped console ring (2000 lines), last-wins
  reports, 800 ms auto-run debounce, client-side single-flight guard.
- `apps/renderer/src/panels/console/ConsolePanel.tsx` — merged streams,
  stderr error styling, auto-scroll, clear, notice surface.
- `apps/renderer/src/panels/inspector/{InspectorPanel.tsx,inspector-tree.ts}` —
  react-window virtualized expandable tree over SerializedValue reports;
  pure flatten/label logic unit-tested separately.
- `App.tsx` — Ctrl+Enter → store; event subscription lifecycle; auto-run
  checkbox; Cancel gated to active runs only; status badge
  (runtime version · phase · exit code · duration · killedBy).

## Commands & evidence

```
pnpm typecheck   → exit 0 (all four TS projects)
pnpm test        → exit 0; 15 passed | 1 skipped files; 88 passed | 2 skipped tests
```

New suites this todo:

```
✓ execution-manager.test.ts (6)            fake-runner composition/single-flight/failure stages
✓ execution-manager.integration.test.ts(1) REAL node composed path:
    demo TS program → stdout "active users: 1" AND captured sum(40,2) === 42
    at report index 3 ({t:'number', prim:'42'})
✓ stack-remapper.test.ts (4)               real esbuild sourcemaps: frames map to entry.ts,
    foreign files untouched, 20-line async mapping stays in arrival order
✓ inspector-tree.test.ts (5)               collapse/expand key chains, labels, caps markers
✓ run-start.test.ts (protocol) (4)         request/response round-trips + rejections
```

Pre-existing skips (unrelated): binary-manager network-gated integration ×2.

## Happy scenario (plan spec)

Demo program (TS interfaces + array filter + console.log + top-level
expression) executed through the REAL composed path (system node.exe
v24.18.0):

- Console receives merged stdout/stderr; stderr styled red.
- Inspector receives ≥4 reports; `sum(40,2)` resolves to number 42.
- Badge shows runtime version and final exit code/duration after exit.

## Failure scenario (plan spec)

Infinite loop + Auto-run ON: debounce coalesces edits (single timer,
800 ms); renderer guard (`phase !== 'idle'`) AND main single-flight reject
stacked starts (`stage:'active'`, asserted in unit test). Cancel enabled
only while a run is active; `manager.cancel` delegates to ProcessRunner
tree-kill (todo-8 suite: process gone, status 'cancelled', killedBy='user').

## Known interim limitations (documented, by design for v0.1)

- Workspace id fixed to 'default' until WorkspaceStore lands (todo 21).
- Auto-run toggle is session-local until the settings store (todo 21).
- Stack remap applies to stderr text lines individually (order-stable),
  not grouped exception objects.
