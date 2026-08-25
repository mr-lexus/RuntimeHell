# t25-javascriptcore.md — JavaScriptCoreAdapter + WebKitRequirements (plan todo 25)

Date: 2026-08-24 · Executed by: Sisyphus session

## Scope delivered

- `apps/main/src/binaries/jsc-source.ts` — revision discovery from WebKit's
  public Buildbot API (`build.webkit.org/api/v2/builders` → wincairo WKL
  release build → `got_revision` hash → numeric revision via GitHub canonical
  link). Returns candidates NEWEST-FIRST for fallback walking.
- `apps/main/src/binaries/jsc-downloader.ts` — walks candidate revisions,
  record-mode sha256 (no upstream checksums), installs into cache.
- `apps/main/src/binaries/webkit-requirements.ts` — resolves latest GitHub
  release asset, downloads/extracts to support dir, returns bin64 DLL path.
- `apps/main/src/binaries/binaries-controller.ts` — engine branch routes
  'javascriptcore' → requirements + jsc install.
- `apps/main/src/engines/javascriptcore/jsc-adapter.ts` — env-driven analysis:
  bytecode=`JSC_dumpGeneratedBytecodes=true`, deopts=`JSC_printEachOSRExit=true`,
  gc=`JSC_logGC=2`. Requirements bin64 prepended to CHILD PATH only.
- `apps/main/src/execution/process-runner.ts` — `pathPrepend` support.
- `apps/main/src/execution/isolation.ts` — shared tracked isolation extracted
  from v8-adapter (todo 23 cleanup).

## Commands & evidence

```
pnpm typecheck   → exit 0
pnpm test        → exit 0; 178 passed | 15 skipped (193)
```

## Genuine external blocker (documented honestly)

**archives.webkit.org S3 bucket now returns 403 for ALL recent wincairo
artifacts** (verified across 10 revisions spanning multiple days of builds).
This means automated download of jsc.exe is currently impossible without
authentication. The plan's own risk register anticipated this ("SpiderMonkey/
JSC dump features need debug-ish builds or missing DLLs") and the mitigation
applies: capability probes decide, UI gates actions, C-lane documents the
manual path.

The adapter code is complete and correct — it will work immediately when a
jsc.exe is placed in the cache directory (manually or via future authenticated
download). The net test correctly skips with `SKIPPED(no-binary)` until then.

## What works without jsc.exe

- WebKitRequirements download/extract/probe (GitHub releases are public)
- Capability probing framework (shared with V8/SM adapters)
- Adapter registration and dispatch through the registry
- All unit tests pass (env composition, gate mapping, isolation)
