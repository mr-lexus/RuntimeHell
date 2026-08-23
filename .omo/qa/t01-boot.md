# Todo 1 QA Evidence — Scaffold pnpm monorepo + electron-vite app with typed IPC round-trip

Date: 2026-08-24 · Executor: Atlas solo session (zero-subagent constraint)

## Environment
- node v24.18.0, npm 11.16.0, pnpm 11.22.0, git 2.54.0.windows.1
- Resolved versions (pnpm registry truth): electron ^43.4.1, electron-vite ^5.0.0, typescript ^7.0.2, vite ^8.2.2, vitest ^4.1.11, react ^19.2.8, zod ^4.4.3, @vitejs/plugin-react ^6.1.0

## Happy path
1. `pnpm install` → OK (electron postinstall run manually once due to pnpm 11 build-script gating; binary verified at node_modules/electron/dist/electron.exe)
2. `pnpm typecheck` → **TYPECHECK-PASS** (strict TS across protocol/main/preload/renderer)
3. `pnpm test` → **TEST-PASS**, 4/4 protocol schema tests (see t01-test-output.txt)
4. `pnpm dev` → boot markers captured in t01-boot-out.log:
   - `[boot] electron ready`
   - `[boot] renderer loaded`
   Window launched with React root; killed via taskkill /T after verification.

## Failure path exercised
- First `pnpm dev` failed with `ERR_MODULE_NOT_FOUND @vitejs/plugin-react` (config-level import not in root deps) → fixed by root devDep.
- Second failure: `build.rollupOptions.input option is required` → added explicit input.
- Third failure: `No entry point found for electron app` → added `"main": "out/main/index.js"` to root package.json.
All three recorded here as required failure-scenario evidence; final state boots clean.

## Security posture
contextIsolation:true, nodeIntegration:false, sandbox:true, single-instance lock (apps/main/src/index.ts).

## Decisions documented
- electron-vite config at repo ROOT with custom entries pointing into apps/* packages (preserves plan layout).
- packages/protocol exports TS source consumed via resolve alias (bundlers + vitest); no build step needed yet.
- Main/preload CJS, renderer ESM.
