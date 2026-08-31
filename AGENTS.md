# RuntimeHell agent guide

This file applies to the whole repository. Use it as a navigation index, not as a substitute for reading the code you are changing.

## First 5 minutes

1. Run `git status --short` and preserve unrelated user changes.
2. Read `package.json`, the nearest package's `package.json`, and the files named in the change map below.
3. Search with `rg`/`rg --files` before opening broad directories.
4. Trace a feature across its complete boundary: protocol schema -> preload bridge -> main handler/service -> streamed event -> renderer store/panel.
5. Run the narrowest relevant test first, then the repository gates listed below.

Use Context7 whenever work depends on current third-party library/framework/CLI behavior. Resolve the library ID first, query one focused concept, and treat local code plus the lockfile as the source of truth for this project's actual versions and architecture. Context7 is not needed for local business logic.

## Project snapshot

- Windows-first Electron desktop app for running JS/TS across Node.js, Deno, Bun, and an embedded Chromium lane, with engine analysis for V8, SpiderMonkey, and JavaScriptCore.
- pnpm workspace (`pnpm@11.22.0`); do not use npm or yarn to modify dependencies.
- Strict TypeScript, React + Zustand + Monaco in the renderer, Zod contracts at process boundaries, Vitest tests colocated with source.
- Build stack: Electron + electron-vite/Vite. Generated output is under `out/`.
- User code and downloaded binaries are untrusted. Read `docs/threat-model.md` before changing execution, filesystem, IPC, package-install, or binary-download behavior.

## Repository map

| Area | Responsibility | Start here |
| --- | --- | --- |
| `packages/protocol` | Canonical IPC channel names, Zod request/response/event schemas, shared types | `src/ipc-channels.ts`, `src/index.ts`, feature schema file |
| `apps/main` | Privileged Electron/Node process: IPC registration, child processes, runtimes, engines, persistence, downloads | `src/index.ts`, `src/ipc/router.ts` |
| `apps/preload` | Narrow `contextBridge` API; validates messages crossing into/out of renderer | `src/index.ts` |
| `apps/renderer` | Sandboxed React UI, Monaco editor, Zustand stores, panels | `src/App.tsx`, `src/ui/WorkbenchShell.tsx`, `src/state/*` |
| `packages/engine-parsers` | Pure parsers for engine output and committed golden fixtures | `src/index.ts`, parser-specific tests |
| `scripts` | Build asset copying, lint gates, fixture generation, Electron E2E/probes | `lint-gates.mjs`, `copy-main-assets.mjs` |
| `docs` | Security, custom engine builds, licensing, Windows troubleshooting | Read the document matching the subsystem |

### Main-process subsystems

- `execution/`: authored source capture -> optional esbuild transpile -> runtime resolution -> isolated execution -> streamed `RunEvent`s. `ExecutionManager` allows one active run per workspace; `ProcessRunner` sanitizes environment variables, enforces timeout/cancellation, tree-kills children, and separates internal sentinel frames from user output.
- `runtimes/`: executable detection/resolution and runtime adapters. The browser lane uses a hidden sandboxed Electron page rather than a child CLI process.
- `binaries/`: managed runtime/engine catalog, staged downloads/imports, manifest and cache layout. Cache root is `%LOCALAPPDATA%\RuntimeHell\cache` or `RH_CACHE_ROOT` in tests.
- `engines/`: adapter interface, capability probes, registry, analysis orchestration, and engine-specific CLI flags/output collection. Presentation-oriented normalization may live in the renderer's dedicated analysis normalizers, but executable invocation and capability logic stay here.
- `performance/`: benchmark target/profile catalog and isolated Mitata harness execution. Progress and results stream by request ID.
- `packages/`: workspace-scoped package operations with script policy and managed Node selection.
- `workspace/`: validated workspace file access, settings, history, and metadata. Workspaces live under `%USERPROFILE%\RuntimeHell\workspaces`; settings live under `%APPDATA%\RuntimeHell`.

### Renderer organization

- `App.tsx` wires settings hydration, event subscriptions, commands, active file state, and stores. Keep feature logic in stores/services when possible; avoid making `App.tsx` a second implementation layer.
- `state/*.ts` owns async feature state and filters streamed events by `runId`/`requestId`.
- `panels/*` renders one tool surface. Bottom-dock composition is in `ui/WorkbenchShell.tsx`.
- `editor/*` owns Monaco setup, selection wrapping, ATA, formatting workers, and Vim mode.
- `styles.css` is the shared global style surface. Existing UI selectors use the `rh-` prefix.
- `global.d.ts` derives `window.api` from the preload export; do not duplicate that API type manually.

## Cross-process change map

When changing a feature, update every applicable row. Missing one layer commonly produces silent UI failures because invalid streamed events are intentionally ignored by preload/store guards.

| Change | Files/layers that usually move together |
| --- | --- |
| New IPC operation or event | `packages/protocol/src/ipc-channels.ts` + feature schemas + `packages/protocol/src/index.ts` -> `apps/preload/src/index.ts` -> `apps/main/src/ipc/router.ts` and wiring in `apps/main/src/index.ts` -> renderer store/panel -> schema/handler/store tests |
| Run/runtime behavior | protocol `run.ts`/`manifest.ts` -> `main/execution/*`, `main/runtimes/*`, possibly `main/binaries/*` -> preload -> `renderer/state/run.ts` or `state/runtimes.ts` -> console/runtime UI |
| Engine analysis | protocol `analysis.ts` -> `main/engines/engine-adapter.ts`, registry/adapter/manager -> preload/router -> `renderer/state/analysis.ts` -> analysis panel/result normalization; pure reusable output parsers belong in `packages/engine-parsers` |
| Performance Lab | protocol `performance.ts` -> `main/performance/performance-manager.ts` -> preload/router/index -> `renderer/state/performance.ts` -> `panels/performance/PerformancePanel.tsx` |
| Managed binary/engine | protocol manifest -> `main/binaries/*` and detection/registry -> runtime store/panel; update `docs/engines-licensing.md` and runtime logo attribution when applicable |
| Setting | protocol `settings.ts` -> `main/workspace/settings-store.ts` defaults/migration -> preload -> `renderer/state/settings.ts` -> settings/UI consumer |
| Non-bundled runtime asset/template | source asset + `electron.vite.config.ts` and/or `scripts/copy-main-assets.mjs`; verify both dev rebuild and production build layout |

## Architectural invariants

- Renderer stays sandboxed: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. Never expose raw `ipcRenderer`, Electron event objects, filesystem APIs, or generic send/invoke functions through `contextBridge`.
- Treat renderer payloads as untrusted. Add/extend a Zod schema in `@rh/protocol`, parse in the main handler, and validate responses/events in preload. Prefer strict schemas for new contracts.
- All channels come from `IPC`; do not introduce string-literal channel names elsewhere.
- Keep `apps/main/src/ipc/router.ts` free of Electron imports so handler logic remains unit-testable. Electron wiring and `webContents.send` broadcasting stay in `apps/main/src/index.ts`.
- Do not move engine CLI flags, executable probing, or filesystem/process logic into `apps/renderer`. Keep any presentation-side raw-output parsing isolated in dedicated normalizers. `pnpm lint` enforces part of this boundary.
- Preserve execution isolation: minimal child environment, workspace path containment, bounded timeouts, cancellation hooks, process-tree cleanup, and separation/deduplication of `__RH__*` protocol frames from user stdout/stderr.
- Preserve correlation IDs. Concurrent workspaces, analyses, installs, and benchmark groups must not leak events into one another.
- Keep runtime/engine install writes staged and manifest-driven. Use `RH_CACHE_ROOT` for tests; do not write test downloads into the real user cache.
- Main/protocol packages use NodeNext-style relative imports with `.js` suffixes even though sources are `.ts`. Renderer imports normally omit the suffix; follow the local package convention.
- Do not hand-edit `out/`, `node_modules/`, generated logs, screenshots, `.rhbuild/`, `turbo-*.cfg`, or cache/workspace data. Do not commit these artifacts.
- Add dependencies to the package that imports them, then update `pnpm-lock.yaml` with pnpm.
- Keep changes focused. Do not rewrite large renderer panels or the global stylesheet unless the requested behavior requires it.

## Testing strategy

Use a focused test while iterating:

```powershell
pnpm exec vitest run apps/main/src/execution/execution-manager.test.ts
pnpm exec vitest run apps/renderer/src/panels/analysis/ast-normalize.test.ts
```

Before handing off a normal code change, run the applicable gates:

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

- `pnpm typecheck:all` additionally checks `packages/engine-parsers`; use it when shared parsers or workspace contracts change.
- Unit/integration tests are colocated as `*.test.ts`. Add regression coverage next to the changed implementation.
- `*.net.test.ts` suites require real downloads/binaries and are gated by `RH_NET_TESTS=1`; do not enable them unless the task needs network verification.
- `pnpm gen-fixtures` intentionally runs network-backed fixture generation and may replace golden files. Use only for parser fixture work and review resulting diffs.
- `apps/renderer/src/editor/monaco.e2e.test.ts` needs a built app and skips when `out/main/index.js` is absent.
- `node scripts/e2e-vertical-slice.mjs` exercises an isolated built app. `node scripts/e2e-runtime-switch.mjs` expects the dev renderer at port `5189` and suitable runtimes installed.
- If dependency links are stale or modules declared in package manifests cannot be resolved, run `pnpm install` before diagnosing source errors. Report any gate that could not run and its exact reason.

## Efficient task patterns

- For an IPC bug, inspect the schema and all three boundaries before changing UI code.
- For missing output, follow the ID and event type from manager emit -> `webContents.send` -> preload `safeParse` -> store filter -> panel selector.
- For runtime/engine availability, inspect manifest entries, system detection, resolver order, then renderer selection state; do not infer availability from the catalog UI alone.
- For a parser bug, capture the smallest real raw-output fixture, keep normalization pure, and add a golden/regression test before changing presentation.
- For settings, update schema defaults and migration together; test both old/corrupt input and round-trip persistence.
- For security-sensitive work, use `docs/threat-model.md` as the acceptance checklist and verify failure/cancellation paths, not only the happy path.

## Definition of done

- The complete cross-process contract is updated and validated.
- Focused regression tests cover the behavior and failure path.
- Relevant lint/type/test/build gates pass, or blockers are explicitly reported.
- No unrelated user changes or generated artifacts are included.
- Documentation/licensing/asset-copy rules are updated when the change affects them.
