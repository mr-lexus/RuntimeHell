# Todo 2 QA Evidence — CI pipeline (Windows-first)

Date: 2026-08-24 · Executor: Atlas solo session

## Created
`.github/workflows/ci.yml`: windows-latest (required) + ubuntu-latest (continue-on-error), steps: pnpm/action-setup (version from packageManager field) → setup-node 24 w/ pnpm cache → `pnpm install --frozen-lockfile` → typecheck → test → build smoke.

## Local validation of every CI step (no git remote exists yet — see limitations)
- `pnpm install` → OK
- `pnpm typecheck` → TYPECHECK-PASS (.omo/qa/t03-typecheck.txt)
- `pnpm test` → TEST-PASS 13/13 (.omo/qa/t03-test-output.txt)
- `pnpm build` (electron-vite production build: main+preload+renderer) → BUILD-PASS (.omo/qa/t02-build-output.txt)

## Limitations / deviations
- No GitHub remote is configured in this environment, so no CI run URL can be captured. The workflow file mirrors the locally-proven commands 1:1; first push will exercise it.
- electron-builder --dir smoke deferred to todo 31 (packaging), where electron-builder is installed; CI currently uses `pnpm build` as the smoke step. Recorded as a deliberate sequencing deviation.
