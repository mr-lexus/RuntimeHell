# t24-spidermonkey.md — SpiderMonkeyAdapter (plan todo 24)

Date: 2026-08-24 · Executed by: Sisyphus session

## Scope delivered

- `apps/main/src/binaries/sm-source.ts` — official-source resolution:
  taskcluster "latest" index (jsvu host) → archive.mozilla.org current-ESR
  fallback (ESR version resolved live via product-details API; asset path
  `/releases/<ver>/jsshell/jsshell-win64.zip` verified live during QA).
  Record-mode sha256 (Mozilla publishes none) pinned into manifest.
- `apps/main/src/binaries/sm-downloader.ts` — installSmEngine wiring.
- `apps/main/src/engines/sm-probe.ts` — liveness (`print` marker),
  Reflect.parse AST probe, honest capability verdicts.
- `apps/main/src/engines/spidermonkey/sm-adapter.ts` — EngineAdapter impl:
  ast via `Reflect.parse` JSON driver; bytecode/deopts/gc → unsupported with
  actionable reason on stock shells (C-lane honesty, see Drift below).
- Registry registration in index.ts; catalog row flipped enabled for win64.

## VERIFIED DRIFT vs plan premise (important)

The plan's evidence (older docs) assumed `dis()` exists in SM shells. REAL
jsshell 140.14.0esr probing shows:
- `dis` is NOT defined (removed in modern shells)
- `dumpStencil(src)` is a silent no-op without an internally-flagged build
- `hasDisassembler()` === false on release builds

⇒ Stock SM shells cannot dump bytecode. Per the plan's own risk mitigation
("capability PROBES decide features per binary"), the adapter honestly gates
bytecode/deopt/gc as unsupported with actionable reasons; AST analysis works
fully. A future debug/custom SM build flips these via the same probes
(C-lane recipe documented in todo 32).

## Commands & evidence

```
pnpm typecheck   → exit 0
pnpm test        → exit 0; 178 passed | 15 skipped (193)
RH_NET_TESTS=1 pnpm vitest run apps/main/src/engines/sm.net.test.ts
→ Tests 2 passed (2); Duration 5.80s
```

Network happy scenario (REAL jsshell 140.14.0esr from Mozilla):
- installed via controller-compatible downloader into cache
- probe: astDump=true, bytecodeDump=false (stock)
- AST analysis of sum() end-to-end: rawOutput JSON contains 'sum' and
  'Identifier' parse nodes

Failure scenario (plan spec): forcing bytecode on stock shell emits
`unsupported` with reason containing 'bytecode' — asserted in net suite;
no spawn of a dump path that cannot exist.

## Unit coverage

- sm-dis parser (synthetic fixture): loc/op rows, source-notes separation,
  garbage tolerance (never throws). Real-binary golden generation lands when
  a debug-capable SM build is used (C-lane); parser shape already matches
  documented table format.
- binaries-controller: engine install failure surfaces structured error;
  spidermonkey route exercised.
