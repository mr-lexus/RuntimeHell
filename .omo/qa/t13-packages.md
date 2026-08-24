# t13-packages.md — PackageService: workspace-scoped npm ops (plan todo 13)

Date: 2026-08-24 · Executed by: Sisyphus session

## Scope delivered

- `apps/main/src/packages/package-service.ts` — install/uninstall/list/search.
  npm binary resolution per D7 with a robustness twist discovered during QA:
  Node ≥ 18.20 refuses to spawn `.cmd` shims without a shell (CVE-2024-27980)
  and shell quoting of `C:\Program Files\...` paths is fragile — so the
  resolver prefers DIRECT execution (`node.exe node_modules/npm/bin/npm-cli.js`)
  for both the managed runtime and the PATH installation, keeping a
  cross-spawn-style `cmd /d /s /c` wrapper only as last-resort fallback.
  `--ignore-scripts` ON by default (parameter; settings toggle todo 21).
  Registry search via official endpoint, 10s abort, size ≤ 50 enforced by
  schema. All CLI output streams verbatim through the injected sink.
- `packages/protocol/src/packages.ts` — PkgOp/PkgList/PkgSearch contracts +
  PkgEvent stream schema; channels added to ipc-channels.ts.
- Router/index wiring; preload typed pkgInstall/pkgRemove/pkgList/pkgSearch/
  onPkgEvent; renderer `state/packages.ts` + `panels/packages/PackagesPanel.tsx`
  (debounced search with stale-response guard, installed chips w/ remove,
  verbatim npm log area — failures show npm stderr exactly).

## Commands & evidence

```
pnpm typecheck   → exit 0
pnpm test        → exit 0; 19 passed | 3 skipped files; 108 passed | 4 skipped tests

RH_NET_TESTS=1 pnpm vitest run apps/main/src/packages/package-service.net.test.ts
→ exit 0; Tests 1 passed (1); Duration 3.04s
```

Network happy scenario (REAL npm 11.16.0 from PATH):
- `install left-pad@1.3.0` → exit 0, package.json gains `"left-pad": "^1.3.0"`
  (npm save-prefix), `node_modules/left-pad` exists on disk
- stdout line "added 1 package" streamed through sink into panel log

Failure scenario (plan spec): `install @rh/nope-xyz-404`
- response `{ok:false, message:'npm install failed (exit 1)…', stderrTail}`
  with stderrTail containing `404 Not Found - GET https://registry.npmjs.org/…`
- workspace package.json byte-identical before/after (hash-style compare)

Uninstall removes the entry; second-remove style idempotence covered by
structured not-found errors in unit suite.

## Unit coverage highlights

- resolution decision table: managed-direct → path-direct → shell-fallback →
  structured guidance (npm not found message references Runtimes panel)
- arg building: `--ignore-scripts` default ON, omitted when disabled;
  `--no-audit/--no-fund` always; bare name vs name@range
- ensure-workspace creates `{"private":true,"type":"commonjs"}` exactly once
- search parsing + registry failure degradation (mocked fetch)
