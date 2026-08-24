# Todo 4 QA Evidence — Monaco with TS/JS/JSX diagnostics

Date: 2026-08-24 · Executor: Atlas solo session

## Delivered
- apps/renderer/src/editor/monaco-setup.ts: ESM workers via Vite `?worker` imports; TS defaults (ESNext, jsx Preserve, allowNonTsExtensions, allowJs); JS service configured too.
- monaco-editor@0.56.0 API migration: `monaco.languages.typescript` is a deprecated stub — TS service imported from its register module (direct relative import; exports map does not expose it for TS resolution — verified).
- E2E hook `window.__rh_monaco` / `window.__rh_editor`.

## Happy path (REAL app, not mock)
apps/renderer/src/editor/monaco.e2e.test.ts launches the built Electron binary via Playwright `_electron`:
- window boots (#root found)
- `window.api.ping()` round-trip → pong true
- setValue('const x: string = 1;') → after 4s `getModelMarkers({}).length >= 1`
Result: **TEST-PASS 23/23** (.omo/qa/p1-test.txt) incl. this E2E.

## Failure paths exercised (during bring-up, all fixed)
1. `ERR_MODULE_NOT_FOUND @vitejs/plugin-react` from root config → root devDep added.
2. rolldown cannot resolve `monaco-editor/...?worker` through exports map → relative worker imports.
3. Renderer outDir resolved against cwd → escaped to C:\out → ERR_FILE_NOT_FOUND at runtime; fixed to 'out/renderer', stray dir removed.
4. TS2307 for register module under Bundler resolution → direct relative import.
Each failure reproduced, diagnosed, fixed, re-verified by full build+test run.

## Notes
Dev-mode boot also verified earlier via `pnpm dev` boot markers ([boot] electron ready / renderer loaded).
