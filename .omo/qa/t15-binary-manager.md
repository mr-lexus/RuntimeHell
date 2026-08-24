# t15-binary-manager.md — Engine manifest seed + C-lane (plan todo 15)

Date: 2026-08-24 · Executed by: Sisyphus session

## Scope delivered

- Generalization was already behavior-preserving from todo 7
  (`binary-manager.ts` is ManifestEntry-driven, kind:'engine' supported);
  runtime install suites remain green unmodified.
- `apps/main/src/binaries/engine-catalog.ts` — official-source-only catalog:
  V8/d8-debug win64 via Chromium official canary (`v8-win64-{rel|dbg}-latest.json`
  discovery + versioned zips); SpiderMonkey/JSC/QuickJS rows declared and
  DISABLED until todos 24/25+; JSC win64 declares its `webkit-requirements`
  support artifact; any uncovered {engine,platform,arch} combo resolves to
  C-LANE (`customBuildRequired:true`, never a normal download).
- `apps/main/src/binaries/engine-downloader.ts` — install pipeline wiring:
  latest-discovery → canary zip → **record-mode sha256** (Google publishes no
  checksums for canary artifacts; the observed digest is pinned into our
  manifest, making re-installs tamper-checked against the recorded value).
  Re-install of an existing version verifies against the prior digest.
  `guessMilestoneVersion` = EXPERIMENTAL historical-pin helper that only
  consults locally known versions — it never invents URLs.
- BinaryManager: `FetchSource.sha256` now optional with explicit record-mode
  semantics (commented at the boundary); recorded hash persisted via upsert.

## Commands & evidence

```
pnpm typecheck   → exit 0
pnpm test        → exit 0; 126 passed | 5 skipped (131)
✓ engine-catalog.test.ts (15):
    exhaustive C-lane decision table incl. hypothetical v8/mac64arm → C-lane
    JSC win64 requiresSupport='webkit-requirements'
    disabled engines refuse installs BEFORE network access
    record-mode sha + tamper re-install rejection (fake fetch)
    -latest.json defensive parsing, URL shapes, milestone guess
```

Network happy scenario (`RH_NET_TESTS=1`, REAL infrastructure):

```
pnpm vitest run apps/main/src/binaries/v8-engine.net.test.ts → Tests 1 passed (1); Duration 20.76s
```

- live `v8-win64-dbg-latest.json` discovery returned a real version string
- real dbg zip downloaded (~40MB) with observed sha256 recorded to manifest
- installed `d8.exe --version` executed successfully
- manifest row present: kind=engine id=d8-debug sha256=<64-hex>

Failure scenario (plan spec): truncated/corrupted artifact on RE-install is
rejected by recorded-sha mismatch with atomic temp cleanup and NO manifest
mutation (asserted in unit suite via TAMPERED payload).
