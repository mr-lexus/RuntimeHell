# Todo 6 QA Evidence — App shell layout

Date: 2026-08-24 · Executor: Atlas solo session

## Delivered
- Tab bar (open files, dirty indicators, active switch), status line.
- Editor zone + bottom drawer (Console|Inspector|Analysis|Packages|Runtimes placeholders) with draggable splitter; ratio persisted to localStorage 'rh.ui.drawerRatio' (INTERIM — settings store migration lands todo 21, documented in state/ui.ts).
- Ctrl+S saves active file via IPC `ws:save-file` → %USERPROFILE%\RuntimeHell\workspaces\default\entry.ts; path-traversal guard (RelPathSchema + safeResolve re-check) on main side.
- Ctrl+Enter emits run-requested bus event consumed by placeholder listener updating status line (real executor lands todo 11).
- Main-side workspace file handlers registered (save/read/list) with zod validation at the IPC boundary.

## Happy path
E2E (built app): window boots with #root; ping round-trip passes; editor hook present (.omo/qa/p1-test.txt 23/23). Boot markers from dev mode previously captured (t01).

## Failure path exercised
- Path traversal: RelPathSchema rejects '..' and absolute paths (unit-covered in protocol round-trip suite); main-side safeResolve double-checks after normalization (defense in depth).
- Splitter drag clamps ratio to [0.08, 0.85]; persisted value reloads on start.

## Decisions documented
- localStorage interim persistence for layout (migration note in code).
- Workspace id 'default' hardcoded until WorkspaceStore (todo 21).
